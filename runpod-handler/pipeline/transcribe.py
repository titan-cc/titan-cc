"""
faster-whisper transcription — medium, CUDA float16.

Model is baked into the Docker image at build time to avoid cold-start downloads.
A threading.Lock guards initialization so concurrent calls never double-load.
"""

from __future__ import annotations

import logging
import threading
import wave
import tempfile
from collections.abc import Callable
from pathlib import Path

from failure_codes import FailureCode, PipelineError

logger = logging.getLogger("titan-handler.transcribe")

_MODEL = None
_MODEL_LOCK = threading.Lock()


def _load_model():
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    with _MODEL_LOCK:
        if _MODEL is None:
            from faster_whisper import WhisperModel
            logger.info("loading_whisper_model: medium/cuda/float16")
            _MODEL = WhisperModel("medium", device="cuda", compute_type="float16")
            logger.info("whisper_model_loaded")
    return _MODEL


def warmup() -> None:
    """
    Run a silent 1-second dummy transcription to pre-warm CUDA kernels and
    stabilize GPU memory allocation before the first real job arrives.
    """
    model = _load_model()
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp_path = Path(f.name)
    try:
        with wave.open(str(tmp_path), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(16000)
            wf.writeframes(b"\x00" * 32000)  # 1 second of silence
        # Consume the generator so inference actually runs
        list(model.transcribe(str(tmp_path), language="en")[0])
        logger.info("whisper_warmup_complete")
    finally:
        tmp_path.unlink(missing_ok=True)


def transcribe(
    wav_path: str | Path,
    cancel_check: Callable[[], None] | None = None,
) -> list[dict]:
    """
    Transcribe a 16 kHz mono WAV file.

    cancel_check — optional zero-arg callable called every 10 segments.
    It should raise JobCancelledError to abort mid-transcription.

    Returns a list of segment dicts:
      {"start": float, "end": float, "text": str,
       "words": [{"word": str, "start": float, "end": float, "prob": float}]}
    """
    try:
        model = _load_model()
        segments_iter, _info = model.transcribe(
            str(wav_path),
            language="en",
            word_timestamps=True,
            vad_filter=False,          # VAD already done upstream
            beam_size=5,
            best_of=5,
            temperature=0,             # greedy — more consistent, no random sampling
            condition_on_previous_text=True,
            no_speech_threshold=0.6,
            log_prob_threshold=-1.0,
        )
        result = []
        for i, seg in enumerate(segments_iter):
            if cancel_check and i % 10 == 0:
                cancel_check()
            words = []
            if seg.words:
                words = [
                    {"word": w.word, "start": w.start, "end": w.end, "prob": w.probability}
                    for w in seg.words
                ]
            result.append({"start": seg.start, "end": seg.end, "text": seg.text.strip(), "words": words})
        return result
    except Exception as exc:
        from failure_codes import JobCancelledError
        if isinstance(exc, JobCancelledError):
            raise
        msg = str(exc).lower()
        if "out of memory" in msg or "oom" in msg:
            raise PipelineError(FailureCode.GPU_OOM, f"OOM during transcription: {exc}") from exc
        raise PipelineError(FailureCode.WORKER_CRASHED, f"Transcription error: {exc}") from exc

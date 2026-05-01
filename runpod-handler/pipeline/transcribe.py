"""
faster-whisper transcription — medium, CUDA float16.

Model is baked into the Docker image at build time to avoid cold-start downloads.
"""

from __future__ import annotations

from pathlib import Path

from failure_codes import FailureCode, PipelineError

_MODEL = None  # loaded once per worker process


def _load_model():
    global _MODEL
    if _MODEL is None:
        from faster_whisper import WhisperModel
        _MODEL = WhisperModel("medium", device="cuda", compute_type="float16")
    return _MODEL


def transcribe(
    wav_path: str | Path,
    language: str = "auto",
) -> list[dict]:
    """
    Transcribe a 16 kHz mono WAV file.

    Returns a list of segment dicts:
      {"start": float, "end": float, "text": str,
       "words": [{"word": str, "start": float, "end": float, "prob": float}]}
    """
    try:
        model = _load_model()
        lang = None if language == "auto" else language
        segments_iter, _info = model.transcribe(
            str(wav_path),
            language=lang,
            word_timestamps=True,
            vad_filter=False,  # VAD already done upstream
        )
        result = []
        for seg in segments_iter:
            words = []
            if seg.words:
                words = [
                    {"word": w.word, "start": w.start, "end": w.end, "prob": w.probability}
                    for w in seg.words
                ]
            result.append({"start": seg.start, "end": seg.end, "text": seg.text.strip(), "words": words})
        return result
    except Exception as exc:
        msg = str(exc).lower()
        if "out of memory" in msg or "oom" in msg:
            raise PipelineError(FailureCode.GPU_OOM, f"OOM during transcription: {exc}") from exc
        raise PipelineError(FailureCode.WORKER_CRASHED, f"Transcription error: {exc}") from exc

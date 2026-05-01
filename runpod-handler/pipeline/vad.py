"""
Silero VAD — detect speech segments.

Raises AUDIO_TOO_QUIET if total detected speech is < MIN_SPEECH_SECONDS.
"""

from __future__ import annotations

import logging
from pathlib import Path

from failure_codes import FailureCode, PipelineError

logger = logging.getLogger("titan-handler.vad")

MIN_SPEECH_SECONDS = 2.0

_model = None
_utils = None


def preload() -> None:
    """Load VAD model into memory at startup (called before first job)."""
    global _model, _utils
    if _model is None:
        import torch
        logger.info("loading_silero_vad")
        _model, _utils = torch.hub.load(
            repo_or_dir="snakers4/silero-vad",
            model="silero_vad",
            force_reload=False,
            trust_repo=True,
        )
        logger.info("silero_vad_loaded")


def _load_model():
    global _model, _utils
    if _model is None:
        preload()
    return _model, _utils


def get_speech_segments(wav_path: str | Path) -> list[dict[str, float]]:
    """
    Return [{start, end}, ...] in seconds for all detected speech.
    Raises AUDIO_TOO_QUIET if cumulative speech < MIN_SPEECH_SECONDS.
    Raises GPU_OOM on CUDA out-of-memory.
    """
    try:
        model, utils = _load_model()
        get_timestamps, _, read_audio = utils[:3]

        wav = read_audio(str(wav_path), sampling_rate=16000)
        raw = get_timestamps(wav, model, sampling_rate=16000, return_seconds=True)
    except MemoryError as exc:
        raise PipelineError(FailureCode.GPU_OOM, "Out of memory during VAD") from exc
    except Exception as exc:
        if "out of memory" in str(exc).lower():
            raise PipelineError(FailureCode.GPU_OOM, str(exc)) from exc
        raise PipelineError(FailureCode.WORKER_CRASHED, f"VAD error: {exc}") from exc

    segments = [{"start": float(s["start"]), "end": float(s["end"])} for s in raw]
    total = sum(s["end"] - s["start"] for s in segments)

    if total < MIN_SPEECH_SECONDS:
        raise PipelineError(
            FailureCode.AUDIO_TOO_QUIET,
            f"Only {total:.1f}s of speech detected (minimum {MIN_SPEECH_SECONDS}s)",
        )

    return segments

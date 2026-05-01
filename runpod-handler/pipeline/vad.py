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


def _find_silero_local() -> "Path | None":
    """
    Return the torch-hub cached path for snakers4/silero-vad, or None.

    torch.hub caches GitHub repos as  $TORCH_HOME/hub/{owner}_{repo}_{branch}/.
    The model is baked into the Docker image so this path must exist at runtime;
    using source="local" then skips any GitHub network call entirely.
    """
    import torch

    hub_dir = Path(torch.hub.get_dir())
    for branch in ("master", "main"):
        candidate = hub_dir / f"snakers4_silero-vad_{branch}"
        if (candidate / "hubconf.py").exists():
            return candidate
    return None


def preload() -> None:
    """Load VAD model into memory at startup (called before first job)."""
    global _model, _utils
    if _model is not None:
        return

    local_path = _find_silero_local()
    if local_path:
        # Offline — baked into the image, no GitHub call needed.
        logger.info("loading_silero_vad: source=local path=%s", local_path)
        import torch
        _model, _utils = torch.hub.load(
            repo_or_dir=str(local_path),
            model="silero_vad",
            source="local",
            trust_repo=True,
        )
    else:
        # Fallback: model not found in expected cache path; try online.
        import torch
        logger.warning(
            "loading_silero_vad: local cache not found under %s "
            "— falling back to online download (slow)",
            torch.hub.get_dir(),
        )
        _model, _utils = torch.hub.load(
            "snakers4/silero-vad",
            "silero_vad",
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

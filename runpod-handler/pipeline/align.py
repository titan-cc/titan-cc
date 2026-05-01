"""
WhisperX speaker diarization — optional, only when enable_diarization=True.

Fails gracefully: on any error, logs a warning and returns the original segments.
WhisperX is NOT included in requirements.txt by default; install separately if needed.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def diarize(segments: list[dict], wav_path: str) -> list[dict]:
    """
    Attempt to add speaker labels to segments.
    Returns original segments unchanged if whisperx is unavailable or fails.
    """
    try:
        import whisperx  # type: ignore[import-untyped]

        device = "cuda"
        align_model, metadata = whisperx.load_align_model(
            language_code=segments[0].get("language", "en") if segments else "en",
            device=device,
        )
        aligned = whisperx.align(segments, align_model, metadata, wav_path, device)

        diarize_model = whisperx.DiarizationPipeline(device=device)
        diarize_segs = diarize_model(wav_path)
        result = whisperx.assign_word_speakers(diarize_segs, aligned)
        return result["segments"]
    except ImportError:
        logger.warning("whisperx_not_installed; skipping diarization")
        return segments
    except Exception as exc:
        logger.warning("diarization_failed: %s; returning original segments", exc)
        return segments

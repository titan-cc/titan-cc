"""
Write transcription segments to JSON, SRT, and TXT files.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path


def _srt_time(seconds: float) -> str:
    total_ms = round(seconds * 1000)  # round, so 15.6 s is 15,600 and not 15,599
    h, rem = divmod(total_ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


# ── Caption splitting ─────────────────────────────────────────────────────────
# Whisper segments are often 15-30 words long, which makes SRT captions hard to
# read. The SRT is rebuilt from word timestamps into short captions. JSON and TXT
# keep the original segments.
MAX_CAPTION_CHARS = 42      # one subtitle line (common broadcast standard)
MAX_CAPTION_SECONDS = 5.0   # longest time one caption stays on screen
PAUSE_SPLIT_SECONDS = 0.5   # a silence this long starts a new caption
MIN_CHARS_FOR_SOFT_BREAK = 15  # break at a comma only once the caption has this much text

_SENTENCE_END = (".", "?", "!")
_SOFT_BREAK = (",", ";", ":")


def _join(words: list[dict]) -> str:
    return "".join(w["word"] for w in words).strip()


def split_into_captions(segments: list[dict]) -> list[dict]:
    """
    Split segments into short captions using word timestamps.

    A caption ends at a sentence end, at a comma once it has some length, at a
    pause, or before it would pass MAX_CAPTION_CHARS or MAX_CAPTION_SECONDS.
    Segments without word timestamps are kept as they are.
    Returns [{"start": float, "end": float, "text": str}].
    """
    captions: list[dict] = []
    for seg in segments:
        words = [w for w in seg.get("words") or [] if w.get("word", "").strip()]
        if not words:
            captions.append({"start": seg["start"], "end": seg["end"], "text": seg["text"]})
            continue

        current: list[dict] = []

        def flush() -> None:
            if current:
                captions.append({
                    "start": current[0]["start"],
                    "end": current[-1]["end"],
                    "text": _join(current),
                })
                current.clear()

        for word in words:
            if current:
                too_long = len(_join(current + [word])) > MAX_CAPTION_CHARS
                too_slow = word["end"] - current[0]["start"] > MAX_CAPTION_SECONDS
                paused = word["start"] - current[-1]["end"] >= PAUSE_SPLIT_SECONDS
                if too_long or too_slow or paused:
                    flush()
            current.append(word)
            text = word["word"].strip()
            if text.endswith(_SENTENCE_END) or (
                text.endswith(_SOFT_BREAK) and len(_join(current)) >= MIN_CHARS_FOR_SOFT_BREAK
            ):
                flush()
        flush()

    return _merge_orphans(captions)


def _merge_orphans(captions: list[dict]) -> list[dict]:
    """Attach a lone trailing word to the caption before it when it still fits."""
    merged: list[dict] = []
    for cap in captions:
        prev = merged[-1] if merged else None
        if (
            prev is not None
            and " " not in cap["text"]
            and not prev["text"].endswith(_SENTENCE_END)
            and len(prev["text"]) + 1 + len(cap["text"]) <= MAX_CAPTION_CHARS + 8
            and cap["start"] - prev["end"] < PAUSE_SPLIT_SECONDS
        ):
            prev["text"] = f'{prev["text"]} {cap["text"]}'
            prev["end"] = cap["end"]
        else:
            merged.append(dict(cap))
    return merged


def write_outputs(
    segments: list[dict],
    job_id: str,
    out_dir: str | Path | None = None,
) -> dict[str, Path]:
    """
    Write JSON, SRT, and TXT representations of the transcript.
    Returns {format_name: Path}.
    """
    out = Path(out_dir or tempfile.mkdtemp())
    out.mkdir(parents=True, exist_ok=True)

    paths: dict[str, Path] = {}

    # ── JSON ──────────────────────────────────────────────────────────────────
    json_path = out / "transcript.json"
    json_path.write_text(
        json.dumps({"job_id": job_id, "segments": segments}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    paths["json"] = json_path

    # ── SRT ───────────────────────────────────────────────────────────────────
    srt_path = out / "transcript.srt"
    lines: list[str] = []
    for i, cap in enumerate(split_into_captions(segments), 1):
        lines.append(str(i))
        lines.append(f"{_srt_time(cap['start'])} --> {_srt_time(cap['end'])}")
        lines.append(cap["text"])
        lines.append("")
    srt_path.write_text("\n".join(lines), encoding="utf-8")
    paths["srt"] = srt_path

    # ── TXT ───────────────────────────────────────────────────────────────────
    txt_path = out / "transcript.txt"
    txt_path.write_text(
        "\n".join(seg["text"] for seg in segments), encoding="utf-8"
    )
    paths["txt"] = txt_path

    return paths

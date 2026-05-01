"""
Write transcription segments to JSON, SRT, and TXT files.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path


def _srt_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


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
    for i, seg in enumerate(segments, 1):
        lines.append(str(i))
        lines.append(f"{_srt_time(seg['start'])} --> {_srt_time(seg['end'])}")
        lines.append(seg["text"])
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

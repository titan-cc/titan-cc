"""
Short SRT captions, used when a transcript is edited and the SRT is rebuilt.

Same rules as runpod-handler/pipeline/format.py (keep the two in step): a caption
ends at a sentence end, at a comma once it has some text, at a pause, or before
it passes MAX_CAPTION_CHARS or MAX_CAPTION_SECONDS.

An edited segment's word timestamps may no longer match its text. Word timings
are used only when the words still spell out the text; otherwise the text is
split the same way and timed in proportion to its length.
"""

from __future__ import annotations

import re

MAX_CAPTION_CHARS = 42
MAX_CAPTION_SECONDS = 5.0
PAUSE_SPLIT_SECONDS = 0.5
MIN_CHARS_FOR_SOFT_BREAK = 15

_SENTENCE_END = (".", "?", "!")
_SOFT_BREAK = (",", ";", ":")


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _join(words: list[dict]) -> str:
    return "".join(w["word"] for w in words).strip()


def _words_match_text(seg: dict) -> bool:
    words = seg.get("words") or []
    return bool(words) and _norm(_join(words)) == _norm(seg.get("text", ""))


def _ends_caption(token: str, caption_text: str) -> bool:
    return token.endswith(_SENTENCE_END) or (
        token.endswith(_SOFT_BREAK) and len(caption_text) >= MIN_CHARS_FOR_SOFT_BREAK
    )


def _split_timed_words(words: list[dict]) -> list[dict]:
    captions: list[dict] = []
    current: list[dict] = []

    def flush() -> None:
        if current:
            captions.append({"start": current[0]["start"], "end": current[-1]["end"], "text": _join(current)})
            current.clear()

    for word in words:
        if current:
            too_long = len(_join(current + [word])) > MAX_CAPTION_CHARS
            too_slow = word["end"] - current[0]["start"] > MAX_CAPTION_SECONDS
            paused = word["start"] - current[-1]["end"] >= PAUSE_SPLIT_SECONDS
            if too_long or too_slow or paused:
                flush()
        current.append(word)
        if _ends_caption(word["word"].strip(), _join(current)):
            flush()
    flush()
    return captions


def _split_untimed_text(seg: dict) -> list[dict]:
    """Split by the same text rules, then share the segment's time by character count."""
    tokens = seg["text"].split()
    if not tokens:
        return []
    chunks: list[list[str]] = []
    current: list[str] = []
    for tok in tokens:
        if current and len(" ".join(current + [tok])) > MAX_CAPTION_CHARS:
            chunks.append(current)
            current = []
        current.append(tok)
        if _ends_caption(tok, " ".join(current)):
            chunks.append(current)
            current = []
    if current:
        chunks.append(current)

    texts = [" ".join(c) for c in chunks]
    total = sum(len(t) for t in texts) or 1
    start, span = seg["start"], max(seg["end"] - seg["start"], 0.0)
    captions, t = [], start
    for text in texts:
        end = t + span * len(text) / total
        captions.append({"start": t, "end": end, "text": text})
        t = end
    captions[-1]["end"] = seg["end"]
    return captions


def split_into_captions(segments: list[dict]) -> list[dict]:
    captions: list[dict] = []
    for seg in segments:
        if not seg.get("text", "").strip():
            continue
        if _words_match_text(seg):
            words = [w for w in seg["words"] if w.get("word", "").strip()]
            captions.extend(_split_timed_words(words))
        else:
            captions.extend(_split_untimed_text(seg))
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


def srt_time(seconds: float) -> str:
    total_ms = round(seconds * 1000)
    h, rem = divmod(total_ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def build_srt(segments: list[dict]) -> str:
    lines: list[str] = []
    for i, cap in enumerate(split_into_captions(segments), 1):
        lines += [str(i), f"{srt_time(cap['start'])} --> {srt_time(cap['end'])}", cap["text"], ""]
    return "\n".join(lines)

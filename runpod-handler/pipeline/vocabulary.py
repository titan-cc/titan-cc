"""
Team word list, applied around transcription.

The backend sends config["vocabulary"]:
  {"hints":   ["Antano", "Harini", "B!G", ...],                 # told to Whisper
   "fix":     [{"term": "Antano", "variants": ["Anthano"]}],     # exact auto-correct
   "context": [{"term": "B!G", "variants": ["big"], "clues": ["cohort"]}]}  # suggest only

Auto-corrected words keep what Whisper wrote in word["auto_from"], so the editor
can mark them and undo them. Suggestions are never applied: the word gets
word["suggest"] = term and a person accepts or ignores it.
"""

from __future__ import annotations

import re

_EDGE = re.compile(r"^[^\w]+|[^\w]+$", re.UNICODE)
MAX_HINT_CHARS = 400   # Whisper's prompt window is small; keep hints short
CLUE_WINDOW = 4        # words either side of a sound-alike that count as context


def _bare(token: str) -> str:
    return _EDGE.sub("", token)


def hotwords(vocab: dict | None) -> str | None:
    """Comma-separated hint string for Whisper, most important terms first."""
    terms = [t for t in (vocab or {}).get("hints", []) if isinstance(t, str) and t.strip()]
    out: list[str] = []
    length = 0
    for t in terms:
        if length + len(t) + 2 > MAX_HINT_CHARS:
            break
        out.append(t.strip())
        length += len(t) + 2
    return ", ".join(out) or None


def _swap(token: str, bare: str, term: str) -> str:
    """Replace the bare word inside a token, keeping punctuation and leading space."""
    i = token.find(bare)
    return token if i < 0 else token[:i] + term + token[i + len(bare):]


def apply(segments: list[dict], vocab: dict | None) -> tuple[list[dict], dict]:
    """
    Apply fix and context rules to word-timed segments. Returns (segments, counts).
    Segments without word timings are left untouched.
    """
    vocab = vocab or {}
    fixes: dict[str, str] = {}
    for rule in vocab.get("fix", []):
        for v in rule.get("variants", []):
            if v and v != rule.get("term"):
                fixes[v] = rule["term"]  # exact, case-sensitive

    sound_alikes: dict[str, tuple[str, set[str]]] = {}
    for rule in vocab.get("context", []):
        clues = {c.lower() for c in rule.get("clues", []) if c}
        for v in rule.get("variants", []):
            if v:
                sound_alikes[v.lower()] = (rule["term"], clues)

    counts = {"fixed": 0, "suggested": 0}
    if not fixes and not sound_alikes:
        return segments, counts

    for seg in segments:
        words = seg.get("words") or []
        if not words:
            continue
        bares = [_bare(w.get("word", "")) for w in words]
        lowers = [b.lower() for b in bares]
        changed = False
        for i, w in enumerate(words):
            bare = bares[i]
            if not bare:
                continue
            if bare in fixes:
                w["auto_from"] = w["word"].strip()
                w["word"] = _swap(w["word"], bare, fixes[bare])
                counts["fixed"] += 1
                changed = True
                continue
            hit = sound_alikes.get(bare.lower())
            if hit and bare != hit[0]:
                term, clues = hit
                window = lowers[max(0, i - CLUE_WINDOW): i] + lowers[i + 1: i + 1 + CLUE_WINDOW]
                shouted = len(bare) > 1 and bare.isupper()
                if shouted or (clues and clues.intersection(window)):
                    w["suggest"] = term
                    counts["suggested"] += 1
        if changed:
            seg["text"] = "".join(w["word"] for w in words).strip()
    return segments, counts

"""Short SRT captions when an edited transcript is saved."""

from app.services.captions import MAX_CAPTION_CHARS, build_srt, split_into_captions, srt_time

LONG = (
    "So what we are going to do today is look at how your business can grow, "
    "and the first thing you need to understand is that clarity comes before action."
)


def _segment(text: str, start: float = 0.0, step: float = 0.3) -> dict:
    words, t = [], start
    for w in text.split():
        words.append({"word": " " + w, "start": round(t, 2), "end": round(t + step - 0.05, 2), "prob": 0.9})
        t += step
    return {"start": words[0]["start"], "end": words[-1]["end"], "text": text, "words": words}


def test_uses_word_timings_when_words_match():
    seg = _segment(LONG)
    caps = split_into_captions([seg])
    assert len(caps) > 2
    assert caps[0]["start"] == seg["words"][0]["start"]
    assert all(len(c["text"]) <= MAX_CAPTION_CHARS + 8 for c in caps)


def test_edited_text_wins_over_stale_words():
    seg = _segment(LONG.replace("business", "bizness"))
    seg["text"] = LONG  # the user fixed a word; the word list still has the old spelling
    caps = split_into_captions([seg])
    joined = " ".join(c["text"] for c in caps)
    assert "business" in joined and "bizness" not in joined
    assert joined.split() == LONG.split()
    assert caps[0]["start"] == seg["start"] and caps[-1]["end"] == seg["end"]
    for a, b in zip(caps, caps[1:]):
        assert a["end"] <= b["start"] + 1e-9


def test_segment_without_words_is_still_split():
    seg = {"start": 10.0, "end": 20.0, "text": LONG, "speaker": None, "words": None}
    caps = split_into_captions([seg])
    assert len(caps) > 2
    assert all(len(c["text"]) <= MAX_CAPTION_CHARS for c in caps)


def test_build_srt_format_and_rounding():
    srt = build_srt([_segment("Hello there.", start=15.6)])
    assert srt.startswith("1\n00:00:15,600 --> ")
    assert srt_time(3661.9996) == "01:01:02,000"

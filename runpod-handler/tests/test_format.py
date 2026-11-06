"""Tests for SRT caption splitting. Run: python -m pytest tests (from runpod-handler/)."""

from pipeline.format import _srt_time, MAX_CAPTION_CHARS, MAX_CAPTION_SECONDS, split_into_captions, write_outputs


def _segment(text: str, start: float = 0.0, step: float = 0.3, gaps: dict[int, float] | None = None) -> dict:
    """Build a Whisper-style segment with evenly spaced word timestamps."""
    words, t = [], start
    for i, w in enumerate(text.split()):
        t += (gaps or {}).get(i, 0.0)
        words.append({"word": " " + w, "start": round(t, 2), "end": round(t + step - 0.05, 2), "prob": 0.9})
        t += step
    return {"start": words[0]["start"], "end": words[-1]["end"], "text": text, "words": words}


LONG = (
    "So what we are going to do today is look at how your business can grow, "
    "and the first thing you need to understand is that clarity comes before action. "
    "Without clarity nothing else really works."
)


def test_captions_respect_length_and_duration():
    caps = split_into_captions([_segment(LONG)])
    assert len(caps) > 3
    for c in caps:
        assert len(c["text"]) <= MAX_CAPTION_CHARS + 8  # +8 only for a merged orphan word
        assert c["end"] - c["start"] <= MAX_CAPTION_SECONDS + 0.5


def test_no_words_lost_or_reordered():
    caps = split_into_captions([_segment(LONG)])
    assert " ".join(c["text"] for c in caps).split() == LONG.split()


def test_sentence_end_starts_new_caption():
    caps = split_into_captions([_segment(LONG)])
    assert any(c["text"].endswith("action.") for c in caps)
    assert any(c["text"].startswith("Without") for c in caps)


def test_pause_starts_new_caption():
    caps = split_into_captions([_segment("one two three four five", gaps={3: 1.0})])
    assert [c["text"] for c in caps] == ["one two three", "four five"]


def test_timestamps_increase():
    caps = split_into_captions([_segment(LONG), _segment(LONG, start=60.0)])
    for a, b in zip(caps, caps[1:]):
        assert a["start"] < a["end"] <= b["start"]


def test_segment_without_words_kept():
    seg = {"start": 1.0, "end": 2.0, "text": "Hello there.", "words": []}
    assert split_into_captions([seg]) == [{"start": 1.0, "end": 2.0, "text": "Hello there."}]


def test_write_outputs_only_changes_srt(tmp_path):
    seg = _segment(LONG)
    paths = write_outputs([seg], "job-1", out_dir=tmp_path)
    assert paths["txt"].read_text(encoding="utf-8") == LONG
    srt = paths["srt"].read_text(encoding="utf-8")
    assert srt.startswith("1\n00:00:00,000 --> ")
    assert srt.count(" --> ") == len(split_into_captions([seg]))


def test_srt_time_rounds_milliseconds():
    assert _srt_time(15.6) == "00:00:15,600"
    assert _srt_time(3661.9996) == "01:01:02,000"

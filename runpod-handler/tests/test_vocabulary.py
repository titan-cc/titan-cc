"""Team word list in the worker. Run: python -m pytest tests (from runpod-handler/)."""

from pipeline import vocabulary as v


def _seg(text: str) -> dict:
    words = [{"word": " " + w, "start": i, "end": i + 0.5, "prob": 0.8} for i, w in enumerate(text.split())]
    return {"start": 0, "end": len(words), "text": text, "words": words}


VOCAB = {
    "hints": ["Antano", "Harini", "B!G", "SLDCI"],
    "fix": [{"term": "Antano", "variants": ["Anthano", "Antanu"]}],
    "context": [{"term": "B!G", "variants": ["big", "BIG"], "clues": ["cohort", "programme"]}],
}


def test_hotwords_are_short_and_ordered():
    assert v.hotwords(VOCAB) == "Antano, Harini, B!G, SLDCI"
    assert v.hotwords({}) is None
    long = {"hints": [f"Name{i:03d}" for i in range(200)]}
    assert len(v.hotwords(long)) <= v.MAX_HINT_CHARS


def test_fix_replaces_exact_spellings_and_remembers_the_original():
    segs, counts = v.apply([_seg("thanks Anthano, see you Antanu.")], VOCAB)
    assert segs[0]["text"] == "thanks Antano, see you Antano."
    assert counts == {"fixed": 2, "suggested": 0}
    assert segs[0]["words"][1]["auto_from"] == "Anthano,"
    assert segs[0]["words"][1]["start"] == 1  # timing kept


def test_fix_is_exact_not_fuzzy():
    segs, counts = v.apply([_seg("anthano Anthanos")], VOCAB)
    assert segs[0]["text"] == "anthano Anthanos"
    assert counts["fixed"] == 0


def test_sound_alike_is_suggested_only_with_context():
    segs, counts = v.apply(
        [_seg("we have a big plan"), _seg("welcome to the big cohort"), _seg("join BIG today")], VOCAB
    )
    assert [s["text"] for s in segs] == ["we have a big plan", "welcome to the big cohort", "join BIG today"]
    assert "suggest" not in segs[0]["words"][3]
    assert segs[1]["words"][3]["suggest"] == "B!G"
    assert segs[2]["words"][1]["suggest"] == "B!G"
    assert counts == {"fixed": 0, "suggested": 2}


def test_no_vocabulary_changes_nothing():
    seg = _seg("hello Anthano")
    segs, counts = v.apply([seg], None)
    assert segs[0]["text"] == "hello Anthano" and counts == {"fixed": 0, "suggested": 0}

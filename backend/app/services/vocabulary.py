"""
Team word list rules and the payload sent to the GPU worker with each job.

Guardrails (see the word list design):
- People decide: words join the list only through a click (Remember, or an admin).
- "fix" only replaces exact spellings a person confirmed, never fuzzy matches.
- A spelling that is an everyday English word is never auto-replaced: a term whose
  confirmed spelling is an everyday word ("BIG" -> "big") becomes a "context" rule,
  which only suggests the correction for a person to accept.
- Whisper only takes so many hints, so the most-confirmed terms go first.
"""

from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import VocabularyTerm

MAX_HINTS = 60          # Whisper's prompt is short; the most-confirmed terms win
MAX_TERMS = 500
MAX_LEN = 60
MAX_VARIANTS = 12
MAX_CLUES = 15
MODES = ("fix", "context", "hint")
KINDS = ("person", "brand", "programme", "place", "term")

# Frequent English words. A word list spelling on this list is never auto-replaced.
COMMON_WORDS = frozenset("""
a about above across act add after again against age ago agree ah air all allow almost alone along already
also although always am among an and another answer any anyone anything are area arm around art as ask at
away back bad bag ball bank base be beat beautiful because become bed been before begin behind being
believe best better between big bill bit black blue board body book born both box boy break bring brother
build business but buy by call came camera can car card care carry case catch cause center central certain
chair chance change charge check child choice choose church city class clear close coach cold come company
cost could country couple course court cover create cup current cut dark data day dead deal dear decide
deep degree did die different do does dog done door down draw dream drive drop during each early east
easy eat effect eight either else end energy enough enter even evening event ever every everyone
everything exactly example expect experience eye face fact fail fall family far fast father fear feel
feeling few field fight figure fill final find fine finish fire first fish five floor fly focus follow food
foot for force form forward four free friend from front full fun future game garden gave get girl give
glad go goal god going gold gone good got great green ground group grow growth guess guy had hair half
hall hand happen happy hard has have he head health hear heart heat heavy hello help her here high him
his history hit hold home hope hot hour house how however huge human hundred i idea if image important
in inside instead interest into is issue it its job join just keep key kid kill kind king know land
language large last late later laugh law lead leader learn least leave left less let letter level lever
lie life light like line list listen little live long look lose lot love low made main major make man
many mark market matter may maybe me mean measure meet meeting member mention mind minute miss model
moment money month more morning most mother move much music must my name nation near need never new
news next nice night nine no none nor north not note nothing notice now number of off offer office often
oh ok okay old on once one only open or order other our out over own page pain paper parent part party
pass past pay people per perhaps person pick picture piece place plan play please point power present
pretty price problem process program programme project pull put question quick quickly quite race radio
raise range rate rather reach read ready real really reason receive red remember report rest result
return right rise risk road rock role room round rule run said same save saw say school sea second see
seem self sell send sense serve set seven several shall share she short should show side sign simple
since sing single sir sister sit six size skill small smile so social some someone something sometimes
son soon sorry sort sound south space speak special spend sport spring stage stand star start state
stay step still stop story street strong student study stuff such summer sun sure system table take talk
team tell ten term test than thank thanks that the their them then there these they thing think third
this those though thought thousand three through time to today together told too took top total touch
toward town trade tree trip true trust try turn two type under understand until up upon us use usual
value very view voice wait walk wall want war watch water way we week well went were west what when
where whether which while white who whole why wide will win wind window wish with within without woman
wonder word work world would write wrong yeah year yes yet you young your
""".split())


def is_common(word: str) -> bool:
    return re.sub(r"[^\w]", "", word).lower() in COMMON_WORDS


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()[:MAX_LEN]


def check_variants_for_mode(mode: str, variants: list[str]) -> str | None:
    """An error message if a fix rule would auto-replace an everyday word, else None."""
    if mode != "fix":
        return None
    bad = [v for v in variants if is_common(v)]
    if bad:
        return (
            f"'{bad[0]}' is an everyday word, so it can't be auto-corrected. "
            "Use 'Suggest in context' for sound-alikes like this."
        )
    return None


def mode_for_new_spelling(heard_as: str) -> str:
    """Mode for a word learned from a Remember click."""
    return "context" if is_common(heard_as) else "fix"


async def worker_payload(db: AsyncSession) -> dict:
    """The word list in the shape the GPU worker expects (config["vocabulary"])."""
    rows = (
        await db.execute(
            select(VocabularyTerm).order_by(
                VocabularyTerm.confirmations.desc(), VocabularyTerm.updated_at.desc()
            )
        )
    ).scalars().all()
    return {
        "hints": [r.term for r in rows[:MAX_HINTS]],
        "fix": [
            {"term": r.term, "variants": list(r.variants)}
            for r in rows if r.mode == "fix" and r.variants
        ],
        "context": [
            {"term": r.term, "variants": list(r.variants), "clues": list(r.clues)}
            for r in rows if r.mode == "context" and r.variants
        ],
    }

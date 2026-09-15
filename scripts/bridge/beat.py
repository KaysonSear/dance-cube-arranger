"""Beat <-> seconds conversion for Malody `.mc` charts.

Beat encoding: ``beat:[A, B, C]`` means absolute beat ``A + B/C``.
``C`` is the editor snap resolution (a denominator), NOT a time signature.
The meter is fixed 4/4, so the bar index of a beat is ``A // 4``.

All functions validate at this boundary and raise ``ValueError`` with a clear
message on malformed input (zero division, negative beat, non-positive bpm).
"""

from __future__ import annotations

import math
from collections.abc import Sequence

__all__ = [
    "Beat",
    "beat_to_float",
    "beat_to_seconds",
    "float_to_beat",
    "seconds_to_beat",
    "ticks_to_beat",
]

Beat = tuple[int, int, int]


def beat_to_float(beat: Sequence[int]) -> float:
    """Return the absolute beat value ``A + B/C`` for a ``[A, B, C]`` triple.

    Raises ``ValueError`` if the division ``C`` is not positive or the beat is
    negative (negative whole ``A`` or numerator ``B``).
    """
    if len(beat) != 3:
        raise ValueError(f"beat must have exactly 3 elements [A, B, C], got {len(beat)}: {beat!r}")
    whole, numerator, division = int(beat[0]), int(beat[1]), int(beat[2])
    if division <= 0:
        raise ValueError(f"beat division C must be positive, got {division} in {tuple(beat)!r}")
    if whole < 0 or numerator < 0:
        raise ValueError(f"beat must be non-negative, got {tuple(beat)!r}")
    return whole + numerator / division


def float_to_beat(absolute: float, division: int) -> Beat:
    """Quantize an absolute (fractional) beat value to a ``[A, B, division]`` triple.

    The fractional part is snapped to the nearest ``1 / division`` of a beat, so
    this is the inverse of ``beat_to_float`` up to that snap rounding. Used by the
    multi-BPM ``seconds_to_beat`` normalizer to re-encode an integrated beat value.
    """
    if division <= 0:
        raise ValueError(f"beat division must be positive, got {division}")
    whole = int(math.floor(absolute))
    numerator = round((absolute - whole) * division)
    if numerator == division:  # carry from rounding e.g. 0.9999 -> 1.0
        whole += 1
        numerator = 0
    return (whole, numerator, division)


def beat_to_seconds(beat: Sequence[int], bpm: float) -> float:
    """Return the time in seconds of ``beat`` at the given ``bpm``.

    One beat lasts ``60 / bpm`` seconds.
    """
    if bpm <= 0:
        raise ValueError(f"bpm must be positive, got {bpm}")
    return beat_to_float(beat) * 60.0 / bpm


def seconds_to_beat(seconds: float, bpm: float, division: int) -> Beat:
    """Quantize ``seconds`` (at ``bpm``) to a ``[A, B, division]`` beat triple.

    The fractional part is snapped to the nearest ``1 / division`` of a beat.
    """
    if bpm <= 0:
        raise ValueError(f"bpm must be positive, got {bpm}")
    if division <= 0:
        raise ValueError(f"beat division must be positive, got {division}")
    if seconds < 0:
        raise ValueError(f"seconds must be non-negative, got {seconds}")

    absolute = seconds * bpm / 60.0
    whole = int(math.floor(absolute))
    numerator = round((absolute - whole) * division)
    if numerator == division:  # carry from rounding e.g. 0.9999 -> 1.0
        whole += 1
        numerator = 0
    return (whole, numerator, division)


def ticks_to_beat(ticks: int, division: int) -> Beat:
    """Return the ``[A, B, division]`` beat for an integer tick count.

    ``ticks`` counts steps of ``1 / division`` of a beat, so the absolute beat
    is ``ticks / division``. Useful for grid generation: at ``division=4`` a
    tick is a 16th note, at ``division=8`` a tick is a 32nd note.
    """
    if division <= 0:
        raise ValueError(f"beat division must be positive, got {division}")
    if ticks < 0:
        raise ValueError(f"ticks must be non-negative, got {ticks}")
    return (ticks // division, ticks % division, division)

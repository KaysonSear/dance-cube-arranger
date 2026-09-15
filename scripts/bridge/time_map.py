"""Multi-BPM beat<->seconds normalization over a chart's ``time[]`` map.

The time map is the beat-sorted list of BPM-change points parsed from a ``.mc``
chart's ``time[]``. :func:`beat_to_seconds` integrates ``60 / bpm`` piecewise across
the segments, with the first point's ``delay`` (ms) as a lead-in offset; the
single-BPM case reduces to ``beat_float * 60 / bpm``. :func:`seconds_to_beat` inverts
by walking the segments and snapping to the nearest ``1 / division``.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from .beat import Beat, beat_to_float, float_to_beat

__all__ = ["TimePoint", "beat_to_seconds", "seconds_to_beat"]


@dataclass(frozen=True, slots=True)
class TimePoint:
    """One BPM-change point: ``bpm`` takes effect at ``beat``; ``delay`` is ms."""

    beat: float
    bpm: float
    delay: float


def beat_to_seconds(beat: Sequence[int], time_map: Sequence[TimePoint]) -> float:
    """Return the time in seconds of ``beat`` under a multi-BPM ``time_map``.

    Integrates ``60 / bpm`` piecewise across the (beat-sorted) BPM-change points,
    with the first time point's ``delay`` (ms) as a lead-in offset. Reduces to
    ``beat_float * 60 / bpm`` (plus lead-in) for a single time point.
    """
    if not time_map:
        raise ValueError("time_map must have at least one time point")
    absolute = beat_to_float(beat)
    first = time_map[0]
    seconds = first.delay / 1000.0  # lead-in offset (ms -> s)
    if len(time_map) == 1:  # fast path: single BPM
        return seconds + (absolute - first.beat) * 60.0 / first.bpm
    prev_beat, prev_bpm = first.beat, first.bpm
    for tp in time_map[1:]:
        if absolute <= tp.beat:
            break
        seconds += (tp.beat - prev_beat) * 60.0 / prev_bpm
        prev_beat, prev_bpm = tp.beat, tp.bpm
    return seconds + (absolute - prev_beat) * 60.0 / prev_bpm


def seconds_to_beat(seconds: float, time_map: Sequence[TimePoint], division: int) -> Beat:
    """Invert :func:`beat_to_seconds`, quantizing to a ``[A, B, division]`` triple.

    Walks the BPM-change segments to the one containing ``seconds``, then snaps the
    recovered beat to the nearest ``1 / division``.
    """
    if not time_map:
        raise ValueError("time_map must have at least one time point")
    first = time_map[0]
    base = first.delay / 1000.0  # time (s) at which first.beat occurs
    if len(time_map) == 1:  # fast path: single BPM
        absolute = first.beat + (seconds - base) * first.bpm / 60.0
        return float_to_beat(absolute, division)
    prev_beat, prev_bpm, seg_start = first.beat, first.bpm, base
    for tp in time_map[1:]:
        seg_end = seg_start + (tp.beat - prev_beat) * 60.0 / prev_bpm
        if seconds <= seg_end:
            absolute = prev_beat + (seconds - seg_start) * prev_bpm / 60.0
            return float_to_beat(absolute, division)
        seg_start, prev_beat, prev_bpm = seg_end, tp.beat, tp.bpm
    absolute = prev_beat + (seconds - seg_start) * prev_bpm / 60.0
    return float_to_beat(absolute, division)

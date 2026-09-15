"""Build a Malody V Cube (mode:9) `.mc` chart dictionary.

The output mirrors the clean corpus convention (e.g. ``10083_135114.mc``,
``10816_134284.mc``): audio is referenced BOTH via ``meta.song.file`` AND a
trailing ``type:1`` audio note (the final element of ``note[]``, carrying
``sound`` + ``offset`` and NO ``column``). Gameplay notes are Tap/Hold/multi-press
only — this writer never emits a ``dir`` field (classic Wulifang has no slides).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from .beat import Beat, beat_to_float

__all__ = ["ChartMeta", "NoteEvent", "build_mc"]

_COLUMN_MIN = 0
_COLUMN_MAX = 5  # Cube is always 6 columns, indexed 0..5


@dataclass(frozen=True, slots=True)
class ChartMeta:
    """Per-chart metadata; the song/cover are shared across the demo set."""

    chart_id: int
    creator: str
    version: str  # technique label, e.g. "纵连 Zonglian (Jack)"
    title: str
    artist: str
    bpm: float
    cover_file: str
    song_id: int
    preview_ms: int = 0
    bar_begin: int = 0
    speed: int = 0


@dataclass(frozen=True, slots=True)
class NoteEvent:
    """A single Tap (endbeat=None) or Hold (endbeat set) on one column.

    A multi-press (chord) is expressed as several NoteEvents sharing a beat.
    """

    beat: Beat
    column: int
    endbeat: Beat | None = None


def _validate_note(note: NoteEvent) -> None:
    if not (_COLUMN_MIN <= note.column <= _COLUMN_MAX):
        raise ValueError(
            f"note column must be in {_COLUMN_MIN}..{_COLUMN_MAX}, got {note.column}"
        )
    start = beat_to_float(note.beat)  # validates division + non-negative beat
    if note.endbeat is not None:
        end = beat_to_float(note.endbeat)
        if end < start:
            raise ValueError(
                f"note endbeat {note.endbeat!r} is before its beat {note.beat!r}"
            )


def _note_to_dict(note: NoteEvent) -> dict[str, Any]:
    payload: dict[str, Any] = {"beat": list(note.beat), "column": note.column}
    if note.endbeat is not None:
        payload["endbeat"] = list(note.endbeat)
    return payload


def build_mc(
    meta: ChartMeta,
    notes: Sequence[NoteEvent],
    audio_file: str,
    audio_offset_ms: int = 0,
) -> dict[str, Any]:
    """Return a `.mc` chart dict for ``notes`` under ``meta``.

    ``audio_file`` is referenced via ``meta.song.file`` and the trailing
    ``type:1`` audio note. Malody applies ``audio_offset_ms`` as a signed shift:
    ``audio_time = chart_time - audio_offset_ms / 1000``.
    """
    for note in notes:
        _validate_note(note)

    bpm = float(meta.bpm)
    gameplay: list[dict[str, Any]] = [_note_to_dict(note) for note in notes]
    audio_note: dict[str, Any] = {
        "beat": [0, 0, 1],
        "type": 1,
        "sound": audio_file,
        "offset": audio_offset_ms,
    }

    meta_block: Mapping[str, Any] = {
        "id": meta.chart_id,
        "creator": meta.creator,
        "background": meta.cover_file,
        "version": meta.version,
        "preview": meta.preview_ms,
        "mode": 9,
        "song": {
            "id": meta.song_id,
            "title": meta.title,
            "artist": meta.artist,
            "file": audio_file,
            "bpm": bpm,
        },
        "mode_ext": {
            "column": 0,
            "bar_begin": meta.bar_begin,
            "speed": meta.speed,
        },
        "aimode": "",
    }

    return {
        "meta": dict(meta_block),
        "time": [{"beat": [0, 0, 1], "bpm": bpm, "delay": 0.0}],
        "note": [*gameplay, audio_note],
    }

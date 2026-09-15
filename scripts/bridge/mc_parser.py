"""Parse Malody `.mc` charts (mode:9 / Dance Cube) into typed structures.

A `.mc` file is JSON with three blocks::

    meta: { id, creator, version, mode:9, song:{...}, mode_ext:{...}, aimode, ... }
    time: [ { beat:[A,B,C], bpm:float, delay:float }, ... ]   # BPM-change points
    note: [ ...gameplay notes..., { beat:[0,0,1], type:1, sound, offset[, vol] } ]

The single ``type:1`` note is the audio reference (the FINAL element, no ``column``);
every other note is a gameplay note (Tap / Hold / multi-press). The corpus ``dir``
note attribute (slide/scroll, present on ~46% of charts) is DROPPED — classic
Wulifang has no slides, and ``dir`` does not change the note count.

Two meta variants occur in the corpus and both parse cleanly:
- clean (e.g. 10083): ``song`` has ``file``+``bpm``; ``mode_ext`` has
  ``column``+``bar_begin``+``speed``; ``aimode:""``; audio note has no ``vol``.
- editor (e.g. 10563): top-level ``effect``/``extra``; ``song`` has NO ``file``/``bpm``;
  ``mode_ext`` may have ONLY ``bar_begin``; audio note carries ``vol``.

Beat<->seconds normalization over the parsed ``time_map`` lives in
:mod:`src.pipeline.time_map` (re-exported here for a single import surface).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .beat import Beat, beat_to_float
from .time_map import TimePoint, beat_to_seconds, seconds_to_beat

__all__ = [
    "AudioNote",
    "Chart",
    "ChartMeta",
    "GameplayNote",
    "McParseError",
    "ModeExt",
    "SongMeta",
    "TimePoint",
    "beat_to_seconds",
    "parse_mc",
    "seconds_to_beat",
]

_COLUMN_MIN = 0
_COLUMN_MAX = 5  # Cube is always 6 columns, indexed 0..5


class McParseError(ValueError):
    """Raised when a `.mc` chart cannot be parsed (malformed JSON/structure/values).

    Subclasses ``ValueError`` so callers may catch either type.
    """


@dataclass(frozen=True, slots=True)
class SongMeta:
    """Song block; ``file``/``bpm`` are absent in the editor variant."""

    song_id: int | None
    title: str | None
    artist: str | None
    file: str | None
    bpm: float | None


@dataclass(frozen=True, slots=True)
class ModeExt:
    """Mode extension; any field may be absent (editor variant has only ``bar_begin``)."""

    column: int | None
    bar_begin: int | None
    speed: int | None


@dataclass(frozen=True, slots=True)
class ChartMeta:
    """Chart metadata. ``mode_ext``/``aimode`` may be absent in some charts."""

    chart_id: int | None
    creator: str | None
    version: str | None
    mode: int | None
    mode_ext: ModeExt | None
    song: SongMeta
    background: str | None
    preview: int | None
    aimode: str | None


@dataclass(frozen=True, slots=True)
class GameplayNote:
    """A Tap (``endbeat is None``) or Hold; a chord is several notes sharing a beat.

    ``dir`` (corpus slide attribute) is intentionally NOT stored.
    """

    beat: Beat
    beat_float: float
    column: int
    endbeat: Beat | None = None
    endbeat_float: float | None = None


@dataclass(frozen=True, slots=True)
class AudioNote:
    """The single ``type:1`` audio reference; ``offset``/``vol`` may be absent."""

    sound: str
    offset: int | None = None
    vol: int | None = None


@dataclass(frozen=True, slots=True)
class Chart:
    """A fully parsed `.mc` chart."""

    meta: ChartMeta
    time_map: tuple[TimePoint, ...]
    gameplay_notes: tuple[GameplayNote, ...]
    audio_note: AudioNote


def parse_mc(path_or_dict: str | Path | dict[str, Any]) -> Chart:
    """Parse a `.mc` chart from a filesystem path (str/Path) or a loaded dict.

    Raises :class:`McParseError` (a ``ValueError``) on malformed JSON, missing
    ``meta``/``time``/``note``, an out-of-range column, a non-positive beat
    division or bpm, a hold whose ``endbeat`` precedes its ``beat``, or a chart
    without exactly one ``type:1`` audio note.
    """
    data = _load(path_or_dict)
    if not isinstance(data, dict):
        raise McParseError("chart root must be a JSON object")
    if "meta" not in data:
        raise McParseError("chart missing 'meta' object")
    return Chart(
        meta=_parse_meta(data["meta"]),
        time_map=_parse_time_map(data.get("time")),
        gameplay_notes=(notes := _parse_notes(data.get("note")))[0],
        audio_note=notes[1],
    )


# --- internal parsing helpers -----------------------------------------------


def _load(path_or_dict: str | Path | dict[str, Any]) -> Any:
    if isinstance(path_or_dict, dict):
        return path_or_dict
    if isinstance(path_or_dict, (str, Path)):
        path = Path(path_or_dict)
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as exc:
            raise McParseError(f"cannot read .mc file {path}: {exc}") from exc
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise McParseError(f"invalid JSON in .mc file {path}: {exc}") from exc
    raise McParseError(
        f"parse_mc expects a path or dict, got {type(path_or_dict).__name__}"
    )


def _parse_meta(raw: Any) -> ChartMeta:
    if not isinstance(raw, dict):
        raise McParseError("chart 'meta' must be an object")
    return ChartMeta(
        chart_id=raw.get("id"),
        creator=raw.get("creator"),
        version=raw.get("version"),
        mode=raw.get("mode"),
        mode_ext=_parse_mode_ext(raw.get("mode_ext")),
        song=_parse_song(raw.get("song")),
        background=raw.get("background"),
        preview=raw.get("preview"),
        aimode=raw.get("aimode"),
    )


def _parse_song(raw: Any) -> SongMeta:
    song = raw if isinstance(raw, dict) else {}
    bpm = song.get("bpm")
    return SongMeta(
        song_id=song.get("id"),
        title=song.get("title"),
        artist=song.get("artist"),
        file=song.get("file"),
        bpm=float(bpm) if bpm is not None else None,
    )


def _parse_mode_ext(raw: Any) -> ModeExt | None:
    if not isinstance(raw, dict):
        return None
    return ModeExt(
        column=raw.get("column"),
        bar_begin=raw.get("bar_begin"),
        speed=raw.get("speed"),
    )


def _parse_time_map(raw: Any) -> tuple[TimePoint, ...]:
    if not isinstance(raw, list) or not raw:
        raise McParseError("chart 'time' must be a non-empty array")
    points: list[TimePoint] = []
    for i, entry in enumerate(raw):
        if not isinstance(entry, dict):
            raise McParseError(f"time[{i}] must be an object")
        try:
            beat = beat_to_float(entry["beat"])
        except (ValueError, KeyError, TypeError) as exc:
            raise McParseError(f"time[{i}] has invalid beat {entry.get('beat')!r}: {exc}") from exc
        bpm = entry.get("bpm")
        if not isinstance(bpm, (int, float)) or isinstance(bpm, bool) or bpm <= 0:
            raise McParseError(f"time[{i}] bpm must be a positive number, got {bpm!r}")
        points.append(TimePoint(beat=beat, bpm=float(bpm), delay=float(entry.get("delay", 0.0))))
    points.sort(key=lambda tp: tp.beat)
    return tuple(points)


def _parse_notes(raw: Any) -> tuple[tuple[GameplayNote, ...], AudioNote]:
    if not isinstance(raw, list) or not raw:
        raise McParseError("chart 'note' must be a non-empty array")
    gameplay: list[GameplayNote] = []
    audio: list[AudioNote] = []
    for i, entry in enumerate(raw):
        if not isinstance(entry, dict):
            raise McParseError(f"note[{i}] must be an object")
        if entry.get("type") == 1:
            audio.append(_parse_audio_note(entry, i))
        else:
            gameplay.append(_parse_gameplay_note(entry, i))
    if len(audio) != 1:
        raise McParseError(f"expected exactly 1 audio (type:1) note, got {len(audio)}")
    gameplay.sort(key=lambda note: note.beat_float)
    return tuple(gameplay), audio[0]


def _parse_audio_note(entry: dict[str, Any], index: int) -> AudioNote:
    sound = entry.get("sound")
    if not isinstance(sound, str):
        raise McParseError(f"note[{index}] (audio) is missing a 'sound' string")
    return AudioNote(sound=sound, offset=entry.get("offset"), vol=entry.get("vol"))


def _parse_gameplay_note(entry: dict[str, Any], index: int) -> GameplayNote:
    try:
        beat = tuple(entry["beat"])
        beat_float = beat_to_float(beat)
    except (ValueError, KeyError, TypeError) as exc:
        raise McParseError(f"note[{index}] has invalid beat {entry.get('beat')!r}: {exc}") from exc
    column = entry.get("column")
    if (
        not isinstance(column, int)
        or isinstance(column, bool)
        or not _COLUMN_MIN <= column <= _COLUMN_MAX
    ):
        raise McParseError(
            f"note[{index}] column must be an int in "
            f"{_COLUMN_MIN}..{_COLUMN_MAX}, got {column!r}"
        )
    endbeat = None
    endbeat_float = None
    if "endbeat" in entry:
        try:
            endbeat = tuple(entry["endbeat"])
            endbeat_float = beat_to_float(endbeat)
        except (ValueError, KeyError, TypeError) as exc:
            raise McParseError(
                f"note[{index}] has invalid endbeat {entry.get('endbeat')!r}: {exc}"
            ) from exc
        if endbeat_float < beat_float:
            raise McParseError(f"note[{index}] endbeat {endbeat} is before its beat {beat}")
    # The corpus 'dir' attribute (slide/scroll) is intentionally ignored here:
    # classic Wulifang notes are Tap/Hold/multi-press only, and dir does not
    # change the note count.
    return GameplayNote(
        beat=beat,
        beat_float=beat_float,
        column=column,
        endbeat=endbeat,
        endbeat_float=endbeat_float,
    )

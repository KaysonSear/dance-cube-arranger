"""The production `.mcz` exporter — compose audio encode + cover + `.mc` build + packaging.

:func:`export_chart` is the export capstone (Task 24): given generated note events,
chart metadata, a source audio file, and a cover image, it produces a valid `.mcz`
(a ZIP of {chart.mc, audio.ogg, cover.jpg}) ready to import into Malody V. It reuses
the existing pieces rather than reimplementing any of them:

* :func:`src.export.audio.encode_ogg` — source audio -> OGG vorbis 44.1 kHz (ffmpeg).
* :func:`src.export.audio.normalize_cover` — source image -> RGB JPEG (Pillow).
* :func:`src.export.mc_writer.build_mc` — the mode:9 corpus-template `.mc` dict
  (meta + trailing type:1 audio note carrying ``sound`` + ``offset``; no ``dir``).
* :func:`src.export.mcz.package_mcz` — atomic ZIP write.

The intermediate OGG/JPEG are built in a throwaway temp dir (auto-removed); only the
final atomic `.mcz` is written to ``out_mcz``.
"""

from __future__ import annotations

import json
import tempfile
from collections.abc import Sequence
from pathlib import Path

from .audio import encode_ogg, normalize_cover
from .mc_writer import ChartMeta, NoteEvent, build_mc
from .mcz import package_mcz

__all__ = ["AUDIO_NAME", "CHART_NAME", "COVER_NAME", "export_chart", "export_charts"]

CHART_NAME = "chart.mc"
AUDIO_NAME = "audio.ogg"
COVER_NAME = "cover.jpg"


def export_chart(
    notes: Sequence[NoteEvent],
    meta: ChartMeta,
    audio_src: Path | str,
    cover_src: Path | str,
    out_mcz: Path | str,
    *,
    offset_ms: int = 0,
) -> Path:
    """Export ``notes`` + ``meta`` + audio + cover to an ``.mcz`` at ``out_mcz``.

    The audio is re-encoded to ``audio.ogg`` (OGG vorbis 44.1 kHz), the cover to
    ``cover.jpg`` (RGB JPEG), and the `.mc` references those names via ``meta.song.file``
    / the trailing type:1 audio note and ``meta.background``. ``offset_ms`` is Malody's
    signed audio shift (``audio_time = chart_time - offset_ms/1000``); the write->read
    round-trip preserves it exactly, per :mod:`src.export.offset`.
    Returns the output ``Path``.
    """
    out = Path(out_mcz)
    with tempfile.TemporaryDirectory() as work:
        work_dir = Path(work)
        audio_ogg = encode_ogg(audio_src, work_dir / AUDIO_NAME)
        cover_jpg = normalize_cover(cover_src, work_dir / COVER_NAME)
        mc = build_mc(meta, notes, AUDIO_NAME, audio_offset_ms=offset_ms)
        entries = {
            CHART_NAME: json.dumps(mc, ensure_ascii=False, indent=2).encode("utf-8"),
            AUDIO_NAME: audio_ogg.read_bytes(),
            COVER_NAME: cover_jpg.read_bytes(),
        }
        package_mcz(out, entries)
    return out


def export_charts(
    charts: Sequence[tuple[ChartMeta, Sequence[NoteEvent]]],
    audio_src: Path | str,
    cover_src: Path | str,
    out_mcz: Path | str,
    *,
    offset_ms: int = 0,
    chart_names: Sequence[str] | None = None,
) -> Path:
    """Export multiple charts sharing ONE audio + cover into a single ``.mcz`` (一曲多谱).

    Each ``(meta, notes)`` becomes a distinct ``v{i}.mc`` entry referencing the shared
    ``audio.ogg``; charts whose ``meta.song`` (id/title/artist/file/bpm) match group as one
    song in Malody and are distinguished by their ``version`` label. So the user imports one
    file and sees every variant as a selectable difficulty. Returns the output ``Path``.
    """
    if not charts:
        raise ValueError("charts must contain at least one (meta, notes) pair")
    names = list(chart_names) if chart_names is not None else [
        f"v{i}.mc" for i in range(len(charts))
    ]
    if len(names) != len(charts):
        raise ValueError("chart_names must contain one chart name per chart")
    invalid = '<>:"/\\|?*'
    reserved = {"CON", "PRN", "AUX", "NUL"} | {
        f"{prefix}{i}" for prefix in ("COM", "LPT") for i in range(1, 10)
    }
    valid = all(
        name.lower().endswith(".mc")
        and name[:-3]
        and name == name.rstrip()
        and not name.endswith(".")
        and not any(char in name for char in invalid)
        and not any(ord(char) < 32 for char in name)
        and name[:-3].split(".")[0].upper() not in reserved
        for name in names
    )
    if len({name.casefold() for name in names}) != len(names) or not valid:
        raise ValueError("each chart name must be a unique portable safe .mc basename")
    out = Path(out_mcz)
    with tempfile.TemporaryDirectory() as work:
        work_dir = Path(work)
        audio_ogg = encode_ogg(audio_src, work_dir / AUDIO_NAME)
        cover_jpg = normalize_cover(cover_src, work_dir / COVER_NAME)
        entries: dict[str, bytes] = {
            AUDIO_NAME: audio_ogg.read_bytes(),
            COVER_NAME: cover_jpg.read_bytes(),
        }
        for name, (meta, notes) in zip(names, charts, strict=True):
            mc = build_mc(meta, notes, AUDIO_NAME, audio_offset_ms=offset_ms)
            entries[name] = json.dumps(mc, ensure_ascii=False, indent=2).encode("utf-8")
        package_mcz(out, entries)
    return out

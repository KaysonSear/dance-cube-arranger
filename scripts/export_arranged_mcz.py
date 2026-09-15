r"""Export an arranged .mc (from arranger-ui) into a Malody V .mcz.

Reuses the proven export chain (ffmpeg OGG + JPEG cover + zip, via
``src.export.exporter.export_chart``), mirroring the arranged chart's own meta and
writing the audio-note offset back VERBATIM (missing offset -> 0 + stderr warning).
Prints ONE JSON line to stdout — the contract for arranger-ui's ``/api/export/mcz``
route, which spawns this script with cwd = repo root and RELATIVE paths.

Run::

    ./.venv311/Scripts/python.exe scripts/export_arranged_mcz.py \
        --mc artifacts/arranger/WDA_arranged_manual.mc \
        --out artifacts/arranger/WDA_arranged_manual.mcz
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))
_PROJECT_ROOT = _SCRIPTS_DIR.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from bridge.audio import encode_ogg, normalize_cover  # noqa: E402
from bridge.exporter import export_chart  # noqa: E402
from bridge.mc_writer import ChartMeta, NoteEvent  # noqa: E402
from bridge.mcz import package_mcz  # noqa: E402
from bridge.mc_parser import parse_mc  # noqa: E402

AUDIO_EXTS = {".mp3", ".ogg", ".wav"}
COVER_EXTS = {".jpg", ".jpeg", ".png"}
_DEFAULT_ASSETS_DIR = _PROJECT_ROOT / "WDA"
_WINDOWS_RESERVED = {
    "CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}


def _portable_mc_name(raw: object) -> str:
    if not isinstance(raw, str) or not raw:
        raise ValueError("包内谱面名称不能为空")
    if raw != raw.rstrip() or raw.endswith("."):
        raise ValueError(f"文件名不能以点或空格结尾: {raw!r}")
    if any(ch in raw for ch in '\\/<>:"|?*') or any(ord(ch) < 32 for ch in raw):
        raise ValueError(f"包内谱面名称包含非法字符: {raw!r}")
    name = raw if raw.lower().endswith(".mc") else f"{raw}.mc"
    stem = name[:-3]
    if not stem or stem.split(".")[0].upper() in _WINDOWS_RESERVED:
        raise ValueError(f"Windows 保留文件名: {raw!r}")
    return name


def _pick_asset(folder: Path, exts: set[str], kind: str) -> Path:
    """ingest-style discovery: exactly one candidate file, never guess among many."""
    candidates = sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in exts)
    if not candidates:
        raise FileNotFoundError(f"no {kind} file in {folder} (expected one of {sorted(exts)})")
    if len(candidates) > 1:
        raise ValueError(f"ambiguous {kind} files in {folder}: {[p.name for p in candidates]}")
    return candidates[0]


def run(
    mc_path: str | Path,
    audio: str | Path | None = None,
    cover: str | Path | None = None,
    out: str | Path | None = None,
) -> dict:
    mc_file = Path(mc_path)
    chart = parse_mc(str(mc_file))

    audio_src = Path(audio) if audio else _pick_asset(_DEFAULT_ASSETS_DIR, AUDIO_EXTS, "audio")
    cover_src = Path(cover) if cover else _pick_asset(_DEFAULT_ASSETS_DIR, COVER_EXTS, "cover")
    out_mcz = Path(out) if out else mc_file.with_suffix(".mcz")

    offset = chart.audio_note.offset if chart.audio_note is not None else None
    if offset is None:
        print(
            "WARNING: arranged .mc has no audio-note offset; exporting offset=0 "
            "(check sync by ear in Malody V)",
            file=sys.stderr,
        )
        offset = 0

    bpm = float(chart.time_map[0].bpm) if chart.time_map else float(chart.meta.song.bpm or 120.0)
    m = chart.meta
    bar_begin = m.mode_ext.bar_begin if m.mode_ext and m.mode_ext.bar_begin is not None else 0
    meta = ChartMeta(
        chart_id=0,
        creator=m.creator or "arranger-ui",
        version=m.version or "Arranged",
        title=m.song.title or mc_file.stem,
        artist=m.song.artist or "",
        bpm=bpm,
        cover_file="cover.jpg",
        song_id=1,
        preview_ms=0,
        bar_begin=bar_begin,
        speed=0,
    )
    events = [
        NoteEvent(beat=n.beat, column=n.column, endbeat=n.endbeat) for n in chart.gameplay_notes
    ]
    out_path = export_chart(events, meta, audio_src, cover_src, out_mcz, offset_ms=offset)
    return {
        "ok": True,
        "out": str(out_path),
        "n_notes": len(events),
        "offset": offset,
        "bpm": bpm,
    }


def run_manifest(manifest_path: str | Path) -> dict:
    """Package multiple already-built editor charts without leaving intermediate `.mc` files."""
    manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    charts = manifest.get("charts")
    if not isinstance(charts, list) or not charts:
        raise ValueError("manifest.charts 必须是非空数组")
    audio_src = Path(manifest["audio"])
    cover_src = Path(manifest["cover"])
    out_mcz = Path(manifest["out"])
    names = [_portable_mc_name(item.get("name")) for item in charts]
    if len({name.casefold() for name in names}) != len(names):
        raise ValueError("包内谱面名称大小写重复")

    entries: dict[str, bytes] = {}
    reports: list[dict] = []
    with tempfile.TemporaryDirectory() as work:
        work_dir = Path(work)
        audio_ogg = encode_ogg(audio_src, work_dir / "audio.ogg")
        cover_jpg = normalize_cover(cover_src, work_dir / "cover.jpg")
        entries["audio.ogg"] = audio_ogg.read_bytes()
        entries["cover.jpg"] = cover_jpg.read_bytes()
        for item, name in zip(charts, names, strict=True):
            mc_path = Path(item["path"])
            parsed = parse_mc(str(mc_path))
            if parsed.meta.mode != 9:
                raise ValueError(f"仅支持 mode:9: {name}")
            raw = json.loads(mc_path.read_text(encoding="utf-8"))
            meta = raw.setdefault("meta", {})
            song = meta.setdefault("song", {})
            song["file"] = "audio.ogg"
            meta["background"] = "cover.jpg"
            for note in raw.get("note", []):
                if isinstance(note, dict) and note.get("type") == 1:
                    note["sound"] = "audio.ogg"
            entries[name] = json.dumps(raw, ensure_ascii=False, indent=2).encode("utf-8")
            reports.append({"name": name, "n_notes": len(parsed.gameplay_notes)})
        package_mcz(out_mcz, entries)
    return {"ok": True, "out": str(out_mcz), "charts": reports}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export an arranged .mc into a Malody V .mcz.")
    parser.add_argument("--mc", required=False, help="arranged .mc path")
    parser.add_argument("--manifest", default=None, help="multi-chart export manifest JSON")
    parser.add_argument(
        "--audio", default=None, help="audio source (default: the one audio file in WDA/)"
    )
    parser.add_argument(
        "--cover", default=None, help="cover source (default: the one image file in WDA/)"
    )
    parser.add_argument("--out", default=None, help="output .mcz (default: <mc>.mcz)")
    args = parser.parse_args(argv)
    try:
        if args.manifest:
            report = run_manifest(args.manifest)
        elif args.mc:
            report = run(mc_path=args.mc, audio=args.audio, cover=args.cover, out=args.out)
        else:
            raise ValueError("--mc 或 --manifest 必须提供一个")
    except Exception as e:  # noqa: BLE001 — 单行 JSON 错误契约给 Node 路由解析
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}))
        return 1
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

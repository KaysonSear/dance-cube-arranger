r"""Export an arranged .mc (from arranger-ui) into a Malody V .mcz.

Packages the original chart with normalized OGG audio and a JPEG cover. For a
single-chart export, a missing audio offset defaults to 0 with a stderr warning.
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
from bridge.exporter import AUDIO_NAME, CHART_NAME, COVER_NAME  # noqa: E402
from bridge.mcz import package_mcz  # noqa: E402
from bridge.mc_parser import Chart, parse_mc  # noqa: E402

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


def _chart_entry(mc_path: Path, *, default_offset: bool = False) -> tuple[bytes, Chart]:
    raw = json.loads(mc_path.read_text(encoding="utf-8-sig"))
    chart = parse_mc(raw)
    if chart.meta.mode != 9:
        raise ValueError(f"仅支持 mode:9: {mc_path.name}")
    meta = raw["meta"]
    if not isinstance(meta.get("song"), dict):
        meta["song"] = {}
    meta["song"]["file"] = AUDIO_NAME
    meta["background"] = COVER_NAME
    if "cover" in meta:
        meta["cover"] = COVER_NAME
    audio_note = next(note for note in raw["note"] if note.get("type") == 1)
    audio_note["sound"] = AUDIO_NAME
    if default_offset and chart.audio_note.offset is None:
        print(
            "WARNING: arranged .mc has no audio-note offset; exporting offset=0 "
            "(check sync by ear in Malody V)",
            file=sys.stderr,
        )
        audio_note["offset"] = 0
    return json.dumps(raw, ensure_ascii=False, indent=2).encode("utf-8"), chart


def _package_with_assets(entries: dict[str, bytes], audio: Path, cover: Path, out: Path) -> None:
    with tempfile.TemporaryDirectory() as work:
        work_dir = Path(work)
        entries[AUDIO_NAME] = encode_ogg(audio, work_dir / AUDIO_NAME).read_bytes()
        entries[COVER_NAME] = normalize_cover(cover, work_dir / COVER_NAME).read_bytes()
        package_mcz(out, entries)


def run(
    mc_path: str | Path,
    audio: str | Path | None = None,
    cover: str | Path | None = None,
    out: str | Path | None = None,
) -> dict:
    mc_file = Path(mc_path)
    entry, chart = _chart_entry(mc_file, default_offset=True)

    audio_src = Path(audio) if audio else _pick_asset(_DEFAULT_ASSETS_DIR, AUDIO_EXTS, "audio")
    cover_src = Path(cover) if cover else _pick_asset(_DEFAULT_ASSETS_DIR, COVER_EXTS, "cover")
    out_mcz = Path(out) if out else mc_file.with_suffix(".mcz")

    _package_with_assets({CHART_NAME: entry}, audio_src, cover_src, out_mcz)
    return {
        "ok": True,
        "out": str(out_mcz),
        "n_notes": len(chart.gameplay_notes),
        "offset": chart.audio_note.offset if chart.audio_note.offset is not None else 0,
        "bpm": chart.time_map[0].bpm,
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
    for item, name in zip(charts, names, strict=True):
        entries[name], parsed = _chart_entry(Path(item["path"]))
        reports.append({"name": name, "n_notes": len(parsed.gameplay_notes)})
    _package_with_assets(entries, audio_src, cover_src, out_mcz)
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

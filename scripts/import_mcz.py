r"""Unpack a Malody `.mcz` into an arranger-ui import folder.

A `.mcz` is a ZIP of `{chart.mc, audio.ogg, cover.jpg}` (names vary). Malody packages are often
**一曲多谱** — one song plus MANY `.mc` charts — so every `.mc` is extracted and reported; the
arranger's package switcher then lists them as sibling charts sharing one audio/cover.

Extracts **flattened** (directory levels dropped, filenames sanitized, collisions suffixed),
validates each chart with the repo parser and **drops non-mode:9 charts** (Malody packages often
bundle key/catch modes, which would crash the browser parser), then prints ONE JSON line to
stdout — the contract for arranger-ui's `/api/import`, which spawns this with cwd = repo root
and RELATIVE paths.

Run::

    ./.venv311/Scripts/python.exe scripts/import_mcz.py \
        --mcz artifacts/arranger/imports/tmp/song.mcz \
        --out-dir artifacts/arranger/imports/song-0724
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))
_PROJECT_ROOT = _SCRIPTS_DIR.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from bridge.mc_parser import parse_mc  # noqa: E402

AUDIO_EXTS = {".ogg", ".mp3", ".wav"}
COVER_EXTS = {".jpg", ".jpeg", ".png"}
RLHF_MANIFEST = "rlhf-round.v1.json"
RLHF_MANIFEST_MAX = 512 * 1024
_UNSAFE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _sanitize(name: str) -> str:
    """Flatten safely while preserving Unicode chart names."""
    base = Path(name.replace("\\", "/")).name
    safe = _UNSAFE.sub("_", base).lstrip(".").rstrip(" .")
    if len(safe) > 120:
        ext = Path(safe).suffix
        safe = safe[: 120 - len(ext)] + ext
    return safe or "file"


def _unique(name: str, used: set[str]) -> str:
    """Flattening can collide (`a/x.mc` + `b/x.mc`) — suffix the later ones."""
    if name not in used:
        used.add(name)
        return name
    stem, ext = Path(name).stem, Path(name).suffix
    for i in range(2, 100):
        cand = f"{stem}_{i}{ext}"
        if cand not in used:
            used.add(cand)
            return cand
    raise ValueError(f"文件名冲突过多: {name}")


def _usable(names: list[str], exts: set[str]) -> list[str]:
    """Sorted entries matching `exts`, skipping __MACOSX junk."""
    return sorted(
        n
        for n in names
        if Path(n).suffix.lower() in exts
        and not n.startswith("__MACOSX/")
        and not Path(n).name.startswith("._")
    )


def run(mcz_path: str | Path, out_dir: str | Path) -> dict:
    mcz = Path(mcz_path)
    out = Path(out_dir)

    if not zipfile.is_zipfile(mcz):
        raise ValueError(f"不是有效的 .mcz(ZIP)文件: {mcz.name}")

    with zipfile.ZipFile(mcz) as zf:
        bad = zf.testzip()
        if bad is not None:
            raise ValueError(f".mcz 内条目损坏: {bad}")
        names = [n for n in zf.namelist() if not n.endswith("/")]

        mc_names = _usable(names, {".mc"})
        if not mc_names:
            raise ValueError(".mcz 内没有 .mc 谱面文件")
        audio_names = _usable(names, AUDIO_EXTS)
        cover_names = _usable(names, COVER_EXTS)

        out.mkdir(parents=True, exist_ok=True)
        used: set[str] = set()

        def extract(entry: str) -> str:
            target = out / _unique(_sanitize(entry), used)
            with zf.open(entry) as src, open(target, "wb") as dst:
                dst.write(src.read())
            return str(target)

        mc_pairs = [(name, extract(name)) for name in mc_names]
        mc_outs = [target for _entry, target in mc_pairs]
        audio_outs = [extract(name) for name in audio_names]
        cover_outs = [extract(name) for name in cover_names]
        audio_out = audio_outs[0] if audio_outs else None
        cover_out = cover_outs[0] if cover_outs else None

        rlhf_round = None
        if RLHF_MANIFEST in names:
            raw_manifest = zf.read(RLHF_MANIFEST)
            if len(raw_manifest) > RLHF_MANIFEST_MAX:
                raise ValueError("RLHF 清单过大")
            try:
                rlhf_round = json.loads(raw_manifest)
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError("RLHF 清单不是有效 JSON") from exc
            if (
                rlhf_round.get("schema") != "rlhf-round-v1"
                or not isinstance(rlhf_round.get("round_id"), str)
                or not isinstance(rlhf_round.get("candidates"), list)
            ):
                raise ValueError("RLHF 清单 schema 无效")
            if len(rlhf_round["candidates"]) > 26:
                raise ValueError("RLHF 候选数量超过 26")
            extracted_by_entry = dict(mc_pairs)
            for candidate in rlhf_round["candidates"]:
                entry = candidate.get("archive_entry")
                if entry not in extracted_by_entry:
                    raise ValueError(f"RLHF 清单引用不存在的谱面: {entry}")
                actual = hashlib.sha256(zf.read(entry)).hexdigest()
                if actual != candidate.get("chart_sha256"):
                    raise ValueError(f"RLHF 候选 SHA-256 不匹配: {entry}")
                candidate["src_name"] = Path(extracted_by_entry[entry]).name

    # 逐张校验;非 mode:9(Malody 包常混 key/catch 谱)删除并记录 —— 留着会让浏览器解析器崩
    charts: list[dict] = []
    skipped: list[dict] = []
    for mc_out in mc_outs:
        try:
            chart = parse_mc(mc_out)
        except Exception as e:  # noqa: BLE001 — 单谱失败不该毁掉整包
            Path(mc_out).unlink(missing_ok=True)
            skipped.append({"name": Path(mc_out).name, "reason": f"解析失败: {e}"})
            continue
        if chart.meta.mode != 9:
            Path(mc_out).unlink(missing_ok=True)
            skipped.append({"name": Path(mc_out).name, "reason": f"mode={chart.meta.mode}"})
            continue
        charts.append(
            {
                "path": mc_out,
                "version": chart.meta.version,
                "n_notes": len(chart.gameplay_notes),
                "bpm": float(chart.time_map[0].bpm) if chart.time_map else None,
                "offset": chart.audio_note.offset if chart.audio_note else None,
                "title": chart.meta.song.title,
                "artist": chart.meta.song.artist,
            }
        )

    if not charts:
        raise ValueError("仅支持 mode:9(Cube)谱面,该 .mcz 内无 mode:9 谱面")
    if rlhf_round is not None:
        valid_names = {Path(chart["path"]).name for chart in charts}
        expected_names = {candidate["src_name"] for candidate in rlhf_round["candidates"]}
        if expected_names != valid_names:
            raise ValueError("RLHF 清单候选与有效 mode:9 谱面不一致")
        (out / RLHF_MANIFEST).write_text(
            json.dumps(rlhf_round, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    primary = charts[0]
    # 顶层字段描述 primary,保持与单谱时代的返回值向后兼容(既有路由/测试不受影响)
    return {
        "ok": True,
        "mc": primary["path"],
        "primary": primary["path"],
        "mcs": [c["path"] for c in charts],
        "charts": charts,
        "audio": audio_out,
        "cover": cover_out,
        "audios": audio_outs,
        "covers": cover_outs,
        "n_notes": primary["n_notes"],
        "bpm": primary["bpm"],
        "offset": primary["offset"],
        "title": primary["title"],
        "artist": primary["artist"],
        "skipped": skipped,
        "rlhf_round": rlhf_round,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Unpack a .mcz into an import folder.")
    parser.add_argument("--mcz", required=True, help=".mcz path")
    parser.add_argument("--out-dir", required=True, help="destination folder")
    args = parser.parse_args(argv)
    try:
        report = run(mcz_path=args.mcz, out_dir=args.out_dir)
    except Exception as e:  # noqa: BLE001 — 单行 JSON 错误契约给 Node 路由解析
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}, ensure_ascii=False))
        return 1
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

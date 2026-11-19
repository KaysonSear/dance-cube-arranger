import copy
import io
import json
import shutil
import sys
import tempfile
import unittest
import zipfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import export_arranged_mcz as exporter
import import_mcz as importer


def chart(version="Normal"):
    return {
        "meta": {
            "id": 12, "mode": 9, "version": version, "preview": 3200,
            "background": "original.png", "cover": "original.png",
            "song": {"id": 81, "title": "曲名", "file": "original.wav"},
        },
        "time": [
            {"beat": [0, 0, 1], "bpm": 120, "delay": 0},
            {"beat": [4, 0, 1], "bpm": 240, "delay": 0},
        ],
        "note": [
            {"beat": [8, 0, 1], "column": 2, "endbeat": [9, 0, 1]},
            {"beat": [0, 0, 1], "type": 1, "sound": "original.wav", "offset": -22, "vol": 85},
        ],
        "extra": {"custom": "原样保留"},
    }


class MczBridgeTests(unittest.TestCase):
    def test_import_preserves_bom_charts_and_case_collisions_after_flattening(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.mcz"
            entries = ["a/Normal.mc", "b/Normal_2.mc", "c/normal.mc"]
            with zipfile.ZipFile(source, "w") as archive:
                for entry in entries:
                    archive.writestr(entry, json.dumps(chart(entry)).encode("utf-8-sig"))

            report = importer.run(source, Path(tmp) / "workspace")
            paths = [Path(name) for name in report["mcs"]]
            self.assertEqual([p.name for p in paths], ["Normal.mc", "Normal_2.mc", "normal_3.mc"])
            for entry, path in zip(entries, paths, strict=True):
                self.assertEqual(json.loads(path.read_bytes())["meta"]["version"], entry)

    def test_cli_preserves_the_chart_in_single_and_manifest_exports(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.mc"
            audio = root / "original.wav"
            cover = root / "original.png"
            audio.write_bytes(b"test audio")
            cover.write_bytes(b"test cover")
            for single, has_offset in [(True, True), (True, False), (False, True), (False, False)]:
                with self.subTest(single=single, has_offset=has_offset):
                    raw = chart()
                    if not has_offset:
                        del raw["note"][-1]["offset"]
                    source.write_text(json.dumps(raw), encoding="utf-8-sig")
                    output = root / "result.mcz"
                    if single:
                        name = "chart.mc"
                        args = ["--mc", str(source), "--audio", str(audio),
                                "--cover", str(cover), "--out", str(output)]
                    else:
                        name = "困难.mc"
                        manifest = root / "manifest.json"
                        manifest.write_text(json.dumps({
                            "charts": [{"path": str(source), "name": name}],
                            "audio": str(audio), "cover": str(cover), "out": str(output),
                        }), encoding="utf-8")
                        args = ["--manifest", str(manifest)]
                    stdout, stderr = io.StringIO(), io.StringIO()
                    with (
                        patch.object(exporter, "encode_ogg", side_effect=shutil.copyfile),
                        patch.object(exporter, "normalize_cover", side_effect=shutil.copyfile),
                        redirect_stdout(stdout), redirect_stderr(stderr),
                    ):
                        code = exporter.main(args)
                    self.assertEqual(code, 0, stdout.getvalue())
                    report = json.loads(stdout.getvalue())
                    self.assertTrue(report["ok"])
                    if single:
                        self.assertEqual(report["n_notes"], 1)
                        self.assertEqual(report["bpm"], 120)
                        self.assertEqual(report["offset"], -22 if has_offset else 0)
                    self.assertEqual(bool(stderr.getvalue()), single and not has_offset)
                    expected = copy.deepcopy(raw)
                    expected["meta"]["song"]["file"] = "audio.ogg"
                    expected["meta"]["background"] = expected["meta"]["cover"] = "cover.jpg"
                    expected["note"][-1]["sound"] = "audio.ogg"
                    if single and not has_offset:
                        expected["note"][-1]["offset"] = 0
                    with zipfile.ZipFile(output) as archive:
                        self.assertEqual(set(archive.namelist()), {name, "audio.ogg", "cover.jpg"})
                        self.assertEqual(json.loads(archive.read(name)), expected)

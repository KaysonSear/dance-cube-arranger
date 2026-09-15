"""Normalize media for `.mcz` packaging: OGG audio + JPEG cover using ffmpeg."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

__all__ = ["encode_ogg", "normalize_cover"]

_TARGET_SAMPLE_RATE = 44100


def _find_executable(name: str) -> str:
    found = shutil.which(name)
    if found:
        return found
    repo_root = Path(__file__).resolve().parent.parent.parent
    candidate = repo_root / "bin" / (name if name.endswith(".exe") else f"{name}.exe")
    if candidate.is_file():
        return str(candidate)
    return name


def encode_ogg(src_audio_path: Path | str, out_ogg_path: Path | str) -> Path:
    src = Path(src_audio_path)
    out = Path(out_ogg_path)
    if not src.is_file():
        raise FileNotFoundError(f"source audio not found: {src}")

    out.parent.mkdir(parents=True, exist_ok=True)

    if src.suffix.lower() == ".ogg":
        shutil.copyfile(src, out)
        _verify_ogg(out)
        return out

    command = [
        _find_executable("ffmpeg"),
        "-y",
        "-loglevel",
        "error",
        "-i",
        str(src),
        "-c:a",
        "libvorbis",
        "-ar",
        str(_TARGET_SAMPLE_RATE),
        str(out),
    ]
    result = subprocess.run(command, capture_output=True)
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"ffmpeg failed to encode {src} (exit {result.returncode}): {stderr}")

    _verify_ogg(out)
    return out


def _verify_ogg(path: Path) -> None:
    if not path.is_file() or path.stat().st_size == 0:
        raise ValueError(f"encoded audio is missing or empty: {path}")
    command = [
        _find_executable("ffprobe"),
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=codec_name",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode == 0:
            codec = result.stdout.strip().lower()
            if codec and codec != "vorbis":
                raise ValueError(f"encoded audio codec is not vorbis: {codec} in {path}")
            return
    except FileNotFoundError:
        pass

    with open(path, "rb") as f:
        header = f.read(4)
        if header != b"OggS":
            raise ValueError(f"encoded audio does not have Ogg header: {path}")


def normalize_cover(src_image_path: Path | str, out_jpg_path: Path | str) -> Path:
    src = Path(src_image_path)
    out = Path(out_jpg_path)
    if not src.is_file():
        raise FileNotFoundError(f"source image not found: {src}")

    out.parent.mkdir(parents=True, exist_ok=True)
    if src.suffix.lower() in {".jpg", ".jpeg"}:
        shutil.copyfile(src, out)
        return out

    command = [
        _find_executable("ffmpeg"),
        "-y",
        "-loglevel",
        "error",
        "-i",
        str(src),
        "-q:v",
        "2",
        str(out),
    ]
    result = subprocess.run(command, capture_output=True)
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"ffmpeg failed to convert cover {src} (exit {result.returncode}): {stderr}")
    return out

"""Package files into a Malody V `.mcz` archive (a ZIP renamed to `.mcz`).

Writes are atomic: the archive is built in a temporary file in the destination
directory, then moved into place with ``os.replace`` so a rebuild never leaves a
half-written or stale artifact at the final path.
"""

from __future__ import annotations

import os
import zipfile
from collections.abc import Mapping
from pathlib import Path

__all__ = ["package_mcz"]


def package_mcz(output_path: Path | str, entries: Mapping[str, bytes]) -> None:
    """Write ``entries`` (archive name -> bytes) to a ZIP at ``output_path``.

    Raises ``ValueError`` if ``entries`` is empty. Parent directories are
    created as needed. The write is atomic across a rebuild.
    """
    if not entries:
        raise ValueError("entries must contain at least one file to package")

    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = destination.with_name(destination.name + ".tmp")

    try:
        with zipfile.ZipFile(tmp_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, data in entries.items():
                archive.writestr(name, data)
        os.replace(tmp_path, destination)  # atomic on the same filesystem
    finally:
        if tmp_path.exists():  # only present if the build failed mid-write
            tmp_path.unlink()

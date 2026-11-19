"""Remove one chart while preserving the other entries in a Malody archive."""
import copy
import json
import shutil
import sys
import zipfile
from pathlib import Path

# Windows embeddable Python omits the script directory from sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from import_mcz import RLHF_MANIFEST, _sanitize, _unique, _usable


def remove_chart(source, destination, filename, known_entry):
    with zipfile.ZipFile(source) as archive:
        used = set()
        entries = {_unique(_sanitize(entry), used): entry
                   for entry in _usable(archive.namelist(), {".mc"})}
        target = known_entry or entries.get(filename)
        if target and archive.namelist().count(target) != 1:
            raise ValueError("Chart entry missing or ambiguous: " + target)
        if target:
            with zipfile.ZipFile(destination, "x") as output:
                output.comment = archive.comment
                for item in archive.infolist():
                    if item.filename == target:
                        continue
                    if item.filename == RLHF_MANIFEST:
                        manifest = json.loads(archive.read(item))
                        manifest["candidates"] = [c for c in manifest["candidates"]
                                                  if c["archive_entry"] != target]
                        output.writestr(item, json.dumps(manifest, ensure_ascii=False).encode())
                    else:
                        with archive.open(item) as reader, output.open(copy.copy(item), "w") as writer:
                            shutil.copyfileobj(reader, writer)
        return entries


if __name__ == "__main__":
    print(json.dumps(remove_chart(*sys.argv[1:]), ensure_ascii=True))

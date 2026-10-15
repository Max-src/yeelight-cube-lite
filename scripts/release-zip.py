"""Build and check yeelight_cube.zip, the release asset HACS installs.

hacs.json sets zip_release + filename, so HACS downloads this file from the
release and extracts it straight into custom_components/yeelight_cube: the zip
holds the files git tracks in that folder, at its root (manifest.json at the
top). The release workflow (.github/workflows/release.yaml) runs this script;
run it the same way locally (docs/RELEASING.md):

    python scripts/release-zip.py [--tag vX.Y.Z] [--ref REF] [--output FILE]

Exits non-zero, without leaving a zip behind, if anything does not match.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import zipfile
from pathlib import Path

INTEGRATION = "custom_components/yeelight_cube"
ASSET = "yeelight_cube.zip"
# Files the integration cannot run without (a sanity check on top of the
# exact comparison with git).
REQUIRED = ("manifest.json", "__init__.py", "services.yaml", "www/lib/lit-all.js")


def git(*args: str) -> bytes:
    return subprocess.run(["git", *args], check=True, capture_output=True).stdout


def tracked_files(ref: str) -> list[str]:
    """The files git tracks in the integration folder at ``ref``, relative
    to it."""
    out = git("ls-tree", "-r", "--name-only", "-z", ref, "--", f"{INTEGRATION}/")
    prefix = f"{INTEGRATION}/"
    return sorted(p[len(prefix):] for p in out.decode().split("\0") if p)


def build(ref: str, output: Path) -> None:
    # autocrlf off: the committed bytes (LF), on Windows checkouts as on CI.
    git(
        "-c", "core.autocrlf=false",
        "archive", "--format=zip", f"--output={output}", f"{ref}:{INTEGRATION}",
    )


def check(output: Path, ref: str, tag: str | None) -> list[str]:
    errors: list[str] = []
    expected = tracked_files(ref)
    with zipfile.ZipFile(output) as archive:
        if (broken := archive.testzip()) is not None:
            return [f"corrupt entry in the zip: {broken}"]
        files = sorted(n for n in archive.namelist() if not n.endswith("/"))
        manifest = (
            json.loads(archive.read("manifest.json"))
            if "manifest.json" in files
            else None
        )
    if files != expected:
        extra = sorted(set(files) - set(expected))
        missing = sorted(set(expected) - set(files))
        errors.append(f"zip differs from git: extra={extra} missing={missing}")
    for name in REQUIRED:
        if name not in files:
            errors.append(f"{name} is not at the zip root")
    junk = [n for n in files if "__pycache__/" in n or n.endswith((".pyc", ".pyo"))]
    if junk:
        errors.append(f"compiled Python files in the zip: {junk}")
    if tag and manifest is not None:
        version = str(manifest.get("version", ""))
        if version != tag.removeprefix("v"):
            errors.append(
                f'manifest.json "version" is {version!r} but the release tag is '
                f"{tag!r}: bump the version (or fix the tag) and release again"
            )
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--ref", default="HEAD", help="commit or tag to package (default HEAD)")
    parser.add_argument("--tag", help="release tag; manifest.json version must equal it without the leading v")
    parser.add_argument("--output", type=Path, default=Path(ASSET))
    args = parser.parse_args()

    args.output.unlink(missing_ok=True)
    build(args.ref, args.output)
    errors = check(args.output, args.ref, args.tag)
    if errors:
        args.output.unlink(missing_ok=True)
        for error in errors:
            print(f"::error::{error}")
        return 1
    count = len(tracked_files(args.ref))
    print(f"{args.output}: {count} files from {INTEGRATION} at {args.ref}, "
          f"{args.output.stat().st_size} bytes, manifest.json at the root")
    return 0


if __name__ == "__main__":
    sys.exit(main())

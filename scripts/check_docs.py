#!/usr/bin/env python3
"""Check repository Markdown without dependencies or network access."""

from __future__ import annotations

import os
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
LOCAL_DOCS = ROOT / "docs"
EXCLUDED = {
    ".git", ".ssh", "node_modules", "dist", "build", "coverage", ".cache",
    # Do not inspect private backup data left by older builds.
    ".attachment-atlas-recovery",
    ".obsidian", ".trash", "dev-vault",
    "release", "artifacts", "test-results", "playwright-report",
}
LINK = re.compile(r"!?\[[^\]\n]*\]\((<[^>\n]+>|[^\s)]+)(?:\s+\"[^\"]*\")?\)")
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")


def markdown_files() -> list[Path]:
    paths = []
    for current, directories, filenames in os.walk(ROOT, followlinks=False):
        directories[:] = sorted(
            name for name in directories
            if name not in EXCLUDED
            and Path(current) / name != LOCAL_DOCS
            and not (Path(current) / name).is_symlink()
        )
        paths.extend(
            Path(current) / name for name in sorted(filenames)
            if name.endswith(".md") and not (Path(current) / name).is_symlink()
        )
    return paths


def check_file(path: Path) -> list[str]:
    errors = []
    label = path.relative_to(ROOT).as_posix()
    try:
        content = path.read_bytes().decode("utf-8")
    except UnicodeError:
        return [f"{label}: must use UTF-8"]
    if not content.endswith("\n"):
        errors.append(f"{label}: missing final newline")
    fence_char = ""
    fence_length = 0
    for line_number, line in enumerate(content.splitlines(), start=1):
        location = f"{label}:{line_number}"
        if line != line.rstrip():
            errors.append(f"{location}: trailing whitespace")
        marker = FENCE.match(line)
        if marker:
            token, suffix = marker.groups()
            if not fence_char:
                fence_char, fence_length = token[0], len(token)
            elif token[0] == fence_char and len(token) >= fence_length and not suffix.strip():
                fence_char = ""
            continue
        if fence_char:
            continue
        for match in LINK.finditer(line):
            destination = match.group(1).strip("<>")
            parsed = urlsplit(destination)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            relative = unquote(parsed.path)
            target = (ROOT / relative.lstrip("/")) if relative.startswith("/") else (path.parent / relative)
            resolved = target.resolve()
            if not resolved.is_relative_to(ROOT):
                errors.append(f"{location}: local link escapes repository: {destination}")
            elif resolved.is_relative_to(LOCAL_DOCS):
                errors.append(f"{location}: public Markdown links to local-only documentation: {destination}")
            elif not resolved.exists():
                errors.append(f"{location}: missing local link target: {destination}")
    if fence_char:
        errors.append(f"{label}: unclosed code fence")
    return errors


def main() -> int:
    paths = markdown_files()
    errors = [error for path in paths for error in check_file(path)]
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"Documentation checks passed: {len(paths)} Markdown files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

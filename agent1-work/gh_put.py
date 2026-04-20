#!/usr/bin/env python3
"""Helper: PUT a file to GitHub via gh api with proper base64 encoding.

Usage: gh_put.py <repo> <path> <branch> <message> <local_file>

Gets current sha if present, then PUTs the content. Uses base64 with no newlines.
"""
from __future__ import annotations

import base64
import json
import subprocess
import sys
from pathlib import Path


def gh_api(args: list[str], check: bool = True) -> tuple[int, str, str]:
    proc = subprocess.run(
        ["gh", "api"] + args,
        capture_output=True,
        text=True,
    )
    if check and proc.returncode != 0:
        sys.stderr.write(f"gh api failed: {proc.stderr}\n")
    return proc.returncode, proc.stdout, proc.stderr


def get_sha(repo: str, path: str, branch: str) -> str | None:
    rc, out, _ = gh_api(
        ["-H", "Accept: application/vnd.github+json", f"repos/{repo}/contents/{path}?ref={branch}"],
        check=False,
    )
    if rc != 0:
        return None
    try:
        data = json.loads(out)
        return data.get("sha")
    except json.JSONDecodeError:
        return None


def put_file(repo: str, path: str, branch: str, message: str, local_file: str) -> int:
    content = Path(local_file).read_bytes()
    b64 = base64.b64encode(content).decode("ascii")
    sha = get_sha(repo, path, branch)

    payload = {
        "message": message,
        "content": b64,
        "branch": branch,
    }
    if sha:
        payload["sha"] = sha

    # Use input-file approach via stdin to avoid any shell quoting issues
    proc = subprocess.run(
        [
            "gh", "api", "--method", "PUT",
            "-H", "Accept: application/vnd.github+json",
            f"repos/{repo}/contents/{path}",
            "--input", "-",
        ],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        sys.stderr.write(f"PUT failed for {repo}/{path}:\n{proc.stderr}\n")
        return proc.returncode
    resp = json.loads(proc.stdout)
    commit_sha = resp.get("commit", {}).get("sha", "?")
    print(f"OK {repo}/{path} @ {branch} -> {commit_sha[:8]}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 6:
        sys.stderr.write("Usage: gh_put.py <repo> <path> <branch> <message> <local_file>\n")
        sys.exit(2)
    sys.exit(put_file(*sys.argv[1:]))

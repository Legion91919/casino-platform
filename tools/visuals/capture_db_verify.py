#!/usr/bin/env python3
"""Run tools/db-verify.sh for real (throwaway PostgreSQL 16) and save its output as a terminal session.

  python3 tools/visuals/capture_db_verify.py
  cd tools/visuals && node terminal.mjs db-verify-session.json ../../docs/media db-verify --still
"""
import json, pathlib, subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
r = subprocess.run(["bash", "tools/db-verify.sh"], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
out = r.stdout.rstrip()
session = {
    "title": "casino-platform: tools/db-verify.sh",
    "prompt": "~/casino-platform $", "width": 1000, "height": 500, "fontSize": 15,
    "highlight": [[r"^ok ", "#7fd4a8"], [r"all migrations applied|assertions passed", "#7fd4a8"], [r"FAIL|ERROR", "#f28b82"], [r"^started|stopped", "#7c8699"]],
    "steps": [{"cmd": "tools/db-verify.sh", "out": out}, {"cmd": "echo $?", "out": str(r.returncode)}],
}
pathlib.Path(__file__).with_name("db-verify-session.json").write_text(json.dumps(session, indent=1))
print(out)
raise SystemExit(r.returncode)

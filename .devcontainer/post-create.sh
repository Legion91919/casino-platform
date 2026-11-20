#!/usr/bin/env bash
# Runs once when the Codespace (or local dev container) is created.
set -euo pipefail
cd "$(dirname "$0")/.."
sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-client >/dev/null
pip install --user -q pyyaml jsonschema referencing
echo "Setup done. Running every test once so you start from green..."
bash scripts/test-all.sh || echo "Some tests failed: run scripts/test-all.sh to see the details."

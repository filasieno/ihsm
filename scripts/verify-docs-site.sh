#!/usr/bin/env bash
# Assert the VitePress production output is complete (used in CI).
set -euo pipefail

DIST="${1:-docs/.vitepress/dist}"

test -f "$DIST/index.html"
test -f "$DIST/reference/index.html"
test -f "$DIST/reference/01-key-concepts.html"
test -f "$DIST/reference/tutorials/index.html"
test -f "$DIST/api/index.html"
grep -q 'plantuml-diagram' "$DIST/reference/tutorials/01-hello-state-machine.html"
grep -q 'diagrams/01-hello-state-machine' "$DIST/reference/tutorials/01-hello-state-machine.html"

echo "Documentation site output OK ($DIST)"

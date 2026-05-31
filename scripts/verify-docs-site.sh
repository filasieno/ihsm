#!/usr/bin/env bash
# Assert the Docusaurus production output is complete (used in CI).
set -euo pipefail

DIST="${1:-docs-build}"

test -f "$DIST/index.html"
test -f "$DIST/reference/index.html"
test -f "$DIST/tutorials/index.html"
test -f "$DIST/tutorials/01-hello-state-machine/index.html"
test -f "$DIST/tutorials/16-then/index.html"
test -f "$DIST/tutorials/17-post-now/index.html"
grep -q 'Reading the trace' "$DIST/tutorials/01-hello-state-machine/index.html"
grep -q 'Key concepts' "$DIST/reference/index.html"
grep -q 'makeHsm' "$DIST/reference/index.html"

echo "Documentation site output OK ($DIST)"

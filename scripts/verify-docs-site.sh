#!/usr/bin/env bash
# Assert the Docusaurus production output is complete (used in CI).
set -euo pipefail

DIST="${1:-site/build}"

test -f "$DIST/index.html"
test -f "$DIST/reference/index.html"
test -f "$DIST/tutorials/index.html"
test -f "$DIST/tutorials/01-hello-state-machine/index.html"
test -f "$DIST/tutorials/16-then/index.html"
test -f "$DIST/tutorials/17-post-now/index.html"
grep -q 'Interactive tutorial' "$DIST/tutorials/01-hello-state-machine/index.html"

echo "Documentation site output OK ($DIST)"

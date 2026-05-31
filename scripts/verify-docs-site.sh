#!/usr/bin/env bash
# Assert the Docusaurus production output is complete (used in CI).
set -euo pipefail

DIST="${1:-docs-build}"

test -f "$DIST/index.html"
test -f "$DIST/reference/index.html"
test -f "$DIST/tutorials/index.html"
test -f "$DIST/tutorials/01-hello-state-machine/index.html"
test -f "$DIST/tutorials/17-post-now/index.html"
grep -q 'Reading the trace' "$DIST/tutorials/01-hello-state-machine/index.html"
grep -q 'Key concepts' "$DIST/reference/index.html"
grep -q 'makeHsm' "$DIST/reference/index.html"
grep -q 'UML state diagram' "$DIST/tutorials/01-hello-state-machine/index.html"
grep -q 'UML state diagram' "$DIST/reference/index.html"
# The statechart is repeated just before "Reading the trace" (no-scroll readability).
grep -q 'State diagram (repeated for reference)' "$DIST/tutorials/01-hello-state-machine/index.html"
if grep -q '@startuml' "$DIST/tutorials/01-hello-state-machine/index.html"; then
	echo "ERROR: PlantUML source leaked into HTML — diagrams were not rendered" >&2
	exit 1
fi
test -f "$DIST/img/plantuml/01-hello-state-machine-0.svg"
test -f "$DIST/img/plantuml/reference-0.svg"

echo "Documentation site output OK ($DIST)"

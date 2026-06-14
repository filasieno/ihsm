#!/usr/bin/env bash
# Assert the Docusaurus production output is complete (used in CI).
set -euo pipefail

DIST="${1:-docs-build}"

test -f "$DIST/index.html"
test -f "$DIST/reference/index.html"
test -f "$DIST/testing/index.html"
grep -q 'State as class' "$DIST/reference/index.html"
grep -q 'Tutorial playground' "$DIST/reference/index.html"
grep -q 'UML state diagram' "$DIST/reference/index.html"
grep -q 'Tracing' "$DIST/reference/index.html"
grep -q 'Deferred timers' "$DIST/testing/index.html"
grep -q 'Deterministic Simulation Testing' "$DIST/testing/index.html"
grep -q 'UML state diagram' "$DIST/testing/index.html"
for page in reference testing; do
	if grep -q '@startuml' "$DIST/$page/index.html"; then
		echo "ERROR: PlantUML source leaked into $page HTML — diagrams were not rendered" >&2
		exit 1
	fi
done
test -f "$DIST/img/plantuml/reference-0.svg"
test -f "$DIST/img/plantuml/testing-0.svg"

echo "Documentation site output OK ($DIST)"

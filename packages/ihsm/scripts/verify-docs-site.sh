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
		echo "FATAL: PlantUML source leaked into $page HTML — statecharts were not rendered" >&2
		exit 1
	fi
	if ! grep -q 'UML state diagram' "$DIST/$page/index.html"; then
		echo "FATAL: $page HTML has no rendered UML diagram images" >&2
		exit 1
	fi
done

PLANTUML_DIR="$DIST/img/plantuml"
if [[ ! -d "$PLANTUML_DIR" ]]; then
	echo "FATAL: missing $PLANTUML_DIR" >&2
	exit 1
fi
SVG_COUNT="$(find "$PLANTUML_DIR" -maxdepth 1 -name '*.svg' | wc -l)"
if [[ "$SVG_COUNT" -lt 2 ]]; then
	echo "FATAL: expected multiple PlantUML SVG assets, found $SVG_COUNT in $PLANTUML_DIR" >&2
	exit 1
fi
test -f "$PLANTUML_DIR/reference-0.svg"
test -f "$PLANTUML_DIR/testing-0.svg"

echo "Documentation site output OK ($DIST)"

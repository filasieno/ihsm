#!/usr/bin/env bash
# Fail if generated artifacts are tracked in git (sources-only policy).
set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$root" ]]; then
	echo "verify-no-generated-tracked: not a git checkout — skipped"
	exit 0
fi

cd "$root"

errors=0

check_pathspec() {
	local label="$1"
	shift
	local matches
	matches="$(git ls-files -- "$@" || true)"
	if [[ -n "$matches" ]]; then
		echo "ERROR: $label must not be committed:" >&2
		echo "$matches" >&2
		errors=1
	fi
}

check_pathspec 'compiled library (lib/)' lib
check_pathspec 'TypeScript build cache (.tsc/)' .tsc
check_pathspec 'Docusaurus output (docs-build/)' docs-build
check_pathspec 'coverage output' coverage .nyc_output
check_pathspec 'Docusaurus cache' website/.docusaurus
check_pathspec 'generated docs site tree (website/docs/)' website/docs
check_pathspec 'generated sidebars (website/sidebars.ts)' website/sidebars.ts
check_pathspec 'generated PlantUML SVGs (website/static/img/plantuml/)' website/static/img/plantuml
check_pathspec 'legacy Jekyll Pages config (_config.yml)' _config.yml

if [[ "$errors" -ne 0 ]]; then
	echo >&2
	echo "Sources live under src/, tutorials/, reference/, and website/docs-src/." >&2
	echo "Run npm run sync:docs locally; never commit generated output." >&2
	exit 1
fi

echo "No generated artifacts tracked in git."

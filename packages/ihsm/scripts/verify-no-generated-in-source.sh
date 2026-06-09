#!/usr/bin/env bash
# Nix sandbox: vendored generated docs must not appear in the exported source tree.
# (lib/ and .tsc/ are produced later in the same derivation — not checked here.)
set -euo pipefail

errors=0

forbidden() {
	if [[ -e "$1" ]] || [[ -d "$1" ]]; then
		echo "ERROR: generated path must not be in source export: $1" >&2
		errors=1
	fi
}

forbidden docs-build
forbidden .typedoc-out
forbidden website/docs
forbidden website/sidebars.ts
forbidden website/.docusaurus
forbidden website/.docs-staging
forbidden website/static/img/plantuml
forbidden test/browser/entries/unit.ts
forbidden test/browser/entries/examples.ts
forbidden _config.yml

# Generated TypeScript output must never live in the source tree (it belongs in
# lib/ and .tsc/). Catch stray declaration/JS emitted next to .ts sources.
stray_ts="$(find src examples \( -name '*.d.ts' -o -name '*.js' -o -name '*.js.map' -o -name '*.d.ts.map' \) -print 2>/dev/null || true)"
if [[ -n "$stray_ts" ]]; then
	echo "ERROR: generated TypeScript output must not be in src/ or examples/:" >&2
	echo "$stray_ts" >&2
	errors=1
fi

if [[ "$errors" -ne 0 ]]; then
	exit 1
fi

echo "Source tree has no vendored generated docs artifacts or compiled TypeScript."

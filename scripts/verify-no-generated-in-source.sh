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
forbidden website/docs
forbidden website/sidebars.ts
forbidden website/.docusaurus
forbidden website/static/img/plantuml
forbidden _config.yml

if [[ "$errors" -ne 0 ]]; then
	exit 1
fi

echo "Source tree has no vendored generated docs artifacts."

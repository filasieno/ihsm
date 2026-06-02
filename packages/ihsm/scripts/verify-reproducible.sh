#!/usr/bin/env bash
# Build the same Nix output twice (--rebuild) and assert bit-identical artifacts.
set -euo pipefail

ATTR="${1:-.#ihsm}"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "Checking reproducibility of $ATTR …"
nix build "$ATTR" --rebuild --print-build-logs -o "$WORKDIR/out-a"
nix build "$ATTR" --rebuild --print-build-logs -o "$WORKDIR/out-b"

if diff -rq "$WORKDIR/out-a" "$WORKDIR/out-b"; then
	echo "Reproducible: $ATTR"
else
	echo "Non-reproducible output for $ATTR" >&2
	exit 1
fi

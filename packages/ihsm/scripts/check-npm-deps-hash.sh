#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "${repo_root}" ]; then
  echo "ihsm hash check: must run inside a git repository." >&2
  exit 1
fi

pkg_dir="${repo_root}/packages/ihsm"
flake_file="${pkg_dir}/flake.nix"
lock_file="${pkg_dir}/package-lock.json"

if [ ! -f "${flake_file}" ] || [ ! -f "${lock_file}" ]; then
  echo "ihsm hash check: expected files not found under packages/ihsm." >&2
  exit 1
fi

if ! command -v nix >/dev/null 2>&1; then
  echo "ihsm hash check: nix is required to validate npmDepsHash." >&2
  exit 1
fi

expected_hash="$(sed -n 's/^[[:space:]]*npmDepsHash = "\(sha256-[^"]*\)".*/\1/p' "${flake_file}" | sed -n '1p')"
if [ -z "${expected_hash}" ]; then
  echo "ihsm hash check: unable to read npmDepsHash from ${flake_file}." >&2
  exit 1
fi

prefetch_output="$(cd "${pkg_dir}" && nix run nixpkgs#prefetch-npm-deps -- package-lock.json)"
actual_hash="$(printf '%s\n' "${prefetch_output}" | sed -n 's/^\(sha256-[A-Za-z0-9+/=]*\)$/\1/p' | sed -n '1p')"

if [ -z "${actual_hash}" ]; then
  echo "ihsm hash check: failed to parse prefetch hash output." >&2
  echo "${prefetch_output}" >&2
  exit 1
fi

if [ "${expected_hash}" != "${actual_hash}" ]; then
  echo "ihsm hash check: npmDepsHash mismatch; push blocked." >&2
  echo "  flake.nix:         ${expected_hash}" >&2
  echo "  prefetch-npm-deps: ${actual_hash}" >&2
  echo "" >&2
  echo "Update packages/ihsm/flake.nix npmDepsHash to:" >&2
  echo "  ${actual_hash}" >&2
  exit 1
fi

echo "ihsm hash check: npmDepsHash is valid (${expected_hash})."

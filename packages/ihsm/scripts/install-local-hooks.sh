#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "${repo_root}" ]; then
  echo "ihsm hooks install: must run inside the ihsm git repository." >&2
  exit 1
fi

src_hook="${repo_root}/.githooks/pre-push"
dst_hook="${repo_root}/.git/hooks/pre-push"

if [ ! -f "${src_hook}" ]; then
  echo "ihsm hooks install: missing ${src_hook}." >&2
  exit 1
fi

install -m 0755 "${src_hook}" "${dst_hook}"
echo "Installed local pre-push hook: ${dst_hook}"

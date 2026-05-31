# Releasing ihsm

## Prerequisites

- [Nix](https://nixos.org/download/) with flakes enabled
- GitHub repo **`filasieno/ihsm`** push access
- npm **`ihsm`** publish access
- GitHub repository secrets:
  - **`NPM_TOKEN`** — npm automation token with publish scope

## Pre-release checklist

Run locally (same gates as CI + release workflow):

```shell
nix flake check
nix build .#docs --option sandbox false
bash scripts/verify-docs-site.sh site/build
```

Confirm `package.json` **`version`** matches the tag you will push (`v0.0.18` → `"0.0.18"`).

Update **`CHANGELOG.md`** for the new version.

## Publish

1. Commit and push to **`master`** on GitHub (`upstream` remote):

   ```shell
   git push upstream master
   ```

   Docs deploy automatically via `.github/workflows/docs.yml`.

2. Tag and push the release:

   ```shell
   git tag v0.0.18
   git push upstream v0.0.18
   ```

3. **Release workflow** (`.github/workflows/release.yml`) runs on the tag:
   - full test suite + lint
   - `npm publish --provenance` → [npmjs.com/package/ihsm](https://www.npmjs.com/package/ihsm)
   - GitHub Release with auto-generated notes

## Badges (README)

After the first push to `master` post-release:

| Badge | Source |
|-------|--------|
| CI | GitHub Actions `ci.yml` on `master` |
| docs | GitHub Actions `docs.yml` on `master` |
| Coverage | Coveralls — uploaded from CI (Node 24 job, push only) |
| npm | Updates after `npm publish` |
| License | GitHub license API |

If Coveralls shows *unknown*, open [coveralls.io/github/filasieno/ihsm](https://coveralls.io/github/filasieno/ihsm) and ensure the repo is activated; CI must complete a push to `master` with a green coverage upload.

## Manual npm publish (fallback)

```shell
nix flake check
nix develop --command npm publish --access public
```

Use only if the release workflow is unavailable.

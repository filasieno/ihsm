# Releasing ihsm

## Prerequisites

- [Nix](https://nixos.org/download/) with flakes enabled
- GitHub repo **`filasieno/ihsm`** push access
- npm **`ihsm`** publish access
- GitHub repository secrets:
  - **`NPM_TOKEN`** — npm automation token with publish scope

## Pre-release checklist

Run locally on **`dev`**, then merge to **`master`** when green:

```shell
bash scripts/verify-no-generated-tracked.sh
nix flake check
nix build .#docs
bash scripts/verify-docs-site.sh docs-build
```

Confirm `package.json` **`version`** matches the tag you will push (`v0.0.19` → `"0.0.19"`).

Update **`CHANGELOG.md`** for the new version.

**Do not** run `npm run sync:docs` for commit — generated docs are built in CI/Nix only.
Edit sources: `tutorials/`, `reference/REFERENCE.md`, `website/docs-src/`.

## Publish

1. Merge **`dev`** → **`master`** and push:

   ```shell
   git push upstream master
   ```

   Docs deploy automatically via `.github/workflows/docs.yml`.

2. Tag and push the release:

   ```shell
   git tag v0.0.19
   git push upstream v0.0.19
   ```

3. **Release workflow** (`.github/workflows/release.yml`) runs on the tag:
   - full test suite + lint + docs
   - `npm publish --provenance` → [npmjs.com/package/ihsm](https://www.npmjs.com/package/ihsm)
   - GitHub Release with auto-generated notes

## Badges (README)

After the first push to `master` post-release:

| Badge | Source |
|-------|--------|
| CI | GitHub Actions `ci.yml` on `master` |
| docs | GitHub Actions `docs.yml` on `master` |
| Coverage | Coveralls — uploaded from CI (push only) |
| npm | Updates after `npm publish` |
| License | GitHub license API |

If Coveralls shows *unknown*, open [coveralls.io/github/filasieno/ihsm](https://coveralls.io/github/filasieno/ihsm) and ensure the repo is activated; CI must complete a push to `master` with a green coverage upload.

## Manual npm publish (fallback)

```shell
nix flake check
nix develop --command npm publish --access public
```

Use only if the release workflow is unavailable.

## Maintainer

Fabio Nicola Filasieno — `fabio.filasieno@users.noreply.github.com` (GitHub noreply).

## Summary

<!-- What does this PR do? Link issues: Fixes # -->

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing code to change)
- [ ] Documentation only
- [ ] CI / tooling

## Checklist

- [ ] `nix flake check` passes (build, unit/tutorial tests, lint, docs)
- [ ] New/changed behavior covered by tests in `src/spec/`
- [ ] No new production `dependencies` added
- [ ] ESLint and Prettier pass (`nix build .#lint` or `npm run lint` in `nix develop`)
- [ ] Public API changes include JSDoc updates
- [ ] README updated if needed
- [ ] I have read and agree to the [Code of Conduct](../CODE_OF_CONDUCT.md)

## How to test

<!-- Steps for reviewers to verify the change -->

```shell
nix flake check
```

## Additional notes

<!-- Optional: design trade-offs, follow-up work, benchmark results -->

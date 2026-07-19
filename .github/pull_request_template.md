## Summary

<!-- What does this PR change, and why? Keep it focused on one logical change. -->

## How tested

<!-- Commands you ran and what you observed. e.g. `npm test`, `npm run test:e2e`,
manual steps in the demo. -->

## Checklist

- [ ] Tests pass locally (`npm test` and, where relevant, `npm run test:e2e`)
- [ ] Tracker bundle within budget (`npm run build:tracker` succeeds — 5120-byte cap)
- [ ] No new server runtime dependencies (Node built-ins only)
- [ ] Privacy invariants respected (no text/values read; no IP/UA/PII stored)
- [ ] Tests added or updated for behavior changes
- [ ] Docs updated (`README.md` / `docs/`) if behavior or config changed

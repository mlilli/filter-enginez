<!--
⚠ Pull requests are accepted from COLLABORATORS ONLY — a native GitHub setting,
not an auto-close bot. See CONTRIBUTING.md. If you are not a collaborator, open
an issue first; a PR you cannot open is less frustrating than one that is closed
unread.

The checklist below is short on purpose. CI already enforces typecheck, lint,
markdown lint, Prettier, cspell, 100% unit coverage and the bundle-size budgets,
so asking you to confirm those by hand would be theatre. What is listed here is
only what CI CANNOT see.
-->

# What changed, and why

<!-- The "why" is the part that survives. A commit in this repo is expected to
explain the reasoning, not restate the diff — see any recent `git log` entry. -->

## How it was verified

<!-- Name the commands you ran and what they said. "CI is green" is not a
verification claim: CI builds the packages but never packs them, so it cannot
load a published entry point the way a consumer does, and this repository has
no browser end-to-end suite — the example apps that exercise the engine in a
browser live in filter-enginez-examples. -->

---

## Things CI cannot check

- [ ] **If this touched a `pnpm-workspace.yaml` override**, the replacement range still carries an upper major bound,
      and the lockfile was re-resolved. An unbounded override resolves to the highest match, which can silently cross a
      major and rename an API a consumer depends on.
- [ ] **If this changed how a CommonJS dependency is imported**, it was checked in _both_ plain Node ESM and an SSR
      runtime. These disagree: a named import throws in Node, a default import resolves to `undefined` under Vite SSR,
      and bundlers hide both.
- [ ] **If this changed a published entry point**, `bash scripts/pack-engine-tarballs.sh` then
      `bash scripts/verify-tarball-imports.sh` still pass. This is the only check that loads the built artifact the way
      a consumer will, which makes it the one that sees the import mismatch above.
- [ ] **If this is a user-visible change to a published package**, it carries a changeset (`pnpm changeset`). The
      release workflow versions and publishes from changesets alone, so a change without one ships in no release.
- [ ] **If this added an `auditConfig.ignoreGhsas` entry**, it has a machine-checkable premise in
      `scripts/recheck-accepted-advisories.mjs`. An acceptance with no premise that can expire is a claim that stops
      being checked the day it stops being true.
- [ ] **If this added a guard**, it was run against a deliberately broken tree and observed to FAIL. A check that does
      not run looks exactly like a check that passes.

## Breaking changes

<!-- Delete if none. Otherwise: what breaks, and what a consumer has to change —
the same text belongs in the changeset, which is what becomes the changelog. -->

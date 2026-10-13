# Changesets

This folder holds [Changesets](https://github.com/changesets/changesets) — the release-notes + version-bump mechanism
for the Filter EngineZ engine packages.

A changeset is a small markdown file describing a user-visible change and the semver bump each affected package should
get. They accumulate here between releases; at release time they are consumed to bump versions, write per-package
changelogs, and publish.

## Workflow (maintainer)

```bash
pnpm changeset          # interactively describe your change → writes a file here
pnpm changeset version  # consume pending changesets → bump versions + changelogs
pnpm release            # sync license files into each package, then changeset publish
```

The benchmark harness (`benchmarks/`) is `"private": true` and is never published; the 13 packages under `packages/` are
the only things that ship to npm. The example apps live in a separate repository,
[`filter-enginez-examples`](https://github.com/mlilli/filter-enginez-examples), and publish nothing.

See the config in [`config.json`](./config.json). Full docs:
<https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md>.

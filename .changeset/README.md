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

The first one goes with your change: commit the file it writes. The other two run in the
[Release workflow](../.github/workflows/release.yml) on every push to `main`, through the Changesets action. While
changesets are pending, the action runs `pnpm changeset version` and opens or updates a "chore(release): version
packages" pull request with the result. Merging that pull request runs the workflow again with nothing left to version,
and the action runs `pnpm release`, which publishes to npm. The action commits the version bumps, tags each published
version, and creates its GitHub release through the GitHub API, so the job itself never runs `git commit` or `git push`;
the workflow also sets `HUSKY: "0"`, so the commit hooks never run in CI.

The benchmark harness (`benchmarks/`) is `"private": true` and is never published; the 13 packages under `packages/` are
the only things that ship to npm. The example apps live in a separate repository,
[`filter-enginez-examples`](https://github.com/mlilli/filter-enginez-examples), and publish nothing.

See the config in [`config.json`](./config.json). Full docs: <https://changesets.dev/guide/getting-started>.

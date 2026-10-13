# Security Policy

## Supported versions

Security fixes land on the **latest released version** of each `@filter-enginez/*` package only, with no back-porting to
older versions: pin a version you have reviewed, and upgrade to pick up fixes. While the major version is 0, a minor
release may also contain breaking changes; the changelog says what to change.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.** Public disclosure before a fix is available puts
every consumer at risk.

Report privately instead:

- **GitHub Security Advisories** — the "Report a vulnerability" button under this repository's **Security** tab, or
  directly at <https://github.com/mlilli/filter-enginez/security/advisories/new>. This is the preferred channel.
- **Email** — [security@filterenginez.com](mailto:security@filterenginez.com), or the author address in
  [`README.md`](./README.md) if that alias does not answer.

Please include the affected package and version (or commit), the runtime (browser, Node, Web Worker, edge), a minimal
reproduction or proof of concept, and the impact you believe it has.

## What to expect

This is a solo-maintained project, so there is no guaranteed response time, but security reports come first. You can
expect an acknowledgment, a good-faith assessment of severity, a fix once the problem is confirmed, and credit in the
advisory if you would like it (or anonymity if you prefer).

## Scope

In scope: the 13 `@filter-enginez/*` packages in this repository — the engine, its reactive and framework adapters, the
ESLint plugin, and the mock-data package — which is the code a consumer actually ships.

Out of scope here: the demo apps and the documentation site in
[`filter-enginez-examples`](https://github.com/mlilli/filter-enginez-examples). Problems confined to them are handled as
ordinary bugs in that repository, unless they reveal a defect in an engine package — then report it here, privately.

Also out of scope: the optional real wine dataset, which is third-party data that this project never distributes (see
[`NOTICE.md`](./NOTICE.md)).

## Accepted advisories

A small set of advisories are deliberately suppressed from `pnpm audit` via `auditConfig.ignoreGhsas` in
[`pnpm-workspace.yaml`](./pnpm-workspace.yaml). Each sits on a development or build-tooling path; none is reachable from
a published package. Last reviewed 2026-10-07.

Suppressing an advisory hides it, including a high one, so each acceptance has a machine-checkable premise, and
something fails when that premise expires. Where an entry below says **no fix exists**, the latest published version of
the package is the vulnerable one: there is nothing to upgrade to, and an `overrides` pin cannot invent a release.

```bash
node scripts/recheck-accepted-advisories.mjs   # exits non-zero the day any premise below stops holding
```

Run it before a release and whenever `pnpm audit`'s counts change. `tests/tooling/acceptedAdvisoryParity.test.ts` keeps
all three records — the suppression list, this table, and that script's preconditions — naming the same set, so an
acceptance cannot exist without a stated premise. It also asserts the one premise that needs no network: that
`.markdownlint-cli2.yaml` still enables no math extension, which is what makes the KaTeX advisory unreachable here.

| Advisory                                                                 | Package         | Path                                                                | Why it is accepted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | --------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | `braces` (high) | dev paths via `micromatch`                                          | **No fix exists.** Verified 2026-10-04: `braces@3.0.3` is the latest published version, and `micromatch@4.0.8` is also latest and still declares `braces: ^3.0.3` — so the advisory's "Patched versions: None" is accurate and an `overrides` pin has nothing to point at. Every path is dev tooling (`lint-staged`, `markdownlint-cli2`); none is reachable from a shipped library package. Exploiting it requires a hostile glob **pattern**, and every glob here comes from a committed config file rather than from input. Re-review when `braces` publishes a fix or `micromatch` drops it. |
| [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) | `sprintf-js`    | `@changesets/cli > … > argparse > sprintf-js` (dev)                 | **No fix exists** — "Patched versions: None", with the resolved copy at `1.0.3` because `argparse@1.x` pins it. Release tooling only, run by hand, over this repo's own yaml. The denial of service needs an attacker-supplied **format string**, and nothing here passes untrusted input to a formatter. ⚠ A different `js-yaml` chain from the two retired on 2026-10-04 — those were markdownlint's, this one is changesets'. Re-review when changesets updates `read-yaml-file`.                                                                                                             |
| [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7) | `katex` (low)   | `markdownlint-cli2 > markdownlint > micromark-extension-math` (dev) | **The vulnerable code never executes.** `.markdownlint-cli2.yaml` enables no math extension, so KaTeX renders nothing. Patched only in `>=0.18.2` against a resolved `0.16.47`, and in 0.x semver a minor bump is a breaking one — so an override would force a breaking change on a transitive dependency to fix a path that does not run.                                                                                                                                                                                                                                                      |

**Retired 2026-10-10:** `GHSA-rj75-hqrm-r3gf` (`postcss-selector-parser`). Its only path was the `examples-react-rtk`
demo app, which lives in the examples repository; this lockfile resolves no `postcss-selector-parser`, so the entry
suppressed nothing here. It stays accepted in the examples repository's policy.

**Retired 2026-10-07:** `GHSA-mh99-v99m-4gvg` (`brace-expansion`) and `GHSA-r4xh-jqrq-34v2` (`smol-toml`). Both had been
justified by a mistaken rule — that `pnpm audit` matches advisories against _declared_ ranges and so keeps reporting a
package an `overrides` pin has already patched. **It does not; pnpm 12 reads resolved versions.** Adding the `smol-toml`
override removed `1.8.0` from the lockfile outright and the advisory stopped matching. `brace-expansion` was inert for
the same reason: it resolves to `1.1.21` / `5.0.12`, with no reference to the vulnerable `1.1.14` / `5.0.6`.

The rule that follows: **an override that fully patches the tree needs no ignore at all.** An ignore is for exactly two
cases — no fix exists, or the vulnerable copy survives on a path an override cannot reach.

The `smol-toml` **override** stays and is doing real work: removing it restores `markdownlint-cli2`'s exact `1.8.0` pin,
and the advisory returns. Retire it only when `markdownlint-cli2` moves past `1.8.0` upstream.

**Retired 2026-10-04:** `GHSA-52cp-r559-cp3m` and `GHSA-h67p-54hq-rp68` (both `js-yaml`, via
`markdownlint-cli2 > js-yaml`). They were accepted because the patched `js-yaml >=4.3.0` dropped the default ESM export
`markdownlint-cli2` imported, and the recorded re-review trigger was "if `markdownlint-cli2` moves off the vulnerable
line". It did: `markdownlint-cli2@0.23.3` depends on `js-yaml@5.4.1`, outside the vulnerable range entirely, and on
`smol-toml@1.8.0`, which clears `GHSA-7w5x-hrqm-74c2` in the same bump.

# Contributing

Thank you for your interest in **Filter EngineZ**. This is a solo-maintained project, and it runs on a simple model:

- **Issues are welcome from everyone** — bug reports, feature requests, and usage questions.
- **Pull requests are accepted from collaborators only.** That is a GitHub repository setting, not a bot that closes
  PRs, so if you are not a collaborator the way in is an issue.
- **Every merge is my call.** I review each change personally, and nothing lands without that approval. It keeps the
  architecture coherent and every decision accountable to one person.

Filter EngineZ is licensed under [Apache 2.0](./LICENSE.md). Unless you state otherwise, anything you submit for
inclusion is offered under those same terms — see [`NOTICE.md`](./NOTICE.md).

## Issues

Blank issues are disabled; pick the template that fits.

- **Bug report** — include the package and version, where it runs (browser bundle, plain Node ESM or CommonJS, SSR, Web
  Worker, edge), a minimal reproduction, and expected vs. actual behavior. If it is about speed, first check that
  `initializeBitmapAcceleration()` was awaited — the bitmap path stays off without it, silently (results are the same
  either way).
- **Feature request** — describe the problem rather than the solution, and what you do today instead. Check first
  whether a custom rule covers it ([`docs/guides/extending_rules.md`](./docs/guides/extending_rules.md)).
- **Usage question** — open it as a bug report and say it is a question, so the answer is searchable for the next
  person.
- **Security problem** — never a public issue. Follow [`SECURITY.md`](./SECURITY.md).

Issues about the demo apps belong in
[`filter-enginez-examples`](https://github.com/mlilli/filter-enginez-examples/issues), unless the root cause is in an
engine package.

## Pull requests (collaborators)

1. **Agree on the approach first.** For anything beyond a typo or a clear bug with a tight reproduction, start from an
   issue and wait for a thumbs-up. A green build is necessary but not sufficient: a change can be declined because it
   does not fit the architecture or the roadmap. The license lets anyone fork and modify their own copy.
2. **Set up.** `corepack enable`, then `pnpm install`. Node comes from [`.nvmrc`](./.nvmrc) and pnpm from the
   `packageManager` field; `pnpm check:node` confirms the Node version. The install also sets up the Git hooks.
3. **Run the gates CI runs** ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)):

   ```bash
   pnpm typecheck
   pnpm lint
   pnpm lint:markdown
   pnpm prettier:check
   pnpm cspell
   pnpm test:coverage
   pnpm build
   pnpm size
   ```

4. **If you changed a published entry point**, also run `bash scripts/pack-engine-tarballs.sh` then
   `bash scripts/verify-tarball-imports.sh`. They load the built tarballs the way a consumer will, which nothing else
   does.
5. **Add a changeset** for any user-visible change to a published package: `pnpm changeset` (see
   [`.changeset/README.md`](./.changeset/README.md)).
6. **Open the PR against `main`** and fill in the template. Its checklist covers only what CI cannot see: dependency
   overrides, CommonJS imports, published entry points, accepted advisories, and new guards.

There is no response-time guarantee, but a PR that meets the standards below and solves a well-scoped problem gets the
fairest hearing.

## Standards

CI or review holds every change to these. Most are enforced by the shared ESLint presets in
[`packages/eslint`](./packages/eslint/README.md) and the root configs.

- **Strict TypeScript** — `strict` plus `noUncheckedIndexedAccess`, `noImplicitOverride`, and no unused locals or
  parameters ([`tsconfig.base.json`](./tsconfig.base.json)); no `any`, no non-null assertions, `import type` for types.
- **Lint clean, zero warnings** — `eslint --max-warnings=0`; every `eslint-disable` needs a `-- reason`, and fixing the
  cause beats disabling the rule.
- **Sorted** — object keys, interface members, union types, and imports sort case-insensitively ascending;
  `pnpm lint:fix` applies it.
- **Small files** — at most 500 non-blank lines per source file (tests exempt), two classes per file, cyclomatic
  complexity up to 20, lines up to 150 characters. Split the file rather than disable the rule.
- **Isomorphic boundary** — the isomorphic packages may not touch browser globals
  (`@filter-enginez/no-browser-api-in-core`); browser code goes in a browser package or a `/browser` sub-export.
- **No duplication** — search for an existing helper (for example in `packages/core/src/lib/`) before writing one;
  extend it rather than fork it, and never copy code across packages.
- **100% unit coverage** — Vitest thresholds are 100% for branches, functions, lines, and statements. A genuinely
  untestable path gets a `/* v8 ignore */` or a [`vitest.coverage.config.ts`](./vitest.coverage.config.ts) entry with an
  adjacent reason, never a lowered threshold.
- **Tests describe behavior** — test what a consumer observes rather than internals, and keep every `expect`
  unconditional.
- **Bundle budgets** — each package has a gzipped size budget in [`.size-limit.json`](./.size-limit.json); raising one
  needs a reason in the PR.
- **Formatting** — TypeScript and JavaScript are formatted by ESLint's stylistic rules (tabs, single quotes); Prettier
  formats Markdown (wrapped at 120 columns), JSON, YAML and CSS; markdownlint checks Markdown structure.
- **Spelling** — American English, checked by cspell ([`cspell.config.yaml`](./cspell.config.yaml) rejects British
  forms); add a legitimate new term to its `words` list with a comment.
- **Docs and comments** — TSDoc on every export; comments explain why, not what; update the relevant guide or README in
  the same PR. Package READMEs ship to npm, so they use absolute URLs, never relative links.
- **Code blocks in docs are verified** — a TypeScript example in a guide, README or `docs/architecture.md` must compile
  against the packages, and an implementation excerpt must match its `// #region docs:<id>` in the source verbatim
  ([`docs/architecture.md` §0.1](./docs/architecture.md#01-how-the-code-blocks-are-verified)). Changing code inside a
  region means updating its excerpt in the same PR.

## Code of conduct

Participation here — issues, pull requests, discussions — is covered by [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md),
the Contributor Covenant 2.1, adopted unmodified. It lists two private reporting channels, both of which reach me.

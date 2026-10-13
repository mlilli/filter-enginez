# @filter-enginez/eslint

ESLint rules and shared flat-config presets for Filter EngineZ projects. Two sub-exports:

- `@filter-enginez/eslint/plugin` — the plugin: three rules plus the `recommended` and `strict` presets.
- `@filter-enginez/eslint/config` — the shared flat configs this repository lints itself with: `base`, `react` and
  `nodeIsomorphic`.

## Install

```bash
pnpm add @filter-enginez/eslint
```

Peer dependencies: `eslint@^10.0.0` — supplied by your app.

## Usage

Import the plugin's default export (`import filterEnginez from '@filter-enginez/eslint/plugin'`) and add
`filterEnginez.configs.recommended` — or `filterEnginez.configs.strict` — to the array your `eslint.config.js` exports.
The plugin registers under the `@filter-enginez` prefix, so a rule is configured as
`'@filter-enginez/no-browser-api-in-core'`.

| Preset        | Rules                                                                       |
| ------------- | --------------------------------------------------------------------------- |
| `recommended` | `no-direct-mirror-mutation` (error)                                         |
| `strict`      | `no-direct-mirror-mutation` (error), `filter-rule-naming-convention` (warn) |

`no-browser-api-in-core` is in neither preset, because which files must stay isomorphic is a per-project decision.
Enable it for those files yourself, or use the `nodeIsomorphic` config from `@filter-enginez/eslint/config`, which turns
it on.

## Rules

### `no-browser-api-in-core`

Reports references to browser-only globals (`window`, `document`, `localStorage`, `sessionStorage`, `history`,
`navigator`, `XMLHttpRequest`, DOM element and event classes, and the rest of `DEFAULT_FORBIDDEN_GLOBALS`) in code that
must run in any JavaScript runtime. Globals every runtime provides, such as `URL`, are allowed, and a local binding that
shadows a global name is not reported. Options:

- `extraGlobals` — names to forbid in addition to the defaults.
- `allowedSubpaths` — globs of files that are browser-only by design and skipped; defaults to `**/storage/browser/**`,
  `**/browser/**` and `**/keyboard/**` (exported as `DEFAULT_NO_BROWSER_API_ALLOWED_SUBPATHS`).

### `no-direct-mirror-mutation`

The `@filter-enginez/redux-bridge` mirror is written only by the bridge. This rule reports any other code that could
write it: importing `stateUpdated`, accessing `*.actions.stateUpdated`, dispatching a `{ type: '<slice>/stateUpdated' }`
literal, or declaring a `stateUpdated` reducer in `createSlice`. Change the engine instead (`addRule`, `setExpression`,
`setSourceData`, …) and let the bridge mirror it. Options:

- `sliceNames` — the mirror slice names to match in action-type strings; default `['filters']`.
- `allowedSubpaths` — globs of files that may write the mirror (the bridge itself).

### `filter-rule-naming-convention`

For classes whose direct superclass is `FilterRule` (or `BaseFilterRule` / `AbstractFilterRule`): the class name ends in
`Rule`, and the file lives under a `rules` directory. Options: `requireRuleSuffix` (default `true`),
`requireRulesDirectory` (default `true`) and `rulesDirectoryGlob` (default `**/rules/**`).

## Documentation

Consumer guides live in the engine repository under `docs/guides/`:

- `extending_rules.md` — writing a custom `FilterRule` that survives serialization
- `json_config.md` — declaring filters as data, and why the format is safe to accept from a tenant
- `acceleration_tuning.md` — what the five `acceleration` toggles are worth, measured
- `worker_offload.md` — running the engine in a Web Worker

Project home: <https://filter-enginez.com>

Apache-2.0. See `LICENSE.md` and `NOTICE.md`, both included in this package.

/**
 * Reading a CommonJS dependency's real exports out of whichever interop shape the host produced.
 *
 * @remarks
 * Its own module rather than a local helper in `serializers.ts`, for two reasons.
 *
 * 🟢 **It is testable here and effectively untestable there.** The branch it exists for is chosen by
 * the HOST, not by the caller: under vitest the module namespace always carries a synthesized
 * `default`, so the fallback arm — the one Vite's SSR runtime actually takes in production — can
 * never execute from inside a test of `serializers.ts`. ⚠ A `v8 ignore` would have satisfied the
 * 100% branch threshold and asserted the opposite of the truth: this repo's convention reserves
 * those for branches that are *defensively unreachable*, and this one is not merely reachable, it is
 * the arm every Vite SSR route depends on. Taking the namespace as a parameter makes both shapes
 * constructible by a test.
 *
 * ⚠ **Not in the package's `exports` map, deliberately** — like `core/src/internals/*`, it ships in
 * `dist` but is not a public subpath. The interop problem is ours, not the consumer's API.
 *
 * @packageDocumentation
 */

/**
 * Read a module's real exports out of whichever interop shape the host produced.
 *
 * @remarks
 * `lz-string@1.5.0` is CommonJS with `main` only — no `exports` map, no `module` field, no `type` —
 * and its typings declare named exports and nothing else. Three import forms are therefore possible
 * and only the third works everywhere:
 *
 * | form | Node ESM | Vite SSR |
 * | ---- | -------- | -------- |
 * | `import { fn } from 'dep'` | ✗ `SyntaxError` at load — `cjs-module-lexer` finds no named exports | ✓ |
 * | `import pkg from 'dep'` | ✓ | ✗ `pkg` is `undefined` |
 * | `import * as mod` + this helper | ✓ | ✓ |
 *
 * Node hands back `{ default: module.exports }`, so the left arm wins. Vite hands back the flattened
 * namespace with no `default`, so the right arm wins. Bundlers supply both and either is the same
 * object.
 *
 * 🔴 **It tests the VALUE, not the key.** `'default' in moduleNamespace` looks equivalent and is
 * not: a host that defines `default` as a present-but-`undefined` property would pass that check and
 * hand back `undefined`, reproducing the crash this function exists to prevent.
 *
 * ⚠ The parameter is `unknown` rather than the namespace's own type. Casting a namespace import
 * directly to `{ default?: … }` is `TS2352` — "neither type sufficiently overlaps" — because a
 * namespace import is a distinct type to TypeScript. `unknown` is the narrowing TypeScript itself
 * suggests, and it is the more honest signature: the entire point is that the runtime shape is not
 * what the published typings describe.
 *
 * ⚠ The type parameter is a bare `T` because `@typescript-eslint/naming-convention` configures
 * `typeParameter` as `StrictPascalCase` with **no `prefix` option**, so a `T`-prefixed name like
 * `TApi` fails on its two leading capitals. Every generic in the repo is a single letter.
 *
 * @typeParam T - The subset of the module's exports the caller needs.
 * @param moduleNamespace - The result of a namespace import.
 * @returns The module's `default` when the host synthesized a usable one, else the namespace itself.
 */
export function unwrapInteropDefault<T>(moduleNamespace: unknown): T {
	return (moduleNamespace as { readonly default?: T }).default ?? (moduleNamespace as T);
}

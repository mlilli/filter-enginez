/**
 * Wine corpus loaders — the lazy, no-top-level-await source of both tiers.
 *
 * @remarks
 * Extracted from `./data.ts` so that importing the wine **MSW handlers** (or anything that only
 * needs a lazy corpus) does NOT drag in `data.ts`'s module-load-time `await` — which materializes
 * the ~9 MB default-tier JSON and, in a Vite dev transform, OOM'd the dev server (the blocker behind
 * serving the wine corpus through streaming MSW handlers). Nothing in this module
 * runs at import time: every corpus read is behind an `async` function, and the results are memoized
 * so repeated callers (the list handler + the filter-config builder) pay the load exactly once.
 *
 * `data.ts` exposes the eager `wines` const (for the synchronous engine/worker boot paths that
 * want it) by `await`-ing `loadDefaultWines()` at its own module top — so that eager cost lives
 * only in `data.ts`, not in every module that transitively imports the handlers.
 *
 * @packageDocumentation
 */

import type { Wine } from './types.js';

import { DEFAULT_TIER_SIZE } from '../tier-sizes.js';
import { generateWines } from './generate.js';

/**
 * Whether this module was loaded from the filesystem (Node, vitest) rather than over HTTP (a browser).
 *
 * @remarks
 * The JSON loaders below read files that sit next to this module on disk: gitignored, locally generated,
 * and never part of a package or a build. In a browser that lookup can only fail — and under a Vite
 * dev server it fails noisily: the import resolves into the dep optimizer's cache directory, and Vite
 * logs "The file does not exist at …/.vite/deps/data-real-default.json" on every load. Skipping the
 * attempt when the module was served over HTTP keeps browsers on the synthetic generator, where they
 * would have ended up anyway, without the request or the warning.
 *
 * Some bundled server runtimes, such as Cloudflare Workers, leave `import.meta.url` undefined. Nothing
 * sits next to the module there either, so an undefined URL counts as "not from disk".
 *
 * @internal
 */
const isLoadedFromDisk = (import.meta.url as string | undefined)?.startsWith('file:') === true;

/**
 * Import a gitignored JSON corpus that may sit next to this module on disk; `null` when it is absent.
 *
 * @remarks
 * 🔴 The specifier arrives as a PARAMETER and is imported behind `@vite-ignore` — never as a string
 * literal, and not as a local `const` either. These files are gitignored and not in the published
 * tarball, so for every consumer they are ABSENT, and bundlers resolve a literal `import('./x.json')`
 * at build time:
 *
 * - a literal fails the production build of any consuming app
 *   (`[UNRESOLVED_IMPORT] Could not resolve './data-real-default.json'`) and fails `tsc` on any fresh
 *   clone (TS2307), even though the `catch` below exists to handle exactly that absence at runtime;
 * - a local `const path = './data-real-default.json'` is not enough either: a SvelteKit SSR build
 *   (Rolldown) inlines the constant into a literal, and adapter-node's Rollup pass then fails on it.
 *
 * A parameter is a runtime value at the call site's discretion, so no bundler folds it, and the lookup
 * happens at runtime, where the `catch` can do its job.
 *
 * Not attempted at all when this module was served over HTTP (see {@link isLoadedFromDisk}). Under
 * Vite's module runner (vitest) the JSON loads; plain Node rejects a JSON import without a
 * `type: 'json'` attribute, which lands in the same `catch` — both take the procedural tiers, by design.
 *
 * No `with: { type: 'json' }` assertion: Vite serves JSON as transformed-to-ESM (`text/javascript`),
 * which rejects the assertion; the resolved module's `.default` is the parsed array either way.
 *
 * @param specifier - Path relative to this module, e.g. `./data-real-default.json`.
 * @returns The parsed records, or `null` when the file is absent or cannot be imported here.
 *
 * @internal
 */
async function tryImportLocalCorpus(specifier: string): Promise<null | readonly Wine[]> {
	/* v8 ignore next 3 -- browser-only path: every test loads this module from disk (`file:` URL). */
	if (!isLoadedFromDisk) {
		return null;
	}

	try {
		const mod = (await import(/* @vite-ignore */ specifier)) as { default: readonly Wine[] };

		return mod.default;
	} catch {
		return null;
	}
}

/**
 * The real default-tier dataset (`data-real-default.json`, ~9 MB, gitignored — only present after
 * `pnpm regen:wine:real --accept-data-license`).
 *
 * @internal
 */
const tryLoadRealDefault = async (): Promise<null | readonly Wine[]> => tryImportLocalCorpus('./data-real-default.json');

/**
 * The full-tier real corpus (`data-real-full.json`, ~116 MB, gitignored — same importer). Never a
 * build input: apps serve it statically from their own `public/` folder instead.
 *
 * @internal
 */
const tryLoadRealFull = async (): Promise<null | readonly Wine[]> => tryImportLocalCorpus('./data-real-full.json');

/**
 * The procedural full tier (`data-full.json`, gitignored — only after `pnpm regen:mock-data --full`).
 * Second-choice full-tier source when the real full corpus isn't materialized.
 *
 * @internal
 */
const tryLoadProceduralFull = async (): Promise<null | readonly Wine[]> => tryImportLocalCorpus('./data-full.json');

/** Memoized default-tier promise — the load (real JSON or procedural fallback) happens once. */
let defaultWinesPromise: Promise<readonly Wine[]> | null = null;

/**
 * Lazily resolve the default-tier wine corpus — the synthetic procedural generator, unless the
 * locally downloaded Kaggle corpus (10 k stratified, CC BY-NC-SA 4.0, gitignored and never packaged)
 * is present and loadable. Memoized: the first caller pays the load, the rest await the same
 * promise.
 */
export async function loadDefaultWines(): Promise<readonly Wine[]> {
	defaultWinesPromise ??= tryLoadRealDefault().then((real) => real ?? generateWines(DEFAULT_TIER_SIZE));

	return defaultWinesPromise;
}

/**
 * Lazily resolve the full corpus — the locally downloaded real corpus first (a development checkout
 * only; never packaged), then the synthetic full tier written by `pnpm regen:mock-data --full`.
 * Returns `null` only when neither full-tier JSON exists (the consumer then falls back to the
 * default tier).
 *
 * @remarks
 * The full tier is the worker-bridge / streaming target (~130 k records either way).
 */
export async function loadFullWines(): Promise<null | readonly Wine[]> {
	const real = await tryLoadRealFull();

	if (real !== null) {
		return real;
	}

	return tryLoadProceduralFull();
}

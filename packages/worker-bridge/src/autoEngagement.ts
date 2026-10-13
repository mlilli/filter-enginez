/**
 * `shouldEngageWorker` — the policy function for the `'auto'` worker-engagement mode.
 *
 * @remarks
 * Per `docs/architecture.md` §15.2. Decides whether the worker should be engaged based on
 * dataset size + environment + consumer policy. Consumers can pass an explicit `boolean`,
 * `'never'`, `'always'`, a numeric threshold, or `'auto'` (delegates to the heuristic below).
 *
 * **The heuristic.** `'auto'` engages the worker when source data size ≥ 50,000 items. The
 * threshold is a reasoned estimate of where a postMessage round trip stops costing more than the
 * main-thread work it removes; it is not a benchmarked crossover (the benchmark suite times
 * in-process work only). Pass a number to set your own.
 *
 * **No-worker fallback.** When `Worker` is undefined (Node, certain edge runtimes, very old
 * browsers, jsdom test env), `shouldEngageWorker` returns `false` regardless of policy except
 * `'always'` — and `'always'` will then surface the actual worker-construction error to the
 * consumer (which is the right outcome — they explicitly asked for a worker in an environment
 * that doesn't support one).
 *
 * @packageDocumentation
 */

/**
 * Consumer-facing worker-engagement policy.
 *
 * - **`'auto'`** — engage when `Worker` is available AND source data size ≥ 50,000 items
 * - **`'always'`** — engage unconditionally (throws if `Worker` is unavailable)
 * - **`'never'`** — never engage; engine runs on the main thread regardless of size
 * - **`number`** — engage when source data size ≥ N items (same `Worker`-availability fallback as `'auto'`)
 * - **`boolean`** — `true` is `'always'`, `false` is `'never'` (convenience for boolean toggles)
 */
export type WorkerEngagementPolicy = boolean | number | 'always' | 'auto' | 'never';

/**
 * The default item-count threshold for `'auto'` mode — the estimate described in the module
 * docs. Pass a numeric policy to use a threshold measured on your own data.
 */
export const DEFAULT_AUTO_THRESHOLD = 50_000;

// Browser-only global: structural declaration so the isomorphic tsconfig (no DOM lib)
// compiles. At runtime, the browser provides `Worker`; Node / edge runtimes leave it
// undefined and we fall back to the no-worker branch below.
declare const Worker: unknown;

// #region docs:should-engage-worker
/**
 * Decide whether to engage the worker for a given source data size + consumer policy.
 *
 * @remarks
 * Policy resolution order:
 *
 *   1. `boolean` is normalized: `true` → `'always'`, `false` → `'never'` (so the rest of the
 *      function has a unified shape to switch over).
 *   2. `'never'` → always `false`. End of story.
 *   3. `'always'` → always `true`, even when `Worker` is undefined. The actual
 *      `wrapInWorker(...)` call will then throw a clear error — which is the right outcome,
 *      since the consumer explicitly asked for a worker in an environment that doesn't have one.
 *   4. `'auto'` or `number` → check `Worker` availability first (return `false` if absent),
 *      then compare `sourceDataLength` to the threshold (`DEFAULT_AUTO_THRESHOLD` for `'auto'`,
 *      the literal value for a numeric policy).
 *
 * @param sourceDataLength - Item count of the current source data
 * @param policy - Consumer's worker-engagement policy
 * @returns `true` if the worker should be used, `false` to run on the main thread
 *
 * @example
 *   const useWorker = shouldEngageWorker(wines.length, 'auto');
 *   const engine = useWorker
 *     ? await wrapInWorker<Wine>({ worker: new WineWorker(), factoryName: 'wineEngine' })
 *     : createFilterEngine<Wine>({ sourceData: wines });
 */
export function shouldEngageWorker(
	sourceDataLength: number,
	policy: WorkerEngagementPolicy,
): boolean {
	// Normalize boolean shorthands into their string-policy equivalents so the switch below
	// only has to reason about the canonical four shapes.
	const normalizedPolicy: Exclude<WorkerEngagementPolicy, boolean>
		= policy === true ? 'always'
			: policy === false ? 'never'
				: policy;

	if (normalizedPolicy === 'never') {
		return false;
	}
	if (normalizedPolicy === 'always') {
		return true;
	}

	// 'auto' and numeric thresholds both require `Worker` to actually be present at runtime;
	// without it we silently fall back to main-thread execution (the engine still works, it
	// just runs in the main event loop instead of offloading).
	if (typeof Worker === 'undefined') {
		return false;
	}

	if (normalizedPolicy === 'auto') {
		return sourceDataLength >= DEFAULT_AUTO_THRESHOLD;
	}

	// Numeric threshold — engage when source data size meets or exceeds the consumer's number.
	return sourceDataLength >= normalizedPolicy;
}
// #endregion docs:should-engage-worker

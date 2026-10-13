/**
 * The two async reactive adapters' `.core` shims must expose the same surface.
 *
 * @remarks
 * ### The failure this makes impossible
 *
 * `reactive-signals` and `reactive-rxjs` are siblings by design — the RxJS adapter's own file header
 * says "Same architectural contract" as the signals version. **That is a statement of intent; this
 * guard is what checks it.** Both are wrappers over the identical `FilterEngineAsync`, and both
 * synthesize a synchronous `FilterEngine` shim so a consumer can read state without awaiting.
 *
 * A gap between them breaks a consumer of the less-used adapter outright. A shim that throws on
 * `engine.core.devtools` where its twin mirrors it leaves every route built on it without
 * time-travel controls or a devtools panel; a shim missing its twin's expression rehydration restores
 * state differently depending on the adapter.
 *
 * **The signals adapter is the well-travelled one, and "the twin does X" is not evidence that this
 * one does.** A divergence here has no symptom in the RxJS package's own tests — each adapter's
 * suite asserts what that adapter does — and no symptom in a browser until someone builds a route on
 * the less-used half.
 *
 * ### Why it lives in `tests/tooling` rather than in either package
 *
 * Neither package can own it. The assertion is *about the relationship between the two*, and putting
 * it in one would mean that package depending on the other purely to test itself — a dependency edge
 * that exists only as an artifact of where a test happens to live. `tooling` is the project for
 * exactly this: repo-level invariants no single package can hold.
 *
 * ### Built through the ADAPTERS, not from hand-assembled deps
 *
 * Each shim's builder takes a bag of that adapter's own primitives — signals on one side, RxJS
 * subjects on the other — so constructing them directly would mean writing two fixtures that could
 * themselves drift, and asserting parity between two things this file made up. Booting both real
 * adapters over their fake async engines tests the composition that actually ships, and costs a few
 * milliseconds.
 */

import { describe, expect, it } from 'vitest';

import { createRxJsEngineFromAsync } from '../../packages/reactive-rxjs/src/createRxJsEngineFromAsync.js';
import { makeFakeAsyncEngine as makeFakeRxJsAsyncEngine } from '../../packages/reactive-rxjs/src/fakeAsyncEngine.js';
import { createSignalsEngineFromAsync } from '../../packages/reactive-signals/src/createSignalsEngineFromAsync.js';
import { makeFakeAsyncEngine as makeFakeSignalsAsyncEngine } from '../../packages/reactive-signals/src/fakeAsyncEngine.js';

/** Both adapters' `.core` shims, booted over their own fake async engines. */
async function bothShims(): Promise<{
	readonly rxjs: Record<string, unknown>;
	readonly signals: Record<string, unknown>;
}> {
	// `.engine` — the fakes return a control surface wrapping the engine, not the engine itself.
	const signalsEngine = await createSignalsEngineFromAsync(makeFakeSignalsAsyncEngine<unknown>().engine);
	const rxjsEngine = await createRxJsEngineFromAsync(makeFakeRxJsAsyncEngine<unknown>().engine);

	return {
		rxjs: rxjsEngine.core as unknown as Record<string, unknown>,
		signals: signalsEngine.core as unknown as Record<string, unknown>,
	};
}

/** Every own enumerable key of a shim, sorted. */
function surfaceOf(shim: Record<string, unknown>): readonly string[] {
	return Object.keys(shim).sort();
}

describe('the two async adapters expose the same .core surface', () => {
	it('agrees on the key set', async () => {
		// Compared as sets rather than "does RxJS have everything signals has": the asymmetry could
		// point either way, and a one-directional check would go green on the day the RxJS adapter
		// grew something its twin lacked.
		const { rxjs, signals } = await bothShims();

		expect(surfaceOf(rxjs), 'reactive-rxjs .core surface').toEqual(surfaceOf(signals));
	});

	it('agrees on the KIND of each member', async () => {
		// A key present as an accessor where its twin has a method is a divergence the key-set check
		// cannot see, and it is the shape a mirror-vs-accessor refactor produces.
		//
		// **Classified from property DESCRIPTORS, never by reading the value**, and that is not a
		// micro-optimization: both shims deliberately expose throwing getters for the members a
		// worker-backed engine cannot answer synchronously (`bitmapIndex` says so in its own message).
		// A `typeof shim[key]` probe detonates those. Reading every member of an object is a thing test
		// code does and production code does not.
		const { rxjs, signals } = await bothShims();
		const kinds = (shim: Record<string, unknown>): Readonly<Record<string, string>> =>
			Object.fromEntries(
				surfaceOf(shim).map((key) => {
					const descriptor = Object.getOwnPropertyDescriptor(shim, key);

					if (descriptor?.get !== undefined) {
						return [key, 'accessor'];
					}

					return [key, typeof descriptor?.value === 'function' ? 'method' : 'value'];
				}),
			);

		expect(kinds(rxjs), 'reactive-rxjs member kinds').toEqual(kinds(signals));
	});

	it('exposes devtools on both', async () => {
		// Named explicitly rather than left to the key-set assertion above. A shim that throws here
		// where its twin mirrors leaves every route on that adapter silently missing its time-travel
		// controls. A regression should fail with the name of the thing that broke.
		const { rxjs, signals } = await bothShims();

		expect(signals['devtools'], 'signals .core.devtools').toBeDefined();
		expect(rxjs['devtools'], 'rxjs .core.devtools').toBeDefined();
	});

	it('finds a surface worth comparing at all', async () => {
		// The vacuity guard. Two empty objects are equal, and a shim that stopped exposing anything —
		// or a fake that failed to boot — would satisfy every assertion above for the worst possible
		// reason. `FilterEngine` is a wide interface; a couple of dozen members is the honest floor.
		const { signals } = await bothShims();

		expect(surfaceOf(signals).length).toBeGreaterThan(20);
	});
});

/**
 * Tests for the store-layer barrel — `store/index.ts`.
 *
 * @remarks
 * A pure re-export barrel: it forwards the store's runtime values (`captureSnapshot`,
 * `restoreSnapshot`, `InternalStore`, `Dispatcher`) and type-only symbols. This suite asserts
 * the runtime bindings are live (constructible / callable) and identical to their source-module
 * exports, so the public surface stays wired correctly. Type-only re-exports (`Action`,
 * `ActionType`, `EngineSnapshot`, `EngineMode`) are validated at compile time by `import type`.
 */

import { describe, expect, it } from 'vitest';

import type { Action, ActionType, EngineMode, EngineSnapshot } from './index.js';

import { Dispatcher as DispatcherSource } from './Dispatcher.js';
import * as barrel from './index.js';
import { InternalStore as InternalStoreSource } from './InternalStore.js';
import { captureSnapshot as captureSource, restoreSnapshot as restoreSource } from './snapshots.js';

describe('store/index barrel', () => {
	it('re-exports the runtime values bound to their source-module identities', () => {
		expect(barrel.InternalStore).toBe(InternalStoreSource);
		expect(barrel.Dispatcher).toBe(DispatcherSource);
		expect(barrel.captureSnapshot).toBe(captureSource);
		expect(barrel.restoreSnapshot).toBe(restoreSource);
	});

	it('exposes constructible / callable runtime exports', () => {
		const store = new barrel.InternalStore<number>([1, 2, 3]);
		const dispatcher = new barrel.Dispatcher<number>(store);

		dispatcher.dispatch({ payload: { items: [9]}, type: 'WORKING_SET_SET' });
		expect(store.workingSet.value).toEqual([9]);

		const snapshot = barrel.captureSnapshot(store);

		barrel.restoreSnapshot(store, snapshot);
		expect(store.rules.value.size).toBe(0);
	});

	it('forwards the type-only symbols for compile-time consumption', () => {
		// These bindings exist only at the type level; referencing them keeps the import live
		// and documents the barrel's type surface.
		const mode: EngineMode = 'flat-map';
		const action: Action = { type: 'RESET' };
		const actionType: ActionType = 'RESET';
		const snapshot: Pick<EngineSnapshot, 'capturedAt'> = { capturedAt: 0 };

		expect(mode).toBe('flat-map');
		expect(action.type).toBe('RESET');
		expect(actionType).toBe('RESET');
		expect(snapshot.capturedAt).toBe(0);
	});
});

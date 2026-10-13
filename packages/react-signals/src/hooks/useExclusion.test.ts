/**
 * Tests for `useExclusion` — per-candidate "would selecting this empty the results?" projection,
 * including the graceful degrade when the engine carries no optional `swrRevision` signal.
 */

import { type FilterRule, inSet } from '@filter-enginez/core';
import { describe, expect, it } from 'vitest';

import { demoData, type DemoItem, makeSignalsEngine, renderHookWithEngine } from '../test-support/renderWithEngine.js';
import { useExclusion } from './useExclusion.js';

/** Stable per-value rule builder — module-level so its identity never thrashes the hook's memo. */
const buildColorRule = (color: string): FilterRule => inSet('color', [color]);

describe('useExclusion', () => {
	it('maps each candidate value to its projected count and emptiness', () => {
		const engine = makeSignalsEngine<DemoItem>({ sourceData: demoData });
		const { result } = renderHookWithEngine(
			() => useExclusion('color', ['red', 'blue', 'green'], buildColorRule),
			engine,
		);

		expect(result.current.get('red')).toEqual({ projectedCount: 2, wouldBeEmpty: false });
		expect(result.current.get('blue')).toEqual({ projectedCount: 1, wouldBeEmpty: false });
		expect(result.current.get('green')).toEqual({ projectedCount: 0, wouldBeEmpty: true });
	});

	it('degrades gracefully when the engine carries no swrRevision signal', () => {
		const base = makeSignalsEngine<DemoItem>({ sourceData: demoData });
		// A third-party / older adapter may omit the optional `swrRevision` — the hook must fall
		// back to the constant-zero signal rather than throw.
		const engine = new Proxy(base, {
			get(target, prop, receiver): unknown {
				if (prop === 'swrRevision') {
					return undefined;
				}

				return Reflect.get(target, prop, receiver) as unknown;
			},
		});
		const { result } = renderHookWithEngine(
			() => useExclusion('color', ['red'], buildColorRule),
			engine,
		);

		expect(result.current.get('red')).toEqual({ projectedCount: 2, wouldBeEmpty: false });
	});
});

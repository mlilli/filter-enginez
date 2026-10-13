/**
 * Tests for `useSimilar` — the MinHash + LSH "more like this" surface: returns neighbors when
 * similarity is configured, throws an actionable error when it isn't.
 */

import { describe, expect, it, vi } from 'vitest';

import { demoData, type DemoItem, makeRxJsEngine, renderHookWithEngine } from '../test-support/renderWithEngine.js';
import { useSimilar } from './useSimilar.js';

/** A red anchor sharing the sole signature attribute with demoData's red items (a, c). */
const anchor: DemoItem = { color: 'red', id: 'anchor', price: 15 };

describe('useSimilar', () => {
	it('returns items similar to the anchor when similarity is configured', () => {
		const engine = makeRxJsEngine<DemoItem>({
			sourceData: demoData,
		});
		const { result } = renderHookWithEngine(() => useSimilar<DemoItem>(anchor, { k: 5 }, { attributes: ['color']}), engine);

		expect(Array.isArray(result.current)).toBe(true);
		// The red item (c) shares the sole signature attribute, so it lands in the neighbors.
		expect(result.current.some((neighbor) => neighbor.item.id === 'c')).toBe(true);
	});

	it('throws a clear error when similarity is not configured', () => {
		const engine = makeRxJsEngine<DemoItem>({ sourceData: demoData });
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		expect(() => renderHookWithEngine(() => useSimilar<DemoItem>(anchor), engine)).toThrow();

		errorSpy.mockRestore();
	});
});

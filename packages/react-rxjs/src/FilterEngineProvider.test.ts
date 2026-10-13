/**
 * Tests for `FilterEngineProvider` + `FilterEngineContext` — the engine reaches descendant hooks
 * through React context, and the context defaults to `null` when no provider wraps the tree.
 */

import { useContext } from 'react';
import { describe, expect, it } from 'vitest';

import { FilterEngineContext } from './FilterEngineContext.js';
import { demoData, type DemoItem, makeRxJsEngine, renderHook, renderHookWithEngine } from './test-support/renderWithEngine.js';

describe('FilterEngineProvider', () => {
	it('defaults the context to null when no provider is present', () => {
		const { result } = renderHook(() => useContext(FilterEngineContext));

		expect(result.current).toBeNull();
	});

	it('provides the engine instance to descendants via context', () => {
		const engine = makeRxJsEngine<DemoItem>({ sourceData: demoData });
		const { result } = renderHookWithEngine(() => useContext(FilterEngineContext), engine);

		// The provider erases the generic through `as unknown as` — object identity is preserved.
		expect(result.current).toBe(engine);
	});
});

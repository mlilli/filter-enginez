/**
 * Tests for `useFilterEngine` — the context escape hatch: returns the engine inside a provider,
 * throws an actionable error outside one.
 */

import { describe, expect, it, vi } from 'vitest';

import { demoData, type DemoItem, makeRxJsEngine, renderHook, renderHookWithEngine } from '../test-support/renderWithEngine.js';
import { useFilterEngine } from './useFilterEngine.js';

describe('useFilterEngine', () => {
	it('returns the engine from context inside a provider', () => {
		const engine = makeRxJsEngine<DemoItem>({ sourceData: demoData });
		const { result } = renderHookWithEngine(() => useFilterEngine<DemoItem>(), engine);

		expect(result.current).toBe(engine);
	});

	it('throws a helpful error when called outside a provider', () => {
		// React logs the render error to console.error even though we assert the throw — silence it
		// so the run stays clean.
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		expect(() => renderHook(() => useFilterEngine())).toThrow(expect.objectContaining({
			code: 'BINDING_ENGINE_NOT_PROVIDED',
			message: expect.stringMatching(/outside a <FilterEngineProvider>/) as unknown,
			name: 'FilterEngineConfigError',
		}));

		errorSpy.mockRestore();
	});
});

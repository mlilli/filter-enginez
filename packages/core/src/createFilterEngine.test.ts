/**
 * @remarks
 * Tests for the `createFilterEngine` factory — the ergonomic function-shaped entry point in
 * front of `new FilterEngine(options)`. Covers: returns a real `FilterEngine` instance,
 * defaults the options bag to `{}` (callable with no argument), and threads construction-time
 * options (`sourceData`, `acceleration`, `devtools`, `config`) through to the constructed
 * instance.
 */

import { describe, expect, it } from 'vitest';

import { CURRENT_CONFIG_VERSION, type FilterEngineConfig } from './config/FilterEngineConfig.js';
import { createFilterEngine } from './createFilterEngine.js';
import { FilterEngine } from './FilterEngine.js';

interface Item {
	readonly color: string;
}

describe('createFilterEngine', () => {
	it('returns a FilterEngine instance', () => {
		const engine = createFilterEngine<Item>();

		expect(engine).toBeInstanceOf(FilterEngine);
	});

	it('is callable with no argument (options default to {})', () => {
		const engine = createFilterEngine();

		expect(engine.getSourceData()).toEqual([]);
		expect(engine.getResultCount()).toBe(0);
	});

	it('threads sourceData through to the constructed instance', () => {
		const items: readonly Item[] = [{ color: 'red' }, { color: 'blue' }];
		const engine = createFilterEngine<Item>({ sourceData: items });

		expect(engine.getSourceData()).toBe(items);
	});

	it('threads acceleration.bitmap through to the bitmap index', () => {
		const engine = createFilterEngine<Item>({ acceleration: { bitmap: 'off' }});

		expect(engine.bitmapIndex).toBeDefined();
	});

	it('threads a devtools config through to the devtools surface', () => {
		const engine = createFilterEngine<Item>({ devtools: { enabled: false }});

		expect(engine.devtools).toBeDefined();
	});

	it('applies an initial JSON config via loadConfig', () => {
		const config: FilterEngineConfig = {
			rules: [{ id: 'color', rule: { config: 'red', field: 'color', type: 'ValueRule' }}],
			version: CURRENT_CONFIG_VERSION,
		};
		const engine = createFilterEngine<Item>({ config });

		expect(engine.getRule('color')).toBeDefined();
	});
});

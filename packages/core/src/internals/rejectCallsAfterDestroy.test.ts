/**
 * @remarks
 * The destroyed-engine guard, two ways. Against `FilterEngine` itself, driven off the prototype so a
 * public method added later is asserted the day it exists: every one throws
 * `FilterEngineDestroyedError` after `destroy()`, names itself in the message, and works before.
 * Against a small synthetic class, the guard's own rules: what it skips (constructor, `destroy`,
 * `_`-prefixed members, accessors) and that wrapped methods keep `this` and their return value.
 */

import { describe, expect, it } from 'vitest';

import { FilterEngineDestroyedError, FilterEngineError } from '../errors/index.js';
import { FilterEngine } from '../FilterEngine.js';
import { rejectCallsAfterDestroy } from './rejectCallsAfterDestroy.js';

/**
 * The public method names on `FilterEngine.prototype` — derived, not listed, so the suite grows
 * with the class.
 *
 * @returns Every function-valued own property except `constructor`, `destroy` and `_`-members
 */
function publicEngineMethodNames(): string[] {
	return Object.entries(Object.getOwnPropertyDescriptors(FilterEngine.prototype))
		.filter(([name, descriptor]) => typeof descriptor.value === 'function'
			&& name !== 'constructor' && name !== 'destroy' && !name.startsWith('_'))
		.map(([name]) => name);
}

describe('FilterEngine after destroy()', () => {
	const methodNames = publicEngineMethodNames();

	it('finds the public surface to guard (vacuity check)', () => {
		// A guard over zero methods would pass every assertion below.
		expect(methodNames.length).toBeGreaterThanOrEqual(25);
		expect(methodNames).toEqual(expect.arrayContaining(['addRule', 'getResults', 'loadConfig', 'subscribe']));
	});

	it.each(publicEngineMethodNames())('%s() throws FilterEngineDestroyedError naming itself', async (methodName) => {
		const engine = new FilterEngine<{ readonly color: string }>({ sourceData: [{ color: 'red' }]});
		const method = (engine as unknown as Record<string, (...args: unknown[]) => unknown>)[methodName];

		await engine.destroy();

		let thrown: unknown;

		try {
			method?.call(engine);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(FilterEngineDestroyedError);
		expect(thrown).toBeInstanceOf(FilterEngineError);
		expect(thrown).toMatchObject({ code: 'ENGINE_DESTROYED', name: 'FilterEngineDestroyedError' });
		expect((thrown as Error).message).toContain(`FilterEngine.${methodName}() was called after destroy()`);
	});

	it('reports isDestroyed, keeps destroy() idempotent, and works normally before destroy', async () => {
		const engine = new FilterEngine<{ readonly color: string }>({ sourceData: [{ color: 'red' }]});

		expect(engine.isDestroyed).toBe(false);
		expect(engine.getResultCount()).toBe(1);

		await engine.destroy();
		await expect(engine.destroy()).resolves.toBeUndefined();
		expect(engine.isDestroyed).toBe(true);
	});

	it('leaves an unsubscribe obtained before destroy() callable', async () => {
		const engine = new FilterEngine({ sourceData: []});
		const unsubscribe = engine.subscribe(() => undefined);

		await engine.destroy();
		expect(() => {
			unsubscribe();
		}).not.toThrow();
	});
});

describe('rejectCallsAfterDestroy', () => {
	/** A destroyable class with one of each member kind the guard distinguishes. */
	class Widget {
		isDestroyedFlag = false;

		readonly label: string;

		constructor(label: string) {
			this.label = label;
		}

		_internal(): string {
			return this.label;
		}

		describe(suffix: string): string {
			return `${this.label}${suffix}`;
		}

		destroy(): string {
			this.isDestroyedFlag = true;

			return 'destroyed';
		}

		get isDestroyed(): boolean {
			return this.isDestroyedFlag;
		}
	}

	const guarded = rejectCallsAfterDestroy(Widget.prototype, 'Widget');

	it('wraps only plain public methods', () => {
		expect(guarded).toEqual(['describe']);
	});

	it('preserves `this`, arguments and return values while alive', () => {
		expect(new Widget('w').describe('!')).toBe('w!');
	});

	it('throws once destroyed, but leaves destroy, accessors and _-members callable', () => {
		const widget = new Widget('w');

		expect(widget.destroy()).toBe('destroyed');
		expect(widget.destroy()).toBe('destroyed');
		expect(widget.isDestroyed).toBe(true);
		expect(widget._internal()).toBe('w');
		expect(() => widget.describe('!')).toThrow(
			expect.objectContaining({ code: 'ENGINE_DESTROYED', message: expect.stringContaining('Widget.describe()') as unknown }),
		);
	});
});

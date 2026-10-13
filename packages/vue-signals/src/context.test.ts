// @vitest-environment jsdom
/**
 * Unit tests for the provide/inject engine context.
 *
 * @remarks
 * Mounts a tiny two-component app (parent provides, child injects) with `createApp` — no
 * `@vue/test-utils` needed. Runs under jsdom (see the environment directive above) because mounting
 * needs a DOM host.
 *
 * @packageDocumentation
 */

import type { SignalsEngine } from '@filter-enginez/reactive-signals';

import { describe, expect, it } from 'vitest';
import { createApp, defineComponent, h } from 'vue';

import { provideFilterEngine, useFilterEngine } from './context.js';

/** A stand-in engine — identity is all these tests check. */
const fakeEngine = { marker: 'engine' } as unknown as SignalsEngine<unknown>;

describe('provideFilterEngine / useFilterEngine', () => {
	it('provides the engine to a descendant via inject', () => {
		let injected: unknown;
		const Child = defineComponent({
			setup() {
				injected = useFilterEngine();

				return () => h('div');
			},
		});
		const Parent = defineComponent({
			setup() {
				provideFilterEngine(fakeEngine);

				return () => h(Child);
			},
		});
		const app = createApp(Parent);
		const host = document.createElement('div');

		app.mount(host);
		expect(injected).toBe(fakeEngine);
		app.unmount();
	});

	it('throws when no engine has been provided', () => {
		const Solo = defineComponent({
			setup() {
				useFilterEngine();

				return () => h('div');
			},
		});
		const app = createApp(Solo);
		const host = document.createElement('div');

		expect(() => app.mount(host)).toThrow(expect.objectContaining({
			code: 'BINDING_ENGINE_NOT_PROVIDED',
			message: expect.stringMatching(/no Filter EngineZ engine/u) as unknown,
			name: 'FilterEngineConfigError',
		}));
	});
});

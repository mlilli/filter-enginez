/**
 * @remarks
 * Tests for `ReduxDevtoolsBridge`. The bridge reads `globalThis.__REDUX_DEVTOOLS_EXTENSION__`;
 * we stub it via `vi.stubGlobal`. Covers: extension absent (inert no-op, isConnected false),
 * extension present (connect succeeds, init/recordAction/subscribe/disconnect pass through),
 * `connect` throwing (caught → null connection), the custom `name` passed to connect, the
 * optional-`unsubscribe`-absent branch on disconnect, and the plain-JSON encoding of what is
 * sent (rules serialized, data actions reduced to their type, unserializable rules named).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Action } from '../store/Action.js';
import type { EngineSnapshot } from '../store/snapshots.js';

import { PredicateRule } from '../rules/PredicateRule.js';
import { ValueRule } from '../rules/ValueRule.js';
import { ReduxDevtoolsBridge } from './ReduxDevtoolsBridge.js';
import { serializeSnapshot } from './snapshotCodec.js';

interface FakeConnection {
	init: ReturnType<typeof vi.fn>;
	send: ReturnType<typeof vi.fn>;
	subscribe: ReturnType<typeof vi.fn>;
	unsubscribe?: ReturnType<typeof vi.fn>;
}

function snapshot(): EngineSnapshot {
	return {
		capturedAt: 0,
		expression: null,
		groups: [],
		lastChangeRuleId: null,
		rules: new Map(),
		sourceDataVersion: 0,
		workingSetVersion: 0,
	};
}

const sampleAction: Action = { type: 'RESET' };

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('ReduxDevtoolsBridge', () => {
	it('is inert when the extension is absent', () => {
		vi.stubGlobal('__REDUX_DEVTOOLS_EXTENSION__', undefined);
		const bridge = new ReduxDevtoolsBridge();

		expect(bridge.isConnected).toBe(false);
		// All passthroughs are safe no-ops with no connection.
		expect(() => bridge.init(snapshot())).not.toThrow();
		expect(() => bridge.recordAction(sampleAction, snapshot())).not.toThrow();
		expect(() => bridge.subscribe(() => undefined)).not.toThrow();
		expect(() => bridge.disconnect()).not.toThrow();
	});

	it('connects when the extension is present and forwards passthrough calls', () => {
		const connection: FakeConnection = {
			init: vi.fn(),
			send: vi.fn(),
			subscribe: vi.fn(),
			unsubscribe: vi.fn(),
		};
		const connect = vi.fn(() => connection);

		vi.stubGlobal('__REDUX_DEVTOOLS_EXTENSION__', { connect });
		const bridge = new ReduxDevtoolsBridge();

		expect(bridge.isConnected).toBe(true);

		const snap = snapshot();

		bridge.init(snap);
		expect(connection.init).toHaveBeenCalledWith(serializeSnapshot(snap));

		bridge.init(null);
		expect(connection.init).toHaveBeenLastCalledWith(null);

		bridge.recordAction(sampleAction, snap);
		expect(connection.send).toHaveBeenCalledWith(sampleAction, serializeSnapshot(snap));

		const listener = (): void => undefined;

		bridge.subscribe(listener);
		expect(connection.subscribe).toHaveBeenCalledWith(listener);

		bridge.disconnect();
		expect(connection.unsubscribe).toHaveBeenCalled();
		expect(bridge.isConnected).toBe(false);
	});

	it('passes the custom display name to connect', () => {
		const connect = vi.fn(() => ({ init: vi.fn(), send: vi.fn(), subscribe: vi.fn() }));

		vi.stubGlobal('__REDUX_DEVTOOLS_EXTENSION__', { connect });
		void new ReduxDevtoolsBridge('My Engine');

		expect(connect).toHaveBeenCalledWith({ name: 'My Engine' });
	});

	it('defaults the display name to "Filter EngineZ"', () => {
		const connect = vi.fn(() => ({ init: vi.fn(), send: vi.fn(), subscribe: vi.fn() }));

		vi.stubGlobal('__REDUX_DEVTOOLS_EXTENSION__', { connect });
		void new ReduxDevtoolsBridge();

		expect(connect).toHaveBeenCalledWith({ name: 'Filter EngineZ' });
	});

	it('treats a throwing connect as a failed (inert) connection', () => {
		const connect = vi.fn(() => {
			throw new Error('extension boom');
		});

		vi.stubGlobal('__REDUX_DEVTOOLS_EXTENSION__', { connect });
		const bridge = new ReduxDevtoolsBridge();

		expect(bridge.isConnected).toBe(false);
		expect(() => bridge.recordAction(sampleAction, snapshot())).not.toThrow();
	});

	it('reports a throwing connect to onFailure', () => {
		const boom = new Error('extension boom');
		const onFailure = vi.fn();

		vi.stubGlobal('__REDUX_DEVTOOLS_EXTENSION__', {
			connect: () => {
				throw boom;
			},
		});
		void new ReduxDevtoolsBridge('Engine', onFailure);

		expect(onFailure).toHaveBeenCalledExactlyOnceWith(boom);
	});

	it.each([
		['init', (bridge: ReduxDevtoolsBridge) => {
			bridge.init(null);
		}],
		['send', (bridge: ReduxDevtoolsBridge) => {
			bridge.recordAction(sampleAction, snapshot());
		}],
		['subscribe', (bridge: ReduxDevtoolsBridge) => {
			bridge.subscribe(() => undefined);
		}],
		['unsubscribe', (bridge: ReduxDevtoolsBridge) => {
			bridge.disconnect();
		}],
	] as const)('reports a throwing %s once, disconnects, and never throws into the caller', (method, act) => {
		const boom = new Error(`${method} boom`);
		const connection: FakeConnection = {
			init: vi.fn(),
			send: vi.fn(),
			subscribe: vi.fn(),
			unsubscribe: vi.fn(),
		};

		connection[method] = vi.fn(() => {
			throw boom;
		});
		vi.stubGlobal('__REDUX_DEVTOOLS_EXTENSION__', { connect: vi.fn(() => connection) });
		const onFailure = vi.fn();
		const bridge = new ReduxDevtoolsBridge('Engine', onFailure);

		expect(() => {
			act(bridge);
		}).not.toThrow();
		expect(onFailure).toHaveBeenCalledExactlyOnceWith(boom);
		expect(bridge.isConnected).toBe(false);

		// Disconnected: a second call reaches nothing, so nothing is reported twice.
		act(bridge);
		expect(onFailure).toHaveBeenCalledOnce();
	});

	it('disconnect tolerates a connection without an unsubscribe method', () => {
		// Connection lacks the optional `unsubscribe` — the `?.()` chain must short-circuit.
		const connection = { init: vi.fn(), send: vi.fn(), subscribe: vi.fn() };
		const connect = vi.fn(() => connection);

		vi.stubGlobal('__REDUX_DEVTOOLS_EXTENSION__', { connect });
		const bridge = new ReduxDevtoolsBridge();

		expect(() => bridge.disconnect()).not.toThrow();
		expect(bridge.isConnected).toBe(false);
	});

	it('sends rules in serialized form and names what cannot be serialized', () => {
		const connection = { init: vi.fn(), send: vi.fn(), subscribe: vi.fn() };

		vi.stubGlobal('__REDUX_DEVTOOLS_EXTENSION__', { connect: vi.fn(() => connection) });
		const bridge = new ReduxDevtoolsBridge();
		const red = new ValueRule('color', 'red');
		const withRule = { ...snapshot(), rules: new Map([['color', red]]) };

		bridge.recordAction({ payload: { rule: red, ruleId: 'color' }, type: 'RULE_ADDED' }, withRule);
		expect(connection.send).toHaveBeenLastCalledWith(
			{ payload: { rule: red.serialize(), ruleId: 'color' }, type: 'RULE_ADDED' },
			expect.objectContaining({ rules: [['color', red.serialize()]]}),
		);

		bridge.recordAction({ payload: { items: [1, 2]}, type: 'SOURCE_DATA_SET' }, snapshot());
		expect(connection.send).toHaveBeenLastCalledWith({ type: 'SOURCE_DATA_SET' }, expect.anything());

		const predicate = new PredicateRule<unknown>(undefined, () => true);

		bridge.recordAction(
			{ payload: { rule: predicate, ruleId: 'p' }, type: 'RULE_ADDED' },
			{ ...snapshot(), rules: new Map([['p', predicate]]) },
		);
		expect(connection.send).toHaveBeenLastCalledWith(
			{ unserializable: expect.any(String) as string },
			{ unserializable: expect.any(String) as string },
		);
	});
});

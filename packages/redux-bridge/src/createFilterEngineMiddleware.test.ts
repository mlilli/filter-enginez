/**
 * Tests for `createFilterEngineMiddleware` + `forwardToEngine` — the forwarding middleware that
 * routes `<prefix>/forward/*` intent actions (built by `forwardToEngine`) to engine method calls
 * and swallows them.
 *
 * @remarks
 * Covers: the `forwardToEngine` action shape (`type` + `meta.filterEngine` envelope, default and
 * overridden prefix); every method branch of the dispatch switch; the swallow-vs-passthrough
 * contract; the malformed-envelope passthrough; the unknown-method passthrough; and multi-engine
 * prefix isolation. A minimal fake engine records which mutating method was invoked with which
 * args.
 */

import type {
	CompositeRule,
	FilterEngine,
	FilterGroup,
	FilterRule,
	RuleId,
} from '@filter-enginez/core';

import { describe, expect, it, vi } from 'vitest';

import {
	createFilterEngineMiddleware,
	FORWARD_ACTION_PREFIX_DEFAULT,
	type ForwardableMethod,
	forwardToEngine,
} from './createFilterEngineMiddleware.js';

/**
 * Build a fake engine exposing every mutating method the middleware forwards to, each a spy.
 */
function makeFakeEngine() {
	return {
		addGroup: vi.fn<(group: FilterGroup) => void>(),
		addRule: vi.fn<(id: RuleId, rule: FilterRule) => void>(),
		clearRules: vi.fn<() => void>(),
		removeGroup: vi.fn<(groupId: string) => void>(),
		removeRule: vi.fn<(id: RuleId) => void>(),
		reset: vi.fn<() => void>(),
		setExpression: vi.fn<(expr: CompositeRule | null) => void>(),
		setSourceData: vi.fn<(items: readonly unknown[]) => void>(),
		setWorkingSet: vi.fn<(items: readonly unknown[]) => void>(),
	};
}

/**
 * Wire the middleware around a fake engine + a `next` spy, returning the invoke fn + the spies.
 */
function setup(prefix?: string) {
	const engine = makeFakeEngine();
	const next = vi.fn((action: unknown) => action);
	const middleware = createFilterEngineMiddleware({
		engine: engine as unknown as FilterEngine<unknown>,
		prefix,
	});
	const invoke = middleware({ dispatch: vi.fn(), getState: vi.fn() })(next);

	return { engine, invoke, next };
}

const fakeRule = { id: 'price' } as unknown as FilterRule;
const fakeGroup = { id: 'g1' } as unknown as FilterGroup;
const fakeExpr = { kind: 'and' } as unknown as CompositeRule;

describe('forwardToEngine', () => {
	it('builds the documented action shape with the default prefix', () => {
		const action = forwardToEngine('addRule', { rule: fakeRule, ruleId: 'price' });

		expect(action.type).toBe('FILTER_ENGINE/forward/addRule');
		expect(action.meta.filterEngine.method).toBe('addRule');
		expect(action.meta.filterEngine.payload).toEqual({ rule: fakeRule, ruleId: 'price' });
	});

	it('namespaces the type with an overridden prefix', () => {
		const action = forwardToEngine('clearRules', {}, 'WINE');

		expect(action.type).toBe('WINE/forward/clearRules');
		expect(action.meta.filterEngine.method).toBe('clearRules');
	});

	it('exposes the default-prefix constant', () => {
		expect(FORWARD_ACTION_PREFIX_DEFAULT).toBe('FILTER_ENGINE');
	});
});

describe('createFilterEngineMiddleware', () => {
	it('routes addRule with its ruleId + rule', () => {
		const { engine, invoke } = setup();

		invoke(forwardToEngine('addRule', { rule: fakeRule, ruleId: 'price' }));
		expect(engine.addRule).toHaveBeenCalledExactlyOnceWith('price', fakeRule);
	});

	it('routes removeRule with its ruleId', () => {
		const { engine, invoke } = setup();

		invoke(forwardToEngine('removeRule', { ruleId: 'color' }));
		expect(engine.removeRule).toHaveBeenCalledExactlyOnceWith('color');
	});

	it('routes clearRules (without this case clear-all would silently do nothing)', () => {
		const { engine, invoke } = setup();

		invoke(forwardToEngine('clearRules', {}));
		expect(engine.clearRules).toHaveBeenCalledTimes(1);
	});

	it('routes setExpression with its expr', () => {
		const { engine, invoke } = setup();

		invoke(forwardToEngine('setExpression', { expr: fakeExpr }));
		expect(engine.setExpression).toHaveBeenCalledExactlyOnceWith(fakeExpr);
	});

	it('routes addGroup with its group', () => {
		const { engine, invoke } = setup();

		invoke(forwardToEngine('addGroup', { group: fakeGroup }));
		expect(engine.addGroup).toHaveBeenCalledExactlyOnceWith(fakeGroup);
	});

	it('routes removeGroup with its groupId', () => {
		const { engine, invoke } = setup();

		invoke(forwardToEngine('removeGroup', { groupId: 'g1' }));
		expect(engine.removeGroup).toHaveBeenCalledExactlyOnceWith('g1');
	});

	it('routes setSourceData with its items', () => {
		const { engine, invoke } = setup();
		const items = [{ id: 1 }, { id: 2 }];

		invoke(forwardToEngine('setSourceData', { items }));
		expect(engine.setSourceData).toHaveBeenCalledExactlyOnceWith(items);
	});

	it('routes setWorkingSet with its items', () => {
		const { engine, invoke } = setup();
		const items = [{ id: 3 }];

		invoke(forwardToEngine('setWorkingSet', { items }));
		expect(engine.setWorkingSet).toHaveBeenCalledExactlyOnceWith(items);
	});

	it('routes reset', () => {
		const { engine, invoke } = setup();

		invoke(forwardToEngine('reset', {}));
		expect(engine.reset).toHaveBeenCalledTimes(1);
	});

	it('swallows forward actions — never calls next', () => {
		const { invoke, next } = setup();

		invoke(forwardToEngine('clearRules', {}));
		expect(next).not.toHaveBeenCalled();
	});

	it('passes non-forward actions through to next untouched', () => {
		const { engine, invoke, next } = setup();
		const plain = { payload: 42, type: 'some/otherAction' };

		invoke(plain);
		expect(next).toHaveBeenCalledExactlyOnceWith(plain);
		expect(engine.addRule).not.toHaveBeenCalled();
		expect(engine.clearRules).not.toHaveBeenCalled();
	});

	it('passes a malformed forward action (no meta envelope) through to next', () => {
		const { engine, invoke, next } = setup();
		const malformed = { type: 'FILTER_ENGINE/forward/addRule' };

		invoke(malformed);
		expect(next).toHaveBeenCalledExactlyOnceWith(malformed);
		expect(engine.addRule).not.toHaveBeenCalled();
	});

	it('passes an unknown forward method through to next (custom-method escape hatch)', () => {
		const { engine, invoke, next } = setup();
		const custom = {
			meta: { filterEngine: { method: 'customThing' as ForwardableMethod, payload: {}}},
			type: 'FILTER_ENGINE/forward/customThing',
		};

		invoke(custom);
		expect(next).toHaveBeenCalledExactlyOnceWith(custom);
		expect(engine.addRule).not.toHaveBeenCalled();
	});

	it('ignores actions whose prefix does not match this middleware (multi-engine isolation)', () => {
		const { engine, invoke, next } = setup('WINE');
		// A default-prefixed intent must NOT be handled by the WINE-scoped middleware.
		const otherEngineIntent = forwardToEngine('clearRules', {});

		invoke(otherEngineIntent);
		expect(next).toHaveBeenCalledExactlyOnceWith(otherEngineIntent);
		expect(engine.clearRules).not.toHaveBeenCalled();
	});

	it('handles its own prefixed intents when scoped to a custom prefix', () => {
		const { engine, invoke } = setup('WINE');

		invoke(forwardToEngine('clearRules', {}, 'WINE'));
		expect(engine.clearRules).toHaveBeenCalledTimes(1);
	});

	it('ignores actions with a non-string type', () => {
		const { invoke, next } = setup();
		const weird = { type: 123 } as unknown as { type: string };

		invoke(weird);
		expect(next).toHaveBeenCalledExactlyOnceWith(weird);
	});
});

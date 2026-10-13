/**
 * @fileoverview Shared fixtures for the worker-bridge pass-3 suites — the sample item corpus,
 * the worker-side engine factories, and the small async-test helpers.
 *
 * @remarks
 * Build-excluded (`tsconfig.build.json` → `test-support/`) and coverage-excluded (root
 * `vitest.config.ts` → `test-support/**`) under the whole-file test-support exception, so it
 * never ships to `dist` and doesn't skew coverage.
 *
 * @packageDocumentation
 */

import {
	createFilterEngine,
	type FilterEngine,
	FilterRule,
	type FilterRuleAction,
	ruleRegistry,
	type SerializedRule,
} from '@filter-enginez/core';

/** The sample item shape the suites filter over. */
export interface Item {
	readonly color: string;
	readonly price: number;
}

/** A tiny three-item corpus — two red, one white; prices 10 / 20 / 30. */
export const data: readonly Item[] = [
	{ color: 'red', price: 10 },
	{ color: 'white', price: 20 },
	{ color: 'red', price: 30 },
];

/** A worker-side factory that builds a core engine from the init options' `sourceData`. */
export function itemEngineFactory(options: Readonly<Record<string, unknown>>): FilterEngine<Item> {
	return createFilterEngine<Item>({ sourceData: options['sourceData'] as readonly Item[] });
}

/** As `itemEngineFactory`, but with the action-log devtools explicitly enabled. */
export function devtoolsEngineFactory(options: Readonly<Record<string, unknown>>): FilterEngine<Item> {
	return createFilterEngine<Item>({
		devtools: { enabled: true },
		sourceData: options['sourceData'] as readonly Item[],
	});
}

/**
 * A minimal engine-shaped object with NO `devtools` field. A real core engine always constructs
 * a `Devtools` (recording just no-ops when disabled), so this stub is the only way to exercise
 * the worker router's devtools-absent guards — a legitimate scenario, since a factory may return
 * any object structurally compatible with the engine surface. Only the methods the guard test
 * reaches need to exist.
 */
export function devtoolsLessEngineFactory(): FilterEngine<Item> {
	return { destroy: () => undefined } as unknown as FilterEngine<Item>;
}

/** A factory that throws during construction — drives `wrapInWorker`'s init-failure teardown. */
export function throwingEngineFactory(): FilterEngine<Item> {
	throw new Error('factory boom');
}

/** Serialize a rule into the wire form the `FilterEngineAsync` contract expects. */
export function wire(rule: FilterRule): FilterRule {
	return rule.serialize() as unknown as FilterRule;
}

/** A promise paired with its resolver, for awaiting an async round-trip callback. */
export function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});

	return { promise, resolve };
}

/** Yield a macrotask so queued MessageChannel round-trips can drain. */
export const flush = async (): Promise<void> => {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, 0);
	});
};

/**
 * A rule whose `serialize()` throws — drives the worker-side subscribe wrapper's wire-conversion
 * `catch`. Registered once so `ruleRegistry.deserialize` can reconstruct it on the worker side
 * from a hand-built wire payload (calling `serialize()` on the main thread would throw before the
 * payload ever crossed the boundary).
 */
export class ThrowOnSerializeRule extends FilterRule {
	/** Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Required to register. */
	static override readonly ruleTypeName = 'ThrowOnSerializeRule';

	override action: FilterRuleAction = () => true;

	config: unknown = undefined;

	override serialize(): SerializedRule {
		throw new Error(`serialize boom (${String(this.field)})`);
	}
}

if (!ruleRegistry.has('ThrowOnSerializeRule')) {
	ruleRegistry.register('ThrowOnSerializeRule', ThrowOnSerializeRule);
}

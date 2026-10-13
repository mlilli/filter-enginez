/**
 * @remarks
 * Errors crossing the worker boundary. End to end over the in-jsdom `MessageChannel` harness: an
 * engine error raised inside the worker reaches the main thread as the SAME class — so
 * `instanceof`, `name`, `code`, `message` and `cause` all survive — for each category, including
 * `RuleRegistryError` and a wrapped `cause`. Then the handler unit by unit, through the registered
 * Comlink handler, for the shapes the engine never produces but other Comlink users might: thrown
 * non-`Error` values, foreign error codes, causes that are not structured-clone safe, cause chains
 * deeper than the bound, and errors whose stack is missing.
 */

import {
	and,
	type CompositeRule,
	CURRENT_CONFIG_VERSION,
	FilterEngineConfigError,
	FilterEngineDestroyedError,
	FilterEngineError,
	FilterEngineModeError,
	FilterEngineRuleError,
	type FilterRule,
	RuleRegistryError,
	value,
} from '@filter-enginez/core';
import { type TransferHandler, transferHandlers } from 'comlink';
import { describe, expect, it } from 'vitest';

import { installErrorTransferHandler } from './errorTransfer.js';
import { data, type Item, itemEngineFactory, wire } from './test-support/fixtures.js';
import { makeChannelWorker } from './test-support/workerHarness.js';
import { wrapInWorker } from './wrapInWorker.js';

/** What the registered `'throw'` handler serializes to and from. */
interface SerializedThrow {
	readonly isError: boolean;
	readonly value: unknown;
}

/**
 * Boot a worker-backed engine over the in-jsdom channel.
 *
 * @returns The `FilterEngineAsync` facade
 */
async function bootEngine(): ReturnType<typeof wrapInWorker<Item>> {
	return wrapInWorker<Item>({
		factoryName: 'item',
		factoryOptions: { sourceData: data },
		worker: makeChannelWorker({ item: itemEngineFactory }),
	});
}

/**
 * Await a promise expected to reject and return the rejection.
 *
 * @param promise - The call under test
 * @returns The rejection reason
 */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error('Expected the promise to reject, but it resolved.');
}

/**
 * The registered handler, typed for direct calls.
 *
 * @returns Comlink's current `'throw'` handler (ours, once installed)
 */
function throwHandler(): TransferHandler<{ readonly value: unknown }, SerializedThrow> {
	installErrorTransferHandler();

	return transferHandlers.get('throw') as TransferHandler<{ readonly value: unknown }, SerializedThrow>;
}

/**
 * Serialize a thrown value and deserialize it again, the way one round trip over `postMessage` does.
 *
 * @param thrown - The value the remote side threw
 * @returns What the receiving side throws
 */
function roundTrip(thrown: unknown): unknown {
	const handler = throwHandler();
	const [serialized] = handler.serialize({ value: thrown });

	try {
		handler.deserialize(structuredClone(serialized));
	} catch (error) {
		return error;
	}
	throw new Error('Expected deserialize to throw.');
}

describe('engine errors across the worker boundary (end to end)', () => {
	it('a mode error arrives as FilterEngineModeError with its code and message', async () => {
		const engine = await bootEngine();

		await engine.setExpression(and(value('color', 'red')).serialize() as unknown as CompositeRule);
		const error = await rejectionOf(engine.addRule('color', wire(value('color', 'white'))));

		expect(error).toBeInstanceOf(FilterEngineModeError);
		expect(error).toBeInstanceOf(FilterEngineError);
		expect(error).toMatchObject({ code: 'MODE_EXPRESSION_ACTIVE', name: 'FilterEngineModeError' });
		expect((error as Error).message).toContain("FilterEngine.addRule('color') was called in expression mode");
		expect((error as Error).stack).toContain('FilterEngineModeError');

		await engine.destroy();
	});

	it('a registry error arrives as RuleRegistryError, still a FilterEngineRuleError', async () => {
		const engine = await bootEngine();
		const unknownRule = { config: null, field: 'color', type: 'NoSuchRule' } as unknown as FilterRule;
		const error = await rejectionOf(engine.addRule('x', unknownRule));

		expect(error).toBeInstanceOf(RuleRegistryError);
		expect(error).toBeInstanceOf(FilterEngineRuleError);
		expect(error).toMatchObject({ code: 'REGISTRY_UNKNOWN_TYPE', name: 'RuleRegistryError' });

		await engine.destroy();
	});

	it('a config error keeps its class, and a wrapped cause arrives as an Error with name and message', async () => {
		const engine = await bootEngine();
		const configError = await rejectionOf(engine.loadConfig({
			expression: { ruleId: 'ghost', type: 'rule' },
			rules: [],
			version: CURRENT_CONFIG_VERSION,
		}));

		expect(configError).toBeInstanceOf(FilterEngineConfigError);
		expect(configError).toMatchObject({ code: 'CONFIG_UNKNOWN_RULE_ID' });

		const ruleError = await rejectionOf(engine.loadConfig({
			rules: [{ id: 'bad', rule: { config: { source: '(' }, field: 'color', type: 'RegexRule' }}],
			version: CURRENT_CONFIG_VERSION,
		}));

		expect(ruleError).toBeInstanceOf(FilterEngineRuleError);
		expect(ruleError).toMatchObject({ code: 'RULE_INVALID_SERIALIZED_CONFIG' });
		expect((ruleError as Error).cause).toBeInstanceOf(Error);
		expect((ruleError as Error).cause).toMatchObject({ name: 'SyntaxError' });

		await engine.destroy();
	});

	it('an unknown factory name rejects wrapInWorker with FilterEngineConfigError', async () => {
		const error = await rejectionOf(wrapInWorker<Item>({
			factoryName: 'missing',
			worker: makeChannelWorker({ item: itemEngineFactory }),
		}));

		expect(error).toBeInstanceOf(FilterEngineConfigError);
		expect(error).toMatchObject({ code: 'WORKER_FACTORY_NOT_FOUND' });
	});
});

describe('the error transfer handler, unit by unit', () => {
	it('is idempotent to install and replaces Comlink\'s handler with one object', () => {
		installErrorTransferHandler();
		const first = transferHandlers.get('throw');

		installErrorTransferHandler();
		expect(transferHandlers.get('throw')).toBe(first);
	});

	it('defers to Comlink for a thrown non-Error value, which arrives unchanged', () => {
		expect(roundTrip('plain string')).toBe('plain string');
		expect(throwHandler().canHandle({ value: 1 })).toBe(false);
	});

	it('rebuilds every class in the hierarchy by name', () => {
		const destroyed = roundTrip(new FilterEngineDestroyedError('ENGINE_DESTROYED', 'gone'));
		const base = roundTrip(new FilterEngineError('STORAGE_UNAVAILABLE', 'no storage'));

		expect(destroyed).toBeInstanceOf(FilterEngineDestroyedError);
		expect(base).toBeInstanceOf(FilterEngineError);
		expect(base).toMatchObject({ code: 'STORAGE_UNAVAILABLE', message: 'no storage', name: 'FilterEngineError' });
	});

	it('rebuilds a foreign error as a plain Error that keeps its name and string code', () => {
		const foreign = Object.assign(new TypeError('nope'), { code: 'ERR_FOREIGN' });
		const rebuilt = roundTrip(foreign);

		expect(rebuilt).not.toBeInstanceOf(FilterEngineError);
		expect(rebuilt).toBeInstanceOf(Error);
		expect(rebuilt).toMatchObject({ code: 'ERR_FOREIGN', message: 'nope', name: 'TypeError' });
	});

	it('treats a known name without a code as foreign, and ignores a non-string code', () => {
		const spoofed = Object.assign(new Error('no code'), { name: 'FilterEngineModeError' });
		const numericCode = Object.assign(new Error('numeric'), { code: 42 });

		expect(roundTrip(spoofed)).not.toBeInstanceOf(FilterEngineModeError);
		expect('code' in (roundTrip(numericCode) as Error)).toBe(false);
	});

	it('carries primitive and null causes, drops causes that are not clone-safe', () => {
		const withString = roundTrip(new FilterEngineModeError('MODE_WORKER_UNSUPPORTED', 'x', { cause: 'why' }));
		const withNull = roundTrip(new FilterEngineModeError('MODE_WORKER_UNSUPPORTED', 'x', { cause: null }));
		const withFunction = roundTrip(new FilterEngineModeError('MODE_WORKER_UNSUPPORTED', 'x', { cause: () => 1 }));
		const withoutCause = roundTrip(new FilterEngineModeError('MODE_WORKER_UNSUPPORTED', 'x'));

		expect((withString as Error).cause).toBe('why');
		expect((withNull as Error).cause).toBeNull();
		expect((withFunction as Error).cause).toBeUndefined();
		expect('cause' in (withoutCause as Error)).toBe(false);
	});

	it('follows a cause chain up to the bound, then keeps only name and message', () => {
		let error: Error = new Error('root');

		for (let depth = 0; depth < 12; depth++) {
			error = new FilterEngineRuleError('RULE_NOT_FOUND', `level ${String(depth)}`, { cause: error });
		}
		let rebuilt = roundTrip(error) as Error;
		let links = 0;

		while (rebuilt.cause instanceof Error) {
			rebuilt = rebuilt.cause;
			links++;
		}
		// Eight full links, then one truncated to name + message, whose own cause is not followed.
		expect(links).toBe(9);
		expect(rebuilt).toMatchObject({ message: 'level 2', name: 'FilterEngineRuleError' });
		expect('cause' in rebuilt).toBe(false);
	});

	it('keeps the receiving side\'s stack when the error had none', () => {
		const stackless = new FilterEngineRuleError('RULE_NOT_FOUND', 'no stack');

		stackless.stack = undefined;
		const rebuilt = roundTrip(stackless) as Error;

		expect(rebuilt).toBeInstanceOf(FilterEngineRuleError);
		expect(typeof rebuilt.stack).toBe('string');
	});

	it('defers to Comlink for an error-flagged payload that is not a wire error', () => {
		let thrown: unknown;

		try {
			throwHandler().deserialize({ isError: true, value: null });
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(Error);
		expect(thrown).not.toBeInstanceOf(FilterEngineError);
	});
});

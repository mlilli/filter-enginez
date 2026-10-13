/**
 * @remarks
 * The error hierarchy itself: every class's `name`, `code`, `message`, standard `cause`, and its
 * `instanceof` chain, plus the properties consumers lean on without thinking about them — `name`
 * stays off `Object.keys`, the prototype is exactly the class's own, and `RuleRegistryError` slots in under `FilterEngineRuleError` without changing its own surface.
 * Every throw SITE is asserted separately in `./throwSites.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { RuleRegistryError } from '../rules/ruleRegistry.js';
import {
	defineErrorName,
	FilterEngineConfigError,
	FilterEngineDestroyedError,
	FilterEngineError,
	FilterEngineModeError,
	FilterEngineRuleError,
} from './index.js';

/** One row per class: how to build it, and what it must report. */
const HIERARCHY = [
	{
		build: (): FilterEngineError => new FilterEngineError('STORAGE_UNAVAILABLE', 'base'),
		category: FilterEngineError,
		code: 'STORAGE_UNAVAILABLE',
		name: 'FilterEngineError',
	},
	{
		build: (): FilterEngineError => new FilterEngineConfigError('CONFIG_UNKNOWN_RULE_ID', 'config'),
		category: FilterEngineConfigError,
		code: 'CONFIG_UNKNOWN_RULE_ID',
		name: 'FilterEngineConfigError',
	},
	{
		build: (): FilterEngineError => new FilterEngineRuleError('RULE_NOT_FOUND', 'rule'),
		category: FilterEngineRuleError,
		code: 'RULE_NOT_FOUND',
		name: 'FilterEngineRuleError',
	},
	{
		build: (): FilterEngineError => new FilterEngineModeError('MODE_EXPRESSION_ACTIVE', 'mode'),
		category: FilterEngineModeError,
		code: 'MODE_EXPRESSION_ACTIVE',
		name: 'FilterEngineModeError',
	},
	{
		build: (): FilterEngineError => new FilterEngineDestroyedError('ENGINE_DESTROYED', 'destroyed'),
		category: FilterEngineDestroyedError,
		code: 'ENGINE_DESTROYED',
		name: 'FilterEngineDestroyedError',
	},
	{
		build: (): FilterEngineError => new RuleRegistryError('REGISTRY_UNKNOWN_TYPE', 'registry'),
		category: RuleRegistryError,
		code: 'REGISTRY_UNKNOWN_TYPE',
		name: 'RuleRegistryError',
	},
] as const;

describe('the FilterEngineError hierarchy', () => {
	it.each(HIERARCHY)('$name carries its name, code and message, and is an Error + FilterEngineError', (row) => {
		const error = row.build();

		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(FilterEngineError);
		expect(error).toBeInstanceOf(row.category);
		expect(Object.getPrototypeOf(error)).toBe(row.category.prototype);
		expect(error.name).toBe(row.name);
		expect(error.code).toBe(row.code);
		expect(String(error)).toBe(`${row.name}: ${error.message}`);
		// `name` lives on the prototype: it stays out of enumeration and JSON, like a built-in Error's.
		expect(Object.keys(error)).toEqual(['code']);
		expect(Object.hasOwn(error, 'name')).toBe(false);
	});

	it.each(HIERARCHY)('$name is not an instance of the sibling categories', (row) => {
		const error = row.build();
		const siblings = [FilterEngineConfigError, FilterEngineRuleError, FilterEngineModeError, FilterEngineDestroyedError]
			.filter((category) => !(error instanceof category));

		// Exactly one category matches (none for the bare base; RuleRegistryError counts as Rule).
		expect(siblings).toHaveLength(row.category === FilterEngineError ? 4 : 3);
	});

	it('passes `cause` through the standard ES2022 Error option, not a custom field', () => {
		const cause = new SyntaxError('bad pattern');
		const error = new FilterEngineRuleError('RULE_INVALID_SERIALIZED_CONFIG', 'wrapped', { cause });

		expect(error.cause).toBe(cause);
		expect(Object.getOwnPropertyDescriptor(error, 'cause')).toMatchObject({ enumerable: false, value: cause });
	});

	it('leaves `cause` absent — not undefined-valued — when no options are passed', () => {
		expect('cause' in new FilterEngineModeError('MODE_WORKER_UNSUPPORTED', 'no cause')).toBe(false);
	});

	it('keeps RuleRegistryError a FilterEngineRuleError with its own name and registry codes', () => {
		const error = new RuleRegistryError('REGISTRY_DUPLICATE', 'dup', { cause: 'first registration' });

		expect(error).toBeInstanceOf(FilterEngineRuleError);
		expect(error.name).toBe('RuleRegistryError');
		expect(error.code).toBe('REGISTRY_DUPLICATE');
		expect(error.cause).toBe('first registration');
	});
});

describe('defineErrorName', () => {
	it('pins a writable, non-enumerable name on the prototype', () => {
		class CustomError extends Error {}

		defineErrorName(CustomError, 'CustomError');

		expect(new CustomError('x').name).toBe('CustomError');
		expect(Object.getOwnPropertyDescriptor(CustomError.prototype, 'name')).toEqual({
			configurable: true,
			enumerable: false,
			value: 'CustomError',
			writable: true,
		});

		const renamed = new CustomError('y');

		renamed.name = 'Renamed';
		expect(renamed.name).toBe('Renamed');
	});
});

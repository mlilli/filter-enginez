/**
 * @remarks
 * Tests for the `serializedConfig` readers the numeric rules' `static deserialize` hooks share:
 * `revivedField` (the `'<function>'` placeholder and a real path), `readRecord` (an object, `null`,
 * a primitive), `reviveOpenBound` (`null` → the open bound, finite and infinite numbers kept,
 * strings / `undefined` / `NaN` rejected), `reviveBounds` (required and optional bound keys, other
 * keys kept) and `reviveFiniteNumber` (finite kept; `null`, `NaN`, `Infinity` and strings
 * rejected), plus the error each rejection carries: its class, code, and a message naming the key
 * and the rejected value.
 */

import { describe, expect, it } from 'vitest';

import { FilterEngineRuleError } from '../errors/index.js';
import { readRecord, reviveBounds, revivedField, reviveFiniteNumber, reviveOpenBound } from './serializedConfig.js';

describe('revivedField', () => {
	it('reads the function placeholder as undefined (the item itself)', () => {
		expect(revivedField({ config: {}, field: '<function>', type: 'RangeRule' })).toBeUndefined();
	});

	it('keeps a path field as written', () => {
		expect(revivedField({ config: {}, field: ['a.b', 'c'], type: 'RangeRule' })).toEqual(['a.b', 'c']);
	});
});

describe('readRecord', () => {
	it('returns an object unchanged', () => {
		const config = { max: 1 };

		expect(readRecord(config, 'RangeRule config')).toBe(config);
	});

	it.each([null, 5, 'text', undefined])('rejects %s with RULE_INVALID_SERIALIZED_CONFIG', (value) => {
		expect(() => readRecord(value, 'RangeRule config')).toThrowError(FilterEngineRuleError);
		expect(() => readRecord(value, 'RangeRule config')).toThrowError(/^RangeRule config must be an object; got /u);
	});
});

describe('reviveOpenBound', () => {
	it('reads null as the open bound for the position', () => {
		expect(reviveOpenBound(null, Number.POSITIVE_INFINITY, 'RangeRule config.max')).toBe(Number.POSITIVE_INFINITY);
		expect(reviveOpenBound(null, Number.NEGATIVE_INFINITY, 'RangeRule config.min')).toBe(Number.NEGATIVE_INFINITY);
	});

	it.each([0, -0, 60, -1.5, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('keeps the number %s', (value) => {
		expect(reviveOpenBound(value, Number.POSITIVE_INFINITY, 'RangeRule config.max')).toBe(value);
	});

	it('rejects a string, quoting it, with code RULE_INVALID_SERIALIZED_CONFIG', () => {
		let thrown: unknown;

		try {
			reviveOpenBound('60', Number.POSITIVE_INFINITY, 'RangeRule config.max');
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(FilterEngineRuleError);
		expect(thrown).toMatchObject({
			code: 'RULE_INVALID_SERIALIZED_CONFIG',
			message: 'RangeRule config.max must be a number, or null for an open bound; got "60".',
		});
	});

	it.each([
		[Number.NaN, 'NaN'],
		[undefined, 'undefined'],
		[true, 'true'],
	])('rejects %s, naming it', (value, rendered) => {
		expect(() => reviveOpenBound(value, Number.POSITIVE_INFINITY, 'RangeRule config.max'))
			.toThrowError(`RangeRule config.max must be a number, or null for an open bound; got ${rendered}.`);
	});
});

describe('reviveFiniteNumber', () => {
	it.each([0, -122.4194, 37.7749])('keeps the finite number %s', (value) => {
		expect(reviveFiniteNumber(value, 'GeoProximityRule config.center.lat')).toBe(value);
	});

	it.each([
		[null, 'null'],
		[Number.NaN, 'NaN'],
		[Number.POSITIVE_INFINITY, 'Infinity'],
		['37.7', '"37.7"'],
	])('rejects %s, naming it', (value, rendered) => {
		expect(() => reviveFiniteNumber(value, 'GeoProximityRule config.center.lat'))
			.toThrowError(`GeoProximityRule config.center.lat must be a finite number; got ${rendered}.`);
	});
});

describe('reviveBounds', () => {
	const openBounds = { max: Number.POSITIVE_INFINITY, min: Number.NEGATIVE_INFINITY };

	it('revives every bound key and keeps the other keys', () => {
		const json = { config: { max: null, min: 5, unit: 'usd' }, field: 'price', type: 'RangeRule' };

		expect(reviveBounds(json, openBounds)).toEqual({ max: Number.POSITIVE_INFINITY, min: 5, unit: 'usd' });
	});

	it('rejects an absent bound when bounds are required', () => {
		expect(() => reviveBounds({ config: { min: 5 }, field: 'price', type: 'RangeRule' }, openBounds))
			.toThrowError('RangeRule config.max must be a number, or null for an open bound; got undefined.');
	});

	it('leaves an absent bound absent when bounds are optional', () => {
		const revived = reviveBounds({ config: { min: null }, field: 'price', type: 'RangeRule' }, openBounds, true);

		expect(revived).toEqual({ min: Number.NEGATIVE_INFINITY });
		expect('max' in revived).toBe(false);
	});

	it('rejects a config that is not an object', () => {
		expect(() => reviveBounds({ config: 'x', field: 'price', type: 'RangeRule' }, openBounds))
			.toThrowError('RangeRule config must be an object; got "x".');
	});
});

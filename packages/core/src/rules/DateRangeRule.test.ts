/**
 * Tests for `DateRangeRule` — date-valued range filter with relative-preset support and a custom
 * Date-to-ISO serialize/deserialize round-trip.
 *
 * @remarks
 * Covers the `action` across absolute start/end bounds (inclusive boundaries), preset precedence,
 * and the `coerceToDate` helper's three input types (Date / string / number) plus its
 * invalid-date and non-coercible fail paths. The overridden `serialize()` is asserted with start
 * and end both present and both absent (the optional-chaining branches), plus the function-field
 * placeholder. The static `deserialize` is exercised across each spread branch (start/end/preset
 * present vs absent), a `null` bound reviving as open, a Unix-ms bound, the rejection of a bound
 * that is not a date (unparseable string, wrong type), and the `'<function>'` field branch. Every
 * `resolvePreset` case is checked via the exported helper.
 */

import { describe, expect, it } from 'vitest';

import { FilterEngineRuleError } from '../errors/index.js';
import { DateRangeRule, resolvePreset } from './DateRangeRule.js';

describe('DateRangeRule', () => {
	describe('action with absolute bounds', () => {
		const rule = new DateRangeRule('at', {
			end: new Date('2025-12-31T00:00:00.000Z'),
			start: new Date('2025-10-01T00:00:00.000Z'),
		});

		it('passes a date within the range', () => {
			expect(rule.action({ at: new Date('2025-11-15T00:00:00.000Z') }, rule)).toBe(true);
		});

		it('includes the start boundary (inclusive)', () => {
			expect(rule.action({ at: new Date('2025-10-01T00:00:00.000Z') }, rule)).toBe(true);
		});

		it('includes the end boundary (inclusive)', () => {
			expect(rule.action({ at: new Date('2025-12-31T00:00:00.000Z') }, rule)).toBe(true);
		});

		it('fails a date before the start', () => {
			expect(rule.action({ at: new Date('2025-09-30T00:00:00.000Z') }, rule)).toBe(false);
		});

		it('fails a date after the end', () => {
			expect(rule.action({ at: new Date('2026-01-01T00:00:00.000Z') }, rule)).toBe(false);
		});
	});

	it('passes everything when no bounds are configured', () => {
		const rule = new DateRangeRule('at', {});

		expect(rule.action({ at: new Date('1999-01-01') }, rule)).toBe(true);
	});

	describe('coerceToDate input forms', () => {
		const rule = new DateRangeRule('at', { start: new Date('2020-01-01T00:00:00.000Z') });

		it('accepts ISO-string field values', () => {
			expect(rule.action({ at: '2021-06-01T00:00:00.000Z' }, rule)).toBe(true);
		});

		it('accepts Unix-ms number field values', () => {
			expect(rule.action({ at: Date.UTC(2021, 5, 1) }, rule)).toBe(true);
		});

		it('fails an invalid Date instance', () => {
			expect(rule.action({ at: new Date('not-a-date') }, rule)).toBe(false);
		});

		it('fails an unparseable string', () => {
			expect(rule.action({ at: 'definitely-not-a-date' }, rule)).toBe(false);
		});

		it('fails a non-coercible field value (boolean)', () => {
			expect(rule.action({ at: true }, rule)).toBe(false);
		});

		it('fails when the field is missing', () => {
			expect(rule.action({}, rule)).toBe(false);
		});
	});

	it('prefers preset over absolute bounds when both are set', () => {
		// Absolute bounds would exclude "now"; the preset 'all-time' should let it through.
		const rule = new DateRangeRule('at', {
			end: new Date('2000-01-01'),
			preset: 'all-time',
			start: new Date('1990-01-01'),
		});

		expect(rule.action({ at: new Date() }, rule)).toBe(true);
	});

	it('applies a relative preset window at evaluation time', () => {
		const rule = new DateRangeRule('at', { preset: 'last-7-days' });

		expect(rule.action({ at: new Date() }, rule)).toBe(true);
		expect(rule.action({ at: new Date('2000-01-01') }, rule)).toBe(false);
	});

	describe('serialize', () => {
		it('serializes Date bounds to ISO strings', () => {
			const rule = new DateRangeRule('at', {
				end: new Date('2025-12-31T00:00:00.000Z'),
				start: new Date('2025-10-01T00:00:00.000Z'),
			});

			expect(rule.serialize()).toEqual({
				config: {
					end: '2025-12-31T00:00:00.000Z',
					preset: undefined,
					start: '2025-10-01T00:00:00.000Z',
				},
				field: 'at',
				type: 'DateRangeRule',
			});
		});

		it('leaves absent start/end undefined and keeps the preset', () => {
			const rule = new DateRangeRule('at', { preset: 'this-year' });

			expect(rule.serialize()).toEqual({
				config: { end: undefined, preset: 'this-year', start: undefined },
				field: 'at',
				type: 'DateRangeRule',
			});
		});

		it('normalizes a function field to the <function> placeholder', () => {
			const rule = new DateRangeRule((item) => (item as { at: Date }).at, {
				start: new Date('2025-01-01'),
			});

			expect(rule.serialize().field).toBe('<function>');
		});
	});

	describe('deserialize', () => {
		it('reconstructs Date instances for start and end', () => {
			const restored = DateRangeRule.deserialize({
				config: { end: '2025-12-31T00:00:00.000Z', start: '2025-10-01T00:00:00.000Z' },
				field: 'at',
				type: 'DateRangeRule',
			});

			expect(restored.config.start).toBeInstanceOf(Date);
			expect(restored.config.end).toBeInstanceOf(Date);
			expect(restored.config.start?.toISOString()).toBe('2025-10-01T00:00:00.000Z');
			expect(restored.config.end?.toISOString()).toBe('2025-12-31T00:00:00.000Z');
		});

		it('reconstructs a preset-only config without start/end', () => {
			const restored = DateRangeRule.deserialize({
				config: { preset: 'last-30-days' },
				field: 'at',
				type: 'DateRangeRule',
			});

			expect(restored.config.preset).toBe('last-30-days');
			expect(restored.config.start).toBeUndefined();
			expect(restored.config.end).toBeUndefined();
		});

		it('produces an empty config when nothing is present', () => {
			const restored = DateRangeRule.deserialize({
				config: {},
				field: 'at',
				type: 'DateRangeRule',
			});

			expect(restored.config).toEqual({});
		});

		it('revives null bounds as open, never as 1970-01-01', () => {
			const restored = DateRangeRule.deserialize({
				config: { end: null, start: null },
				field: 'at',
				type: 'DateRangeRule',
			});

			expect(restored.config).toEqual({});
			expect(restored.action({ at: '1969-12-31T00:00:00.000Z' }, restored)).toBe(true);
		});

		it('reconstructs a Unix-ms bound', () => {
			const restored = DateRangeRule.deserialize({ config: { start: 0 }, field: 'at', type: 'DateRangeRule' });

			expect(restored.config.start?.toISOString()).toBe('1970-01-01T00:00:00.000Z');
		});

		it.each([
			[{ start: 'not a date' }, 'DateRangeRule config.start must be a date string, a Unix-ms number, or null for an open bound; got "not a date".'],
			[{ end: true }, 'DateRangeRule config.end must be a date string, a Unix-ms number, or null for an open bound; got true.'],
		])('rejects the config %o', (config, message) => {
			expect(() => DateRangeRule.deserialize({ config, field: 'at', type: 'DateRangeRule' })).toThrowError(FilterEngineRuleError);
			expect(() => DateRangeRule.deserialize({ config, field: 'at', type: 'DateRangeRule' })).toThrowError(message);
		});

		it('restores a <function> field placeholder to undefined', () => {
			const restored = DateRangeRule.deserialize({
				config: { start: '2025-01-01T00:00:00.000Z' },
				field: '<function>',
				type: 'DateRangeRule',
			});

			expect(restored.field).toBeUndefined();
		});
	});

	describe('resolvePreset', () => {
		it('returns an empty range for all-time', () => {
			expect(resolvePreset('all-time')).toEqual({});
		});

		it('returns a 7-day window ending now for last-7-days', () => {
			const { end, start } = resolvePreset('last-7-days');

			expect(end).toBeInstanceOf(Date);
			expect(start).toBeInstanceOf(Date);
			const spanDays = ((end as Date).getTime() - (start as Date).getTime()) / 86_400_000;

			expect(spanDays).toBeCloseTo(7, 5);
		});

		it('returns a 30-day window for last-30-days', () => {
			const { end, start } = resolvePreset('last-30-days');
			const spanDays = ((end as Date).getTime() - (start as Date).getTime()) / 86_400_000;

			expect(spanDays).toBeCloseTo(30, 5);
		});

		it('returns a 90-day window for last-90-days', () => {
			const { end, start } = resolvePreset('last-90-days');
			const spanDays = ((end as Date).getTime() - (start as Date).getTime()) / 86_400_000;

			expect(spanDays).toBeCloseTo(90, 5);
		});

		it('starts on the first of the month for this-month', () => {
			const { start } = resolvePreset('this-month');

			expect((start as Date).getDate()).toBe(1);
			expect((start as Date).getMonth()).toBe(new Date().getMonth());
		});

		it('starts on January 1 of the current year for this-year', () => {
			const { start } = resolvePreset('this-year');

			expect((start as Date).getMonth()).toBe(0);
			expect((start as Date).getDate()).toBe(1);
			expect((start as Date).getFullYear()).toBe(new Date().getFullYear());
		});
	});
});

/**
 * Tests for `DateRangeRule`'s day mode, its Date-mode `timeZone`, and the checks on its config.
 *
 * @remarks
 * The whole suite runs three times, with the process time zone set to UTC, America/Denver (west of
 * UTC) and Pacific/Auckland (east of it, across the date line from Denver). Day mode and Date mode
 * with `timeZone: 'utc'` must give the same answer in all three; Date mode with `timeZone: 'local'`
 * must follow the zone, and is checked against each zone's own expected answer. The zone is set
 * through `process.env.TZ`, which Node applies at once in this process (Vitest runs each file in a
 * forked process, not a worker thread, where the change would not apply), and restored afterward.
 *
 * Day mode is checked at the start and end of a day, a month and a year; on leap days; with open
 * bounds; with every preset counted from a `today` on the first and last day of a month and across
 * a leap February; and against values that are not calendar days. The config checks cover the
 * constructor (`RULE_INVALID_CONFIG`) and `deserialize` (`RULE_INVALID_SERIALIZED_CONFIG`), and the
 * serialized form round-trips in both modes.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { FilterEngineRuleError } from '../errors/index.js';
import { type DateRangeConfig, type DateRangeDayConfig, DateRangeRule, resolveDayPreset, resolvePreset } from './DateRangeRule.js';
import { dateRange } from './factories.js';

/** Build a day-mode rule over `postedOn` and test one value against it. */
function dayMatches(config: Omit<DateRangeDayConfig, 'mode'>, value: unknown): boolean {
	const rule = new DateRangeRule('postedOn', { ...config, mode: 'day' });

	return rule.action({ postedOn: value }, rule);
}

/** The error a call throws, for asserting its class, code and message together. */
function caught(call: () => unknown): unknown {
	try {
		call();
	} catch (error) {
		return error;
	}

	throw new Error('expected the call to throw');
}

/**
 * The process environment, where `TZ` lives: Node's, reached through `globalThis` because core
 * compiles without Node's typings (it runs in any runtime; only this test needs a process).
 */
const environment = (globalThis as unknown as { process: { env: { TZ?: string; }; }; }).process.env;

describe.each(['UTC', 'America/Denver', 'Pacific/Auckland'])('DateRangeRule in TZ=%s', (zone) => {
	const originalZone = environment.TZ;

	beforeAll(() => {
		environment.TZ = zone;
	});

	afterAll(() => {
		if (originalZone === undefined) {
			delete environment.TZ;
		} else {
			environment.TZ = originalZone;
		}
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('runs in the zone it names', () => {
		// January, so no zone here is on daylight time: UTC 0, Denver UTC−7, Auckland UTC+13.
		const offsets: Readonly<Record<string, number>> = { 'America/Denver': 420, 'Pacific/Auckland': -780, UTC: 0 };

		expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(offsets[zone]);
	});

	describe('day mode, absolute bounds', () => {
		it.each([
			['the start day', '2026-02-01', true],
			['the end day', '2026-02-28', true],
			['a day between', '2026-02-14', true],
			['the day before the start (the end of the previous month)', '2026-01-31', false],
			['the day after the end (the start of the next month)', '2026-03-01', false],
		])('a February range holds %s: %s → %s', (_label, value, expected) => {
			expect(dayMatches({ end: '2026-02-28', start: '2026-02-01' }, value)).toBe(expected);
		});

		it.each([
			['the last day of the year before', '2025-12-31', false],
			['the first day of the year', '2026-01-01', true],
			['the last day of the year', '2026-12-31', true],
			['the first day of the year after', '2027-01-01', false],
		])('a calendar-year range holds %s: %s → %s', (_label, value, expected) => {
			expect(dayMatches({ end: '2026-12-31', start: '2026-01-01' }, value)).toBe(expected);
		});

		it('holds a leap day in a leap February, and rejects February 29 of a common year', () => {
			expect(dayMatches({ end: '2024-02-29', start: '2024-02-29' }, '2024-02-29')).toBe(true);
			expect(dayMatches({ end: '2023-03-01', start: '2023-02-01' }, '2023-02-29')).toBe(false);
		});

		it('keeps an open start or end open', () => {
			expect(dayMatches({ start: '2026-01-01' }, '9999-12-31')).toBe(true);
			expect(dayMatches({ start: '2026-01-01' }, '2025-12-31')).toBe(false);
			expect(dayMatches({ end: '2026-01-01' }, '0001-01-01')).toBe(true);
			expect(dayMatches({ end: '2026-01-01' }, '2026-01-02')).toBe(false);
			expect(dayMatches({}, '2026-11-03')).toBe(true);
		});

		it.each([
			['a Date', new Date(Date.UTC(2026, 1, 14))],
			['a date-time string', '2026-02-14T12:00:00Z'],
			['a month without its leading zero', '2026-2-14'],
			['a day that does not exist', '2026-02-30'],
			['a Unix-ms number', Date.UTC(2026, 1, 14)],
			['a missing field', undefined],
		])('fails %s, which is not a calendar day', (_label, value) => {
			expect(dayMatches({ end: '2026-02-28', start: '2026-02-01' }, value)).toBe(false);
		});

		it('resolves its bounds once per config, and again for a new one', () => {
			const rule = new DateRangeRule<DateRangeConfig>('postedOn', { end: '2026-02-28', mode: 'day', start: '2026-02-01' });

			expect(rule.action({ postedOn: '2026-02-14' }, rule)).toBe(true);
			expect(rule.action({ postedOn: '2026-03-14' }, rule)).toBe(false);
			rule.config = { end: '2026-03-31', mode: 'day', start: '2026-03-01' };
			expect(rule.action({ postedOn: '2026-03-14' }, rule)).toBe(true);
		});
	});

	describe('day mode, presets counted from today', () => {
		it.each([
			['last-7-days', '2026-11-03', { end: '2026-11-03', start: '2026-10-28' }],
			['last-30-days', '2026-11-03', { end: '2026-11-03', start: '2026-10-05' }],
			['last-90-days', '2026-11-03', { end: '2026-11-03', start: '2026-08-06' }],
			['last-7-days', '2024-03-02', { end: '2024-03-02', start: '2024-02-25' }],
			['last-30-days', '2024-03-01', { end: '2024-03-01', start: '2024-02-01' }],
			['this-month', '2026-11-01', { end: '2026-11-01', start: '2026-11-01' }],
			['this-month', '2026-11-30', { end: '2026-11-30', start: '2026-11-01' }],
			['this-month', '2024-02-29', { end: '2024-02-29', start: '2024-02-01' }],
			['this-year', '2026-01-01', { end: '2026-01-01', start: '2026-01-01' }],
			['this-year', '2026-12-31', { end: '2026-12-31', start: '2026-01-01' }],
			['all-time', '2026-11-03', {}],
		] as const)('%s from %s is %o', (preset, today, expected) => {
			expect(resolveDayPreset(preset, today)).toEqual(expected);
		});

		it('needs no today for all-time', () => {
			expect(resolveDayPreset('all-time', undefined)).toEqual({});
			expect(dayMatches({ preset: 'all-time' }, '1999-01-01')).toBe(true);
		});

		it('filters by the window, inclusive at both ends', () => {
			const config = { preset: 'last-7-days', today: '2026-03-03' } as const;

			expect(dayMatches(config, '2026-02-24')).toBe(false);
			expect(dayMatches(config, '2026-02-25')).toBe(true);
			expect(dayMatches(config, '2026-03-03')).toBe(true);
			expect(dayMatches(config, '2026-03-04')).toBe(false);
		});

		it('prefers the preset over absolute bounds', () => {
			const config = { end: '2000-01-31', preset: 'this-month', start: '2000-01-01', today: '2026-11-03' } as const;

			expect(dayMatches(config, '2026-11-02')).toBe(true);
			expect(dayMatches(config, '2000-01-15')).toBe(false);
		});

		it.each([[undefined], ['2026-11-31'], ['soon']])('rejects today %o when the preset needs one', (today) => {
			const error = caught(() => resolveDayPreset('last-7-days', today));

			expect(error).toBeInstanceOf(FilterEngineRuleError);
			expect(error).toMatchObject({ code: 'RULE_INVALID_CONFIG' });
			expect((error as Error).message).toContain('DateRangeRule config.today must be a YYYY-MM-DD calendar day for preset \'last-7-days\'');
		});
	});

	describe('Date mode with timeZone', () => {
		it('reads an offset-less string as UTC with timeZone utc, in every zone', () => {
			const start = new Date(Date.UTC(2026, 2, 1));
			const rule = new DateRangeRule('at', { start, timeZone: 'utc' });

			expect(rule.action({ at: '2026-03-01' }, rule)).toBe(true);
			expect(rule.action({ at: '2026-03-01T00:30' }, rule)).toBe(true);
			expect(rule.action({ at: '2026-02-28T23:59:59.999' }, rule)).toBe(false);
			expect(rule.action({ at: '2026-02-28 23:59:59.9999' }, rule)).toBe(false);
		});

		it('reads an offset-less string as local time with timeZone local', () => {
			const start = new Date(2026, 2, 1);
			const rule = new DateRangeRule('at', { start, timeZone: 'local' });

			expect(rule.action({ at: '2026-03-01' }, rule)).toBe(true);
			expect(rule.action({ at: '2026-03-01T00:00:00.5' }, rule)).toBe(true);
			expect(rule.action({ at: '2026-02-28T23:30' }, rule)).toBe(false);
		});

		it('keeps new Date()\'s own reading without timeZone (a date-only string is UTC midnight)', () => {
			const start = new Date(2026, 2, 1);
			const rule = new DateRangeRule('at', { start });

			// West of UTC, UTC midnight on March 1 is still February 28 locally: the mixed behavior.
			expect(rule.action({ at: '2026-03-01' }, rule)).toBe(zone !== 'America/Denver');
		});

		it('reads a string with an offset, another format, or a number as an instant either way', () => {
			const rule = new DateRangeRule('at', { start: new Date(Date.UTC(2026, 2, 1)), timeZone: 'local' });

			expect(rule.action({ at: '2026-03-01T00:00:00Z' }, rule)).toBe(true);
			expect(rule.action({ at: '2026-02-28T23:00:00-01:00' }, rule)).toBe(true);
			expect(rule.action({ at: '2026-02-28T23:00:00+01:00' }, rule)).toBe(false);
			expect(rule.action({ at: Date.UTC(2026, 2, 1) }, rule)).toBe(true);
			expect(rule.action({ at: 'not a date' }, rule)).toBe(false);
			expect(rule.action({ at: true }, rule)).toBe(false);
		});

		it.each([
			['a day that does not exist', '2026-02-30'],
			['hour 24', '2026-03-01T24:00'],
			['minute 60', '2026-03-01T10:60'],
			['second 60', '2026-03-01T10:00:60'],
		])('fails an offset-less string naming %s', (_label, value) => {
			const rule = new DateRangeRule('at', { timeZone: 'utc' });

			expect(rule.action({ at: value }, rule)).toBe(false);
		});

		it('starts this-month and this-year in UTC with timeZone utc, in every zone', () => {
			// 03:00 UTC on January 1, 2026: still December 31, 2025 in Denver, already afternoon in Auckland.
			const now = new Date(Date.UTC(2026, 0, 1, 3));

			expect(resolvePreset('this-month', 'utc', now)).toEqual({ end: now, start: new Date(Date.UTC(2026, 0, 1)) });
			expect(resolvePreset('this-year', 'utc', now)).toEqual({ end: now, start: new Date(Date.UTC(2026, 0, 1)) });
		});

		it('starts this-month and this-year on the local calendar with timeZone local', () => {
			const now = new Date(Date.UTC(2026, 0, 1, 3));
			const localYear = zone === 'America/Denver' ? 2025 : 2026;
			const localMonth = zone === 'America/Denver' ? 11 : 0;

			expect(resolvePreset('this-month', 'local', now)).toEqual({ end: now, start: new Date(localYear, localMonth, 1) });
			expect(resolvePreset('this-year', 'local', now)).toEqual({ end: now, start: new Date(localYear, 0, 1) });
			expect(resolvePreset('this-month', undefined, now)).toEqual(resolvePreset('this-month', 'local', now));
		});

		it('applies the preset\'s calendar when filtering', () => {
			vi.useFakeTimers({ now: Date.UTC(2026, 2, 1, 3), toFake: ['Date']});
			const utc = new DateRangeRule('at', { preset: 'this-month', timeZone: 'utc' });
			const local = new DateRangeRule('at', { preset: 'this-month', timeZone: 'local' });
			// 03:00 UTC on March 1 is still February 28 in Denver, so its month is February.
			const isFebruaryThisMonthLocally = zone === 'America/Denver';

			expect(utc.action({ at: '2026-02-15' }, utc)).toBe(false);
			expect(utc.action({ at: '2026-03-01T01:00' }, utc)).toBe(true);
			expect(local.action({ at: '2026-02-15' }, local)).toBe(isFebruaryThisMonthLocally);
		});
	});

	describe('config checks', () => {
		it.each([
			[{ mode: 'week' }, 'DateRangeRule config.mode must be \'date\', \'day\', or absent; got "week".'],
			[{ preset: 'next-week' }, 'DateRangeRule config.preset must be one of all-time last-30-days last-7-days last-90-days this-month this-year; got "next-week".'],
			[{ mode: 'day', preset: 'next-week' }, 'DateRangeRule config.preset must be one of'],
			[{ timeZone: 'America/Denver' }, 'DateRangeRule config.timeZone must be \'utc\', \'local\', or absent; got "America/Denver".'],
			[{ mode: 'day', start: '2026-02-30' }, 'DateRangeRule config.start must be a YYYY-MM-DD calendar day; got "2026-02-30".'],
			[{ end: new Date(0), mode: 'day' }, 'DateRangeRule config.end must be a YYYY-MM-DD calendar day; got'],
			[{ mode: 'day', today: '26-11-03' }, 'DateRangeRule config.today must be a YYYY-MM-DD calendar day; got "26-11-03".'],
			[{ mode: 'day', preset: 'this-month' }, 'DateRangeRule config.today must be a YYYY-MM-DD calendar day for preset \'this-month\'; got undefined.'],
		])('the constructor rejects %o with RULE_INVALID_CONFIG', (config, message) => {
			const error = caught(() => new DateRangeRule('at', config as unknown as DateRangeConfig));

			expect(error).toBeInstanceOf(FilterEngineRuleError);
			expect(error).toMatchObject({ code: 'RULE_INVALID_CONFIG' });
			expect((error as Error).message).toContain(message);
		});

		it.each([
			[{ mode: 'week' }, 'DateRangeRule config.mode must be'],
			[{ preset: 'next-week' }, 'DateRangeRule config.preset must be one of'],
			[{ timeZone: 'Mars' }, 'DateRangeRule config.timeZone must be'],
			[{ mode: 'day', start: '2026-13-01' }, 'DateRangeRule config.start must be a YYYY-MM-DD calendar day'],
			[{ mode: 'day', preset: 'last-7-days' }, 'DateRangeRule config.today must be a YYYY-MM-DD calendar day for preset'],
		])('deserialize rejects %o with RULE_INVALID_SERIALIZED_CONFIG', (config, message) => {
			const error = caught(() => DateRangeRule.deserialize({ config, field: 'at', type: 'DateRangeRule' }));

			expect(error).toBeInstanceOf(FilterEngineRuleError);
			expect(error).toMatchObject({ code: 'RULE_INVALID_SERIALIZED_CONFIG' });
			expect((error as Error).message).toContain(message);
		});
	});

	describe('serialize and deserialize', () => {
		it('writes a day-mode config as it is', () => {
			const rule = new DateRangeRule('postedOn', { end: '2026-02-28', mode: 'day', preset: 'this-month', start: '2026-02-01', today: '2026-02-14' });

			expect(rule.serialize()).toEqual({
				config: { end: '2026-02-28', mode: 'day', preset: 'this-month', start: '2026-02-01', today: '2026-02-14' },
				field: 'postedOn',
				type: 'DateRangeRule',
			});
		});

		it('writes a Date-mode timeZone and an explicit mode', () => {
			const rule = new DateRangeRule('at', { mode: 'date', start: new Date(Date.UTC(2026, 0, 1)), timeZone: 'utc' });

			expect(rule.serialize().config).toEqual({ mode: 'date', start: '2026-01-01T00:00:00.000Z', timeZone: 'utc' });
		});

		it('revives a day-mode config with its strings, null as absent', () => {
			const restored = DateRangeRule.deserialize({
				config: { end: null, mode: 'day', preset: 'last-7-days', start: '2026-01-01', today: '2026-11-03' },
				field: 'postedOn',
				type: 'DateRangeRule',
			});

			expect(restored.config).toEqual({ mode: 'day', preset: 'last-7-days', start: '2026-01-01', today: '2026-11-03' });
			expect(restored.action({ postedOn: '2026-10-28' }, restored)).toBe(true);
			expect(restored.action({ postedOn: '2026-10-27' }, restored)).toBe(false);
		});

		it('revives a Date-mode timeZone and mode, and a null timeZone as absent', () => {
			const withZone = DateRangeRule.deserialize({ config: { mode: 'date', timeZone: 'local' }, field: 'at', type: 'DateRangeRule' });
			const withoutZone = DateRangeRule.deserialize({ config: { timeZone: null }, field: 'at', type: 'DateRangeRule' });

			expect(withZone.config).toEqual({ mode: 'date', timeZone: 'local' });
			expect(withoutZone.config).toEqual({});
		});

		it('round-trips through JSON in both modes', () => {
			const day = new DateRangeRule('postedOn', { mode: 'day', preset: 'this-year', today: '2026-11-03' });
			const date = new DateRangeRule('at', { end: new Date(Date.UTC(2026, 5, 30)), timeZone: 'local' });

			for (const rule of [day, date]) {
				const json = JSON.parse(JSON.stringify(rule.serialize())) as ReturnType<DateRangeRule['serialize']>;

				expect(DateRangeRule.deserialize(json).serialize()).toEqual(rule.serialize());
			}
		});
	});

	it('dateRange builds a day-mode rule typed by its config', () => {
		const rule = dateRange('postedOn', { end: '2026-12-31', mode: 'day', start: '2026-01-01' });
		const start: string | undefined = rule.config.start;

		expect(start).toBe('2026-01-01');
		expect(rule.action({ postedOn: '2026-06-30' }, rule)).toBe(true);
	});
});

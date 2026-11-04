/**
 * Tests for `calendarDay` — `YYYY-MM-DD` validation and day arithmetic with no `Date`.
 *
 * @remarks
 * Validation is checked at every month length, on leap and common years (including the century
 * rules: 1900 is not a leap year, 2000 is), and against malformed shapes. Arithmetic is checked at
 * month, year and leap-day edges, at the ends of the writable years (where a step stops), in year
 * 0000's January and February (the one stretch before the first 400-year era), and against `Date.UTC`
 * across four centuries.
 */

import { describe, expect, it } from 'vitest';

import { addCalendarDays, isCalendarDay } from './calendarDay.js';

describe('isCalendarDay', () => {
	it.each([
		'2026-01-31',
		'2026-02-28',
		'2026-04-30',
		'2026-12-31',
		'2024-02-29',
		'2000-02-29',
		'0000-02-29',
		'9999-12-31',
	])('accepts %s', (day) => {
		expect(isCalendarDay(day)).toBe(true);
	});

	it.each([
		['February 29 in a common year', '2026-02-29'],
		['February 29 in a century that is not a leap year', '1900-02-29'],
		['day 31 of a 30-day month', '2026-04-31'],
		['day 32', '2026-01-32'],
		['month 00', '2026-00-10'],
		['month 13', '2026-13-01'],
		['day 00', '2026-01-00'],
		['a month without its leading zero', '2026-1-01'],
		['a leading space', ' 2026-01-01'],
		['a date-time', '2026-01-01T00:00:00Z'],
		['a five-digit year', '12026-01-01'],
		['an empty string', ''],
	])('rejects %s', (_label, day) => {
		expect(isCalendarDay(day)).toBe(false);
	});

	it.each([[20_260_101], [new Date('2026-01-01')], [null], [undefined]])('rejects a non-string %o', (value) => {
		expect(isCalendarDay(value)).toBe(false);
	});
});

describe('addCalendarDays', () => {
	it.each([
		['2026-11-03', 0, '2026-11-03'],
		['2026-01-31', 1, '2026-02-01'],
		['2026-03-01', -1, '2026-02-28'],
		['2024-03-01', -1, '2024-02-29'],
		['2024-02-28', 1, '2024-02-29'],
		['2100-03-01', -1, '2100-02-28'],
		['2000-03-01', -1, '2000-02-29'],
		['2025-12-31', 1, '2026-01-01'],
		['2026-01-01', -1, '2025-12-31'],
		['2026-11-03', -6, '2026-10-28'],
		['2026-11-03', -29, '2026-10-05'],
		['2026-11-03', -89, '2026-08-06'],
		['2026-11-03', 365, '2027-11-03'],
		['0000-02-15', 1, '0000-02-16'],
		['0000-03-01', -1, '0000-02-29'],
	])('%s + %i is %s', (day, count, expected) => {
		expect(addCalendarDays(day, count)).toBe(expected);
	});

	it('stops at 0000-01-01 and 9999-12-31 rather than leaving the writable years', () => {
		expect(addCalendarDays('0000-01-05', -30)).toBe('0000-01-01');
		expect(addCalendarDays('9999-12-20', 30)).toBe('9999-12-31');
	});

	it('agrees with Date.UTC across four centuries', () => {
		const start = Date.UTC(1800, 0, 1);
		const dayInMs = 86_400_000;
		const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
		const mismatches: string[] = [];

		for (let offset = 0; offset < 400 * 366; offset += 11) {
			const day = iso(start + offset * dayInMs);

			for (const count of [-400, -90, -1, 1, 59, 1000]) {
				const expected = iso(start + (offset + count) * dayInMs);

				if (addCalendarDays(day, count) !== expected) {
					mismatches.push(`${day} + ${count}`);
				}
			}
		}

		expect(mismatches).toEqual([]);
	});
});

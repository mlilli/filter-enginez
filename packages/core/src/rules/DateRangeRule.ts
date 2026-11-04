/**
 * `DateRangeRule` — date range filter with relative-range preset support, in one of two modes.
 *
 * @remarks
 * Distinct from `RangeRule` (which is numeric) because dates carry parsing concerns (string
 * representations, Unix-ms numbers, Date instances) and have valuable presets like
 * "last 7 days" that should stay current relative to the time of evaluation, not the time the
 * config was created.
 *
 * **Date mode** (the default: `mode` absent or `'date'`). Values are `Date` instances, date strings
 * or Unix-ms numbers; bounds are `Date`s; presets resolve against `Date.now()` at `action()` time,
 * so "last 7 days" today means a different window tomorrow. `timeZone` names the calendar that a
 * preset's month and year, and a date string without an offset, belong to: `'utc'` or `'local'`.
 * Without it the rule keeps its original, mixed behavior: presets in local time, and a date string
 * read the way `new Date()` reads it (a date-only string as UTC midnight, a date-time without an
 * offset as local time), which can put a boundary on the wrong day for a user west of UTC.
 *
 * **Day mode** (`mode: 'day'`). Values, bounds and `today` are `YYYY-MM-DD` calendar-day strings,
 * compared as strings: no `Date` and no time zone anywhere. Presets resolve against the config's
 * `today`, so the caller decides which calendar day it is, and "last 7 days" is the seven days
 * ending on it. The config is checked when the rule is built, and a value that is not a real
 * calendar day fails the rule.
 *
 * @packageDocumentation
 */

import type { FilterEngineRuleError } from '../errors/index.js';
import type { FieldExtractor, FilterRuleAction, SerializedRule } from '../types.js';

import { addCalendarDays, isCalendarDay } from '../lib/calendarDay.js';
import { FilterRule } from './FilterRule.js';
import { invalidConfig, invalidRuleConfig } from './serializedConfig.js';

// #region docs:date-range-config
/**
 * The supported relative-range presets.
 */
export type DateRangePreset = 'all-time' | 'last-30-days' | 'last-7-days' | 'last-90-days' | 'this-month' | 'this-year';

/**
 * The calendar a Date-mode rule reads its presets and its offset-less date strings in.
 */
export type DateRangeTimeZone = 'local' | 'utc';

/**
 * Configuration for a Date-mode `DateRangeRule` (the default mode).
 *
 * Provide either:
 *   - `start` and/or `end` for absolute bounds
 *   - `preset` for a relative-range shortcut (resolved against `Date.now()` at evaluation time)
 *
 * If both are supplied, `preset` takes precedence. Without `timeZone`, presets use local time and
 * a date string is read as `new Date()` reads it; with it, both use the named calendar.
 */
export interface DateRangeRuleConfig {
	readonly end?: Date;
	readonly mode?: 'date';
	readonly preset?: DateRangePreset;
	readonly start?: Date;
	readonly timeZone?: DateRangeTimeZone;
}

/**
 * Configuration for a day-mode `DateRangeRule`: values, bounds and `today` are `YYYY-MM-DD`
 * calendar-day strings, compared as strings, and both bounds are inclusive.
 *
 * Provide either `start` and/or `end` for absolute bounds, or `preset` with `today`, the calendar
 * day the preset counts from (required for every preset but `'all-time'`). If both are supplied,
 * `preset` takes precedence.
 */
export interface DateRangeDayConfig {
	readonly end?: string;
	readonly mode: 'day';
	readonly preset?: DateRangePreset;
	readonly start?: string;
	readonly today?: string;
}

/**
 * Either mode's configuration.
 */
export type DateRangeConfig = DateRangeDayConfig | DateRangeRuleConfig;
// #endregion docs:date-range-config

/** Every preset, for validating one that arrives from untyped code or a payload. */
const DATE_RANGE_PRESETS: readonly DateRangePreset[] = [
	'all-time',
	'last-30-days',
	'last-7-days',
	'last-90-days',
	'this-month',
	'this-year',
];

/** Every time zone, for the same reason. */
const DATE_RANGE_TIME_ZONES: readonly DateRangeTimeZone[] = ['local', 'utc'];

/** A date string with no offset: a day, optionally with a time to the millisecond. */
const ZONELESS_DATE_STRING = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?)?$/u;

/** A serialized config as it arrives: any key may hold anything. */
interface SerializedDateRangeConfig {
	readonly end?: unknown;
	readonly mode?: unknown;
	readonly preset?: unknown;
	readonly start?: unknown;
	readonly timeZone?: unknown;
	readonly today?: unknown;
}

/** Resolved day-mode bounds, per config object: they depend on nothing else. */
const dayBoundsByConfig = new WeakMap<DateRangeDayConfig, { end?: string; start?: string; }>();

/**
 * Filter items by date range, with relative-range preset support.
 *
 * @typeParam C - The config's mode; Date mode unless a `{ mode: 'day' }` config says otherwise
 *
 * @example
 *   // Items listed in the last 7 days (boundary recomputed each evaluation):
 *   engine.addRule('recent', new DateRangeRule('listedAt', { preset: 'last-7-days' }));
 *
 *   // Items between two specific dates:
 *   engine.addRule(
 *     'q4-2025',
 *     new DateRangeRule('createdAt', {
 *       start: new Date('2025-10-01'),
 *       end: new Date('2025-12-31'),
 *     }),
 *   );
 *
 *   // Transactions posted this month, by calendar day, with the caller's own "today":
 *   engine.addRule(
 *     'this-month',
 *     new DateRangeRule('postedOn', { mode: 'day', preset: 'this-month', today: '2026-11-03' }),
 *   );
 */
export class DateRangeRule<C extends DateRangeConfig = DateRangeRuleConfig> extends FilterRule {
	/**
	 * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
	 * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
	 */
	static override readonly ruleTypeName = 'DateRangeRule';

	override action: FilterRuleAction = (item, rule): boolean => {
		const cfg: DateRangeConfig = (rule as DateRangeRule<DateRangeConfig>).config;
		const fieldValue = this.getFieldValue(item);

		return cfg.mode === 'day' ? matchesDayRange(fieldValue, cfg) : matchesDateRange(fieldValue, cfg);
	};

	config: C;

	/**
	 * @param field - The field holding the date
	 * @param config - Either mode's bounds or preset
	 * @throws `FilterEngineRuleError` with code `RULE_INVALID_CONFIG` when the config names an unknown
	 *   `mode`, `preset` or `timeZone`, when a day-mode `start`, `end` or `today` is not a real
	 *   `YYYY-MM-DD` calendar day, or when a day-mode preset other than `'all-time'` has no `today`
	 */
	constructor(field: FieldExtractor, config: C) {
		super(field);
		checkConfig(config, invalidRuleConfig);
		this.config = config;
	}

	/**
	 * Serialize for JSON: a Date-mode bound becomes an ISO 8601 string, a day-mode bound is already
	 * one. The companion `DateRangeRule.deserialize` (below) reconstructs `Date` instances via
	 * `new Date(iso)` for Date mode.
	 */
	override serialize(): SerializedRule {
		const config: DateRangeConfig = this.config;

		return {
			config: config.mode === 'day'
				? { end: config.end, mode: config.mode, preset: config.preset, start: config.start, today: config.today }
				: {
					end: config.end?.toISOString(),
					mode: config.mode,
					preset: config.preset,
					start: config.start?.toISOString(),
					timeZone: config.timeZone,
				},
			field: typeof this.field === 'function' ? '<function>' : this.field,
			type: DateRangeRule.ruleTypeName,
		};
	}

	/**
	 * Reconstruct a `DateRangeRule` from its serialized form. Called by
	 * `ruleRegistry.deserialize` when it detects this static hook — the generic deserialize
	 * path would assign the raw ISO-string config back to `this.config`, leaving a Date-mode
	 * `.start` and `.end` as strings rather than `Date` instances. The `action` callback's
	 * `coerceToDate` helper would still work (it accepts ISO strings), but the type contract documented
	 * elsewhere assumes Dates, so we reconstruct them here for round-trip honesty. A day-mode config
	 * keeps its strings.
	 *
	 * A `start`, `end` or `today` that is absent or `null` is open (or unset) and revives as absent;
	 * `new Date(null)` would otherwise read it as 1970-01-01.
	 *
	 * @param json - The serialized rule (must be a `DateRangeRule` shape)
	 * @returns A reconstituted `DateRangeRule` instance, with `Date` instances restored in Date mode
	 * @throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` when a Date-mode
	 *   `start` or `end` is present but is not a string or number that parses as a date, or for
	 *   anything the constructor rejects (see its `@throws`)
	 */
	static deserialize(json: SerializedRule): DateRangeRule<DateRangeConfig> {
		const serialized = json.config as SerializedDateRangeConfig;
		const config = (serialized.mode === 'day' ? reviveDayConfig(serialized) : reviveDateConfig(serialized)) as DateRangeConfig;

		checkConfig(config, invalidConfig);
		const field = json.field === '<function>' ? undefined : (json.field);

		return new DateRangeRule(field, config);
	}
}

/**
 * Check a config either mode can run, throwing through `makeError` (the constructor's code, or the
 * payload's when `deserialize` checks first).
 *
 * @param config - The config to check
 * @param makeError - Builds the error for one failed key
 */
function checkConfig(
	config: DateRangeConfig,
	makeError: (where: string, expected: string, value: unknown) => FilterEngineRuleError,
): void {
	const { mode, preset, timeZone } = config as { mode?: unknown; preset?: unknown; timeZone?: unknown; };

	if (mode !== undefined && mode !== 'date' && mode !== 'day') {
		throw makeError('DateRangeRule config.mode', '\'date\', \'day\', or absent', mode);
	}
	if (preset !== undefined && !(DATE_RANGE_PRESETS as readonly unknown[]).includes(preset)) {
		throw makeError('DateRangeRule config.preset', `one of ${DATE_RANGE_PRESETS.join(' ')}`, preset);
	}
	if (config.mode !== 'day') {
		if (timeZone !== undefined && !(DATE_RANGE_TIME_ZONES as readonly unknown[]).includes(timeZone)) {
			throw makeError('DateRangeRule config.timeZone', '\'utc\', \'local\', or absent', timeZone);
		}

		return;
	}
	for (const key of ['start', 'end', 'today'] as const) {
		if (config[key] !== undefined && !isCalendarDay(config[key])) {
			throw makeError(`DateRangeRule config.${key}`, 'a YYYY-MM-DD calendar day', config[key]);
		}
	}
	if (config.preset !== undefined && config.preset !== 'all-time' && config.today === undefined) {
		throw makeError('DateRangeRule config.today', `a YYYY-MM-DD calendar day for preset '${config.preset}'`, undefined);
	}
}

/**
 * Revive a serialized Date-mode config: bounds become `Date`s, the rest is read as written.
 *
 * @param serialized - The serialized config
 * @returns The config, before {@link checkConfig}
 */
function reviveDateConfig(serialized: SerializedDateRangeConfig): SerializedDateRangeConfig {
	const start = reviveDateBound(serialized.start, 'start');
	const end = reviveDateBound(serialized.end, 'end');

	return {
		...(start !== undefined ? { start } : {}),
		...(end !== undefined ? { end } : {}),
		...(serialized.mode !== undefined ? { mode: serialized.mode } : {}),
		...(serialized.preset !== undefined ? { preset: serialized.preset } : {}),
		...(serialized.timeZone !== undefined && serialized.timeZone !== null ? { timeZone: serialized.timeZone } : {}),
	};
}

/**
 * Revive a serialized day-mode config: every key is read as written, `null` as absent.
 *
 * @param serialized - The serialized config
 * @returns The config, before {@link checkConfig}
 */
function reviveDayConfig(serialized: SerializedDateRangeConfig): SerializedDateRangeConfig {
	const config: Record<string, unknown> = { mode: 'day' };

	for (const key of ['start', 'end', 'preset', 'today'] as const) {
		if (serialized[key] !== undefined && serialized[key] !== null) {
			config[key] = serialized[key];
		}
	}

	return config;
}

/**
 * Revive one serialized Date-mode bound: absent or `null` is open (`undefined`); an ISO string or a
 * Unix-ms number becomes a `Date`.
 *
 * @param value - The serialized `start` or `end`
 * @param key - Which bound it is, for the error message
 * @returns The bound as a `Date`, or `undefined` for an open bound
 * @throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` when `value` is neither
 *   a string nor a number, or does not parse as a date
 */
function reviveDateBound(value: unknown, key: 'end' | 'start'): Date | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	const date = typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;

	if (date === null || Number.isNaN(date.getTime())) {
		throw invalidConfig(`DateRangeRule config.${key}`, 'a date string, a Unix-ms number, or null for an open bound', value);
	}

	return date;
}

/**
 * Whether a field value falls in a Date-mode range.
 *
 * @param value - The item's field value
 * @param config - The rule's Date-mode config
 * @returns `true` when the value is a date within the bounds (or the preset's window)
 */
function matchesDateRange(value: unknown, config: DateRangeRuleConfig): boolean {
	const date = coerceToDate(value, config.timeZone);

	if (!date) {
		return false;
	}
	const resolved = config.preset ? resolvePreset(config.preset, config.timeZone) : { end: config.end, start: config.start };

	if (resolved.start && date < resolved.start) {
		return false;
	}
	if (resolved.end && date > resolved.end) {
		return false;
	}

	return true;
}

/**
 * Whether a field value falls in a day-mode range.
 *
 * @param value - The item's field value
 * @param config - The rule's day-mode config
 * @returns `true` when the value is a calendar day within the bounds (or the preset's window)
 */
function matchesDayRange(value: unknown, config: DateRangeDayConfig): boolean {
	if (!isCalendarDay(value)) {
		return false;
	}
	let resolved = dayBoundsByConfig.get(config);

	if (resolved === undefined) {
		resolved = config.preset === undefined ? { end: config.end, start: config.start } : resolveDayPreset(config.preset, config.today);
		dayBoundsByConfig.set(config, resolved);
	}
	if (resolved.start !== undefined && value < resolved.start) {
		return false;
	}
	if (resolved.end !== undefined && value > resolved.end) {
		return false;
	}

	return true;
}

/**
 * Resolve a relative-range preset into concrete start/end Date instances at the current time.
 *
 * @param preset - The preset
 * @param timeZone - The calendar `'this-month'` and `'this-year'` start in; local time when absent
 * @param now - The current time
 * @returns The window, ending at `now`; `'all-time'` is unbounded
 *
 * @internal Exposed for tests; consumers should use `DateRangeRule` directly.
 */
export function resolvePreset(
	preset: DateRangePreset,
	timeZone?: DateRangeTimeZone,
	now: Date = new Date(),
): { end?: Date; start?: Date; } {
	const dayInMs = 24 * 60 * 60 * 1000;
	const isUtc = timeZone === 'utc';
	const year = isUtc ? now.getUTCFullYear() : now.getFullYear();
	const month = isUtc ? now.getUTCMonth() : now.getMonth();

	switch (preset) {
		case 'all-time':
			return {};
		case 'last-30-days':
			return { end: now, start: new Date(now.getTime() - 30 * dayInMs) };
		case 'last-7-days':
			return { end: now, start: new Date(now.getTime() - 7 * dayInMs) };
		case 'last-90-days':
			return { end: now, start: new Date(now.getTime() - 90 * dayInMs) };
		case 'this-month':
			return { end: now, start: isUtc ? new Date(Date.UTC(year, month, 1)) : new Date(year, month, 1) };
		case 'this-year':
			return { end: now, start: isUtc ? new Date(Date.UTC(year, 0, 1)) : new Date(year, 0, 1) };
	}
}

/**
 * Resolve a relative-range preset into inclusive `YYYY-MM-DD` bounds counted from `today`, with no
 * `Date` and no time zone. "Last N days" is the N calendar days ending on `today`.
 *
 * @param preset - The preset
 * @param today - The calendar day the preset counts from; required for every preset but `'all-time'`
 * @returns The window, ending on `today`; `'all-time'` is unbounded
 * @throws `FilterEngineRuleError` with code `RULE_INVALID_CONFIG` when `today` is needed and is not
 *   a real `YYYY-MM-DD` calendar day
 *
 * @internal Exposed for tests; consumers should use `DateRangeRule` directly.
 */
export function resolveDayPreset(preset: DateRangePreset, today: string | undefined): { end?: string; start?: string; } {
	if (preset === 'all-time') {
		return {};
	}
	if (!isCalendarDay(today)) {
		throw invalidRuleConfig('DateRangeRule config.today', `a YYYY-MM-DD calendar day for preset '${preset}'`, today);
	}

	switch (preset) {
		case 'last-30-days':
			return { end: today, start: addCalendarDays(today, -29) };
		case 'last-7-days':
			return { end: today, start: addCalendarDays(today, -6) };
		case 'last-90-days':
			return { end: today, start: addCalendarDays(today, -89) };
		case 'this-month':
			return { end: today, start: `${today.slice(0, 8)}01` };
		case 'this-year':
			return { end: today, start: `${today.slice(0, 5)}01-01` };
	}
}

/**
 * Coerce a field value into a Date. Accepts Date instances, date strings, and Unix-ms numbers.
 *
 * @param value - The field value
 * @param timeZone - The calendar a date string without an offset is read in; `new Date()`'s own
 *   reading when absent
 * @returns The date, or `null` for a value that is not one
 *
 * @internal
 */
function coerceToDate(value: unknown, timeZone: DateRangeTimeZone | undefined): Date | null {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value;
	}
	if (typeof value === 'string' && timeZone !== undefined) {
		const zoneless = readZonelessDateString(value, timeZone);

		if (zoneless !== undefined) {
			return zoneless;
		}
	}
	if (typeof value === 'string' || typeof value === 'number') {
		const date = new Date(value);

		return Number.isNaN(date.getTime()) ? null : date;
	}

	return null;
}

/**
 * Read a date string that carries no offset (`YYYY-MM-DD`, optionally with a time) in the named
 * calendar.
 *
 * @param text - The string
 * @param timeZone - The calendar to read it in
 * @returns The date; `null` when it has that shape but names no real day or time; `undefined` when
 *   it does not have that shape (an offset, `Z`, or another format), for `new Date()` to read
 */
function readZonelessDateString(text: string, timeZone: DateRangeTimeZone): Date | null | undefined {
	const match = ZONELESS_DATE_STRING.exec(text);

	if (match === null) {
		return undefined;
	}
	const [, day, hours, minutes, seconds, fraction] = match;
	const time = [Number(hours ?? 0), Number(minutes ?? 0), Number(seconds ?? 0), Number((fraction ?? '0').padEnd(3, '0'))] as const;

	if (!isCalendarDay(day) || time[0] > 23 || time[1] > 59 || time[2] > 59) {
		return null;
	}
	const date = new Date(0);
	const [year, month, dayOfMonth] = [Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))];

	if (timeZone === 'utc') {
		date.setUTCFullYear(year, month, dayOfMonth);
		date.setUTCHours(...time);
	} else {
		date.setFullYear(year, month, dayOfMonth);
		date.setHours(...time);
	}

	return date;
}

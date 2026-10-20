/**
 * `DateRangeRule` — date-valued range filter with relative-range preset support.
 *
 * @remarks
 * Distinct from `RangeRule` (which is numeric) because dates carry parsing concerns (string
 * representations, Unix-ms numbers, Date instances) and have valuable presets like
 * "last 7 days" that should stay current relative to the time of evaluation, not the time the
 * config was created.
 *
 * Preset ranges are resolved at `action()` call time using `Date.now()`, so the boundaries
 * stay accurate as time passes — "last 7 days" today means a different window tomorrow.
 *
 * @packageDocumentation
 */

import type { FieldExtractor, FilterRuleAction, SerializedRule } from '../types.js';

import { FilterRule } from './FilterRule.js';
import { invalidConfig } from './serializedConfig.js';

// #region docs:date-range-config
/**
 * The supported relative-range presets.
 */
export type DateRangePreset = 'all-time' | 'last-30-days' | 'last-7-days' | 'last-90-days' | 'this-month' | 'this-year';

/**
 * Configuration for `DateRangeRule`.
 *
 * Provide either:
 *   - `start` and/or `end` for absolute bounds
 *   - `preset` for a relative-range shortcut (resolved at evaluation time)
 *
 * If both are supplied, `preset` takes precedence.
 */
export interface DateRangeRuleConfig {
	readonly end?: Date;
	readonly preset?: DateRangePreset;
	readonly start?: Date;
}
// #endregion docs:date-range-config

/**
 * Filter items by date range, with relative-range preset support.
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
 */
export class DateRangeRule extends FilterRule {
	/**
	 * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
	 * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
	 */
	static override readonly ruleTypeName = 'DateRangeRule';

	override action: FilterRuleAction = (item, rule): boolean => {
		const fieldValue = this.getFieldValue(item);
		const date = coerceToDate(fieldValue);

		if (!date) {
			return false;
		}

		const cfg = (rule as DateRangeRule).config;
		const resolved = cfg.preset ? resolvePreset(cfg.preset) : { end: cfg.end, start: cfg.start };

		if (resolved.start && date < resolved.start) {
			return false;
		}
		if (resolved.end && date > resolved.end) {
			return false;
		}

		return true;
	};

	config: DateRangeRuleConfig;

	constructor(field: FieldExtractor, config: DateRangeRuleConfig) {
		super(field);
		this.config = config;
	}

	/**
	 * Serialize Date instances to ISO 8601 strings for JSON safety. The companion
	 * `DateRangeRule.deserialize` (below) reconstructs `Date` instances via `new Date(iso)`.
	 */
	override serialize(): SerializedRule {
		return {
			config: {
				end: this.config.end?.toISOString(),
				preset: this.config.preset,
				start: this.config.start?.toISOString(),
			},
			field: typeof this.field === 'function' ? '<function>' : this.field,
			type: DateRangeRule.ruleTypeName,
		};
	}

	/**
	 * Reconstruct a `DateRangeRule` from its serialized form. Called by
	 * `ruleRegistry.deserialize` when it detects this static hook — the generic deserialize
	 * path would assign the raw ISO-string config back to `this.config`, leaving `.start` and
	 * `.end` as strings rather than `Date` instances. The `action` callback's `coerceToDate`
	 * helper would still work (it accepts ISO strings), but the type contract documented
	 * elsewhere assumes Dates, so we reconstruct them here for round-trip honesty.
	 *
	 * A `start` or `end` that is absent or `null` is an open bound and revives as absent; `new
	 * Date(null)` would otherwise read it as 1970-01-01.
	 *
	 * @param json - The serialized rule (must be a `DateRangeRule` shape)
	 * @returns A reconstituted `DateRangeRule` instance with `Date` instances restored
	 * @throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` when `start` or `end`
	 *   is present but is not a string or number that parses as a date
	 */
	static deserialize(json: SerializedRule): DateRangeRule {
		const serializedConfig = json.config as {
			end?: unknown;
			preset?: DateRangePreset;
			start?: unknown;
		};
		const start = reviveDateBound(serializedConfig.start, 'start');
		const end = reviveDateBound(serializedConfig.end, 'end');
		const config: DateRangeRuleConfig = {
			...(start !== undefined ? { start } : {}),
			...(end !== undefined ? { end } : {}),
			...(serializedConfig.preset !== undefined ? { preset: serializedConfig.preset } : {}),
		};
		const field = json.field === '<function>' ? undefined : (json.field);

		return new DateRangeRule(field, config);
	}
}

/**
 * Revive one serialized `DateRangeRule` bound: absent or `null` is open (`undefined`); an ISO string
 * or a Unix-ms number becomes a `Date`.
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
 * Resolve a relative-range preset into concrete start/end Date instances at the current time.
 *
 * @internal Exposed for tests; consumers should use `DateRangeRule` directly.
 */
export function resolvePreset(preset: DateRangePreset): { end?: Date; start?: Date; } {
	const now = new Date();
	const dayInMs = 24 * 60 * 60 * 1000;

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
			return { end: now, start: new Date(now.getFullYear(), now.getMonth(), 1) };
		case 'this-year':
			return { end: now, start: new Date(now.getFullYear(), 0, 1) };
	}
}

/**
 * Coerce a field value into a Date. Accepts Date instances, ISO strings, and Unix-ms numbers.
 *
 * @internal
 */
function coerceToDate(value: unknown): Date | null {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value;
	}
	if (typeof value === 'string' || typeof value === 'number') {
		const date = new Date(value);

		return Number.isNaN(date.getTime()) ? null : date;
	}

	return null;
}

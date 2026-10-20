/**
 * Readers for the `static deserialize` hooks of rules whose config holds numbers: they turn a
 * `SerializedRule`'s `config` back into the values the rule holds, including the open bounds JSON
 * cannot spell.
 *
 * @remarks
 * **JSON has no `Infinity`, `-Infinity` or `NaN`.** `JSON.stringify` writes each of them as `null`, so
 * a rule holding an open numeric bound (`new RangeRule('price', { min: 60, max: Infinity })`) reaches
 * `loadConfig`, a URL or a request body with `null` in that position. Left as it is, that `null`
 * coerces to `0` in the rule's comparison (`75 <= null` is `false`), which turns "no upper limit"
 * into "at most 0" and matches nothing.
 *
 * {@link reviveOpenBound} reads `null` as the open bound its position stands for, which is exactly
 * what `JSON.stringify` wrote for `±Infinity`. A value that is not a number at all (a string, a
 * missing key, or a `NaN` that arrived through `structuredClone` or a hand-built object) throws
 * `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG`, naming the rule type and the
 * key.
 *
 * Internal to `core`: the hooks of `RangeRule`, `NumericComparisonRule`, `GeoProximityRule`,
 * `FuzzySearchRule` and `DateRangeRule` are its only callers.
 *
 * @packageDocumentation
 */

import type { FieldExtractor, SerializedRule } from '../types.js';

import { FilterEngineRuleError } from '../errors/index.js';

/**
 * Render a rejected value for an error message: strings quoted, everything else as `String()`
 * spells it (`NaN`, `undefined`, `true`).
 *
 * @param value - The value that failed a check
 * @returns A short, unambiguous rendering of it
 */
function describeValue(value: unknown): string {
	return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * Build the error every reader here throws.
 *
 * @param where - The rule type and key that failed, e.g. `RangeRule config.max`
 * @param expected - What the key must hold
 * @param value - What it held instead
 * @returns A `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG`
 */
export function invalidConfig(where: string, expected: string, value: unknown): FilterEngineRuleError {
	return new FilterEngineRuleError(
		'RULE_INVALID_SERIALIZED_CONFIG',
		`${where} must be ${expected}; got ${describeValue(value)}.`,
	);
}

/**
 * The field extractor a serialized rule names: its `field`, with the `'<function>'` placeholder
 * (written for a function extractor, which cannot be serialized) read as `undefined`.
 *
 * @param json - The serialized rule
 * @returns The extractor to construct the revived rule with
 */
export function revivedField(json: SerializedRule): FieldExtractor {
	return json.field === '<function>' ? undefined : json.field;
}

/**
 * Read a value that must be a plain object: a rule's `config`, or an object nested in it.
 *
 * @param value - The value to check
 * @param where - The rule type and key, for the error message
 * @returns The value, typed as a record of unknowns for the caller to read key by key
 * @throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` when `value` is `null`
 *   or not an object
 */
export function readRecord(value: unknown, where: string): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== 'object') {
		throw invalidConfig(where, 'an object', value);
	}

	return value as Readonly<Record<string, unknown>>;
}

/**
 * Read a numeric bound that may be open: `null` (how JSON writes `±Infinity`) becomes `openBound`,
 * and any number other than `NaN` (`±Infinity` included, as `structuredClone` carries them) is kept.
 *
 * @param value - The serialized bound
 * @param openBound - The value an open bound in this position stands for: `-Infinity` for a lower
 *   bound, `Infinity` for an upper one
 * @param where - The rule type and key, for the error message
 * @returns The bound as a number
 * @throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` when `value` is neither
 *   `null` nor a number, or is `NaN`
 */
export function reviveOpenBound(value: unknown, openBound: number, where: string): number {
	if (value === null) {
		return openBound;
	}
	if (typeof value !== 'number' || Number.isNaN(value)) {
		throw invalidConfig(where, 'a number, or null for an open bound', value);
	}

	return value;
}

/**
 * Read a serialized rule's config object and revive the numeric bounds it holds, keeping every other
 * key as it is.
 *
 * @typeParam BoundKey - The config keys that hold bounds
 * @param json - The serialized rule
 * @param openBounds - Each bound key, with the value an open (`null`) bound in it stands for
 * @param isOptional - When `true`, a bound key that is absent stays absent (the rule's default
 *   applies); when `false`, an absent bound is rejected like any other non-number
 * @returns The config, its bound keys revived as numbers
 * @throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` when `json.config` is not
 *   an object, or a bound is neither a number nor `null`
 */
export function reviveBounds<BoundKey extends string>(
	json: SerializedRule,
	openBounds: Readonly<Record<BoundKey, number>>,
	isOptional = false,
): Readonly<Record<BoundKey, number> & Record<string, unknown>> {
	const config = readRecord(json.config, `${json.type} config`);
	const revived: Record<string, unknown> = { ...config };

	for (const [key, openBound] of Object.entries<number>(openBounds)) {
		if (!isOptional || config[key] !== undefined) {
			revived[key] = reviveOpenBound(config[key], openBound, `${json.type} config.${key}`);
		}
	}

	return revived as Record<BoundKey, number> & Record<string, unknown>;
}

/**
 * Read a number that has no open form, such as a coordinate: it must be finite, so a `null` (a
 * coordinate JSON could not write) is rejected rather than read as `0`.
 *
 * @param value - The serialized number
 * @param where - The rule type and key, for the error message
 * @returns The number
 * @throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` when `value` is not a
 *   finite number
 */
export function reviveFiniteNumber(value: unknown, where: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw invalidConfig(where, 'a finite number', value);
	}

	return value;
}

/**
 * `ArrayMatch` — how a membership rule reads a field that holds an array, shared by `InSetRule`,
 * `InSetofSetsRule` and `HierarchicalRule`, and the serialized-config check their revival hooks run.
 *
 * @remarks
 * Each of those rules tests a field against a **selection**: a list of selection units, where a
 * unit is one value (`InSetRule`), one subset (`InSetofSetsRule`) or one selected tree node
 * (`HierarchicalRule`). A field holding a single value passes when it satisfies any unit. A field
 * holding an array (`paymentMethods: ['card', 'cash']`) is a set of values, and `arrayMatch` picks
 * how that set meets the selection:
 *
 * - **`'any'`** (the default): at least one element satisfies at least one unit — "accepts any of
 *   these payment methods". Selecting another unit widens the result.
 * - **`'all'`**: every unit is satisfied by at least one element — "has all of these features".
 *   Selecting another unit narrows the result.
 *
 * Under either mode an empty selection constrains nothing, and an empty array satisfies no unit, so
 * it fails any non-empty selection. A field that is not an array reads exactly as it always has,
 * whatever the mode.
 *
 * @packageDocumentation
 */

import type { SerializedRule } from '../types.js';

import { invalidConfig, readRecord } from './serializedConfig.js';

/** How an array-valued field meets a membership rule's selection: see the module docs. */
export type ArrayMatch = 'all' | 'any';

/** The options a membership rule takes beside its selection. */
export interface ArrayMatchOptions {
	/**
	 * How an array-valued field meets the selection: `'any'` (default) passes when some element is
	 * selected, `'all'` when every selected unit is present. Ignored for a field that is not an array.
	 */
	readonly arrayMatch?: ArrayMatch;
}

/**
 * Whether an array field meets a selection.
 *
 * @typeParam Unit - One selection unit: a value, a subset or a selected node id
 * @param elements - The field's array
 * @param units - The selection; the caller has already passed an empty one
 * @param arrayMatch - The mode; absent reads as `'any'`
 * @param satisfies - Whether one element satisfies one unit
 * @returns `true` when the array meets the selection under the mode
 */
export function matchesArraySelection<Unit>(
	elements: readonly unknown[],
	units: readonly Unit[],
	arrayMatch: ArrayMatch | undefined,
	satisfies: (unit: Unit, element: unknown) => boolean,
): boolean {
	if (arrayMatch === 'all') {
		return units.every((unit) => elements.some((element) => satisfies(unit, element)));
	}

	return elements.some((element) => units.some((unit) => satisfies(unit, element)));
}

/**
 * Equality as `Array.prototype.includes` reads it (SameValueZero): `NaN` equals `NaN`, and `0` equals
 * `-0`. `InSetRule` compares array elements with it, so an element matches exactly the values a
 * single field value would.
 *
 * @param valueA - One value
 * @param valueB - The other
 * @returns Whether `includes` would treat them as the same value
 */
export function isSameValueZero(valueA: unknown, valueB: unknown): boolean {
	return valueA === valueB || (Number.isNaN(valueA) && Number.isNaN(valueB));
}

/**
 * Read the config of a serialized membership rule, checking its `arrayMatch`.
 *
 * @param json - The serialized rule
 * @returns The config, every key kept as written
 * @throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` when `config` is not an
 *   object, or `arrayMatch` is present and neither `'any'` nor `'all'`
 */
export function readArrayMatchConfig(json: SerializedRule): Readonly<Record<string, unknown>> {
	const config = readRecord(json.config, `${json.type} config`);
	const { arrayMatch } = config;

	if (arrayMatch !== undefined && arrayMatch !== 'any' && arrayMatch !== 'all') {
		throw invalidConfig(`${json.type} config.arrayMatch`, '\'any\' or \'all\'', arrayMatch);
	}

	return config;
}

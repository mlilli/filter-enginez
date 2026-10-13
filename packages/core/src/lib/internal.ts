/**
 * Internal utility helpers used across the core engine.
 *
 * @remarks
 * These exist so the core can stay free of lodash (per the no-runtime-deps-bloat decision).
 * Each helper is ~5-15 LOC of strict-TypeScript code, no external dependencies. Lodash remains acceptable in tests and example apps; just not here.
 *
 * @packageDocumentation
 */

/**
 * Type guard for `null` or `undefined`.
 *
 * @param value - Any value
 * @returns `true` if value is `null` or `undefined`, `false` otherwise
 */
export function isNil(value: unknown): value is null | undefined {
	return value === null || value === undefined;
}

/**
 * Symmetric difference of two arrays — elements present in exactly one of the two inputs.
 *
 * Equivalent to lodash's `_.xor`. Order-preserving relative to the first array, then the
 * second. Uses `Set` for O(n + m) complexity.
 *
 * @example
 *   xor([1, 2, 3], [2, 3, 4])  // → [1, 4]
 *
 * @param arrayA - First array
 * @param arrayB - Second array
 * @returns Elements present in exactly one of the two arrays
 */
export function xor<T>(arrayA: readonly T[], arrayB: readonly T[]): T[] {
	const setA = new Set(arrayA);
	const setB = new Set(arrayB);
	const result: T[] = [];

	for (const value of arrayA) {
		if (!setB.has(value)) {
			result.push(value);
		}
	}
	for (const value of arrayB) {
		if (!setA.has(value)) {
			result.push(value);
		}
	}

	return result;
}

/**
 * Recursive structural equality check.
 *
 * Comparable to lodash's `_.isEqual` for the subset of types relevant to filter rule configs
 * (primitives, arrays, plain objects, Dates). Not a full deep-equal — does not handle functions,
 * Sets, Maps, or circular references.
 *
 * @param valueA - First value
 * @param valueB - Second value
 * @returns `true` if structurally equal, `false` otherwise
 */
export function deepEqual(valueA: unknown, valueB: unknown): boolean {
	if (valueA === valueB) {
		return true;
	}
	if (valueA === null || valueB === null) {
		return false;
	}
	if (typeof valueA !== typeof valueB) {
		return false;
	}
	if (valueA instanceof Date && valueB instanceof Date) {
		return valueA.getTime() === valueB.getTime();
	}
	if (Array.isArray(valueA) && Array.isArray(valueB)) {
		if (valueA.length !== valueB.length) {
			return false;
		}

		return valueA.every((item, index) => deepEqual(item, valueB[index]));
	}
	if (typeof valueA === 'object' && typeof valueB === 'object') {
		const keysA = Object.keys(valueA);
		const keysB = Object.keys(valueB);

		if (keysA.length !== keysB.length) {
			return false;
		}

		return keysA.every((key) =>
			deepEqual(
				(valueA as Record<string, unknown>)[key],
				(valueB as Record<string, unknown>)[key],
			),
		);
	}

	return false;
}

/**
 * Group an array's items by a key function, returning a Map for ordered iteration + O(1) lookup.
 *
 * @example
 *   groupBy([{ kind: 'a', n: 1 }, { kind: 'b', n: 2 }, { kind: 'a', n: 3 }], (x) => x.kind);
 *   // → Map { 'a' => [{kind:'a',n:1}, {kind:'a',n:3}], 'b' => [{kind:'b',n:2}] }
 *
 * @param array - Source array
 * @param keyFn - Function mapping each item to its grouping key
 * @returns Map keyed by the result of `keyFn`, valued by arrays of items with that key
 */
export function groupBy<T, K>(array: readonly T[], keyFn: (item: T) => K): Map<K, T[]> {
	const groups = new Map<K, T[]>();

	for (const item of array) {
		const key = keyFn(item);
		const existing = groups.get(key);

		if (existing) {
			existing.push(item);
		} else {
			groups.set(key, [item]);
		}
	}

	return groups;
}

/**
 * Flatten an array of arrays one level deep.
 *
 * @example
 *   flatten([[1, 2], [3], [4, 5]])  // → [1, 2, 3, 4, 5]
 *
 * @param arrayOfArrays - Array of arrays to flatten
 * @returns Single-level flattened array
 */
export function flatten<T>(arrayOfArrays: readonly (readonly T[])[]): T[] {
	const result: T[] = [];

	for (const inner of arrayOfArrays) {
		for (const item of inner) {
			result.push(item);
		}
	}

	return result;
}

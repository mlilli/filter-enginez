/**
 * Set operations — intersection, union, difference.
 *
 * @remarks
 * Used by the mutual exclusion graph (`internals/ExclusionGraph`) and exposed as a public
 * sub-export for consumers building rule composition over Sets.
 *
 * All three are O(min(|a|, |b|)) for intersection and O(|a| + |b|) for union/difference.
 *
 * @packageDocumentation
 */

/**
 * The intersection of two sets — elements present in BOTH.
 *
 * @example
 *   intersectionSet(new Set([1, 2, 3]), new Set([2, 3, 4]))  // → Set { 2, 3 }
 *
 * @param setA - First set
 * @param setB - Second set
 * @returns A new Set containing elements present in both inputs
 */
export function intersectionSet<T>(setA: ReadonlySet<T>, setB: ReadonlySet<T>): Set<T> {
	const result = new Set<T>();
	// Iterate over the smaller set for O(min(|a|, |b|)) traversal.
	const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];

	for (const value of smaller) {
		if (larger.has(value)) {
			result.add(value);
		}
	}

	return result;
}

/**
 * The union of two sets — elements present in EITHER.
 *
 * @example
 *   unionSet(new Set([1, 2]), new Set([2, 3]))  // → Set { 1, 2, 3 }
 *
 * @param setA - First set
 * @param setB - Second set
 * @returns A new Set containing elements present in either input
 */
export function unionSet<T>(setA: ReadonlySet<T>, setB: ReadonlySet<T>): Set<T> {
	const result = new Set<T>(setA);

	for (const value of setB) {
		result.add(value);
	}

	return result;
}

/**
 * The asymmetric difference — elements present in `setA` but NOT in `setB`.
 *
 * @example
 *   differenceSet(new Set([1, 2, 3]), new Set([2, 3, 4]))  // → Set { 1 }
 *
 * @param setA - The set to subtract from
 * @param setB - The set whose elements to exclude
 * @returns A new Set containing elements in `setA` that are not in `setB`
 */
export function differenceSet<T>(setA: ReadonlySet<T>, setB: ReadonlySet<T>): Set<T> {
	const result = new Set<T>();

	for (const value of setA) {
		if (!setB.has(value)) {
			result.add(value);
		}
	}

	return result;
}

/**
 * Resolver for dotted-path and bracket-indexed property access — the string-form
 * `FieldExtractor` in the engine's filter rules.
 *
 * @remarks
 * Replaces lodash's `_.get` so `core` stays lodash-free.
 * Supports:
 *   - simple keys: `'name'`
 *   - dotted paths: `'address.city'`
 *   - array indices: `'tags[0]'`, `'items[3].name'`
 *   - bracketed keys with quotes (for keys containing dots or special characters):
 *     `'meta["weird.key"]'`
 *
 * @packageDocumentation
 */

// #region docs:get-path
/**
 * Resolve a string path against an object, returning the value at that path or `undefined`
 * if any segment of the path is missing.
 *
 * @example
 *   getPath({ a: { b: { c: 42 } } }, 'a.b.c')              // → 42
 *   getPath({ tags: ['x', 'y'] }, 'tags[1]')               // → 'y'
 *   getPath({ meta: { 'weird.key': 1 } }, 'meta["weird.key"]') // → 1
 *   getPath({ a: 1 }, 'b.c')                                // → undefined
 *
 * @param object - The object to traverse
 * @param path - The string path (dotted + bracketed)
 * @returns The value at the path, or `undefined` if not found
 */
export function getPath(object: unknown, path: string): unknown {
	if (object === null || object === undefined) {
		return undefined;
	}

	// Fast path for simple top-level keys with no dots or brackets.
	if (!path.includes('.') && !path.includes('[')) {
		return (object as Record<string, unknown>)[path];
	}

	const segments = parsePath(path);
	let cursor: unknown = object;

	for (const segment of segments) {
		if (cursor === null || cursor === undefined) {
			return undefined;
		}
		cursor = (cursor as Record<string, unknown>)[segment];
	}

	return cursor;
}
// #endregion docs:get-path

/**
 * Parse a path string into an array of segments.
 *
 * Internal helper exposed for tests; consumers should use `getPath` directly.
 *
 * @param path - The path string to parse
 * @returns Array of string segments (object keys / array indices, all as strings)
 */
export function parsePath(path: string): string[] {
	const segments: string[] = [];
	let buffer = '';
	let index = 0;

	while (index < path.length) {
		const char = path[index];

		// `path[index]` is provably defined here — the `while (index < path.length)` bound
		// guarantees it — but `noUncheckedIndexedAccess` widens the indexed access to
		// `string | undefined`, forcing this guard. The branch is unreachable at runtime.
		/* v8 ignore next 3 -- defensive: unreachable guard required by noUncheckedIndexedAccess */
		if (char === undefined) {
			break;
		}
		if (char === '.') {
			if (buffer.length > 0) {
				segments.push(buffer);
				buffer = '';
			}
			index++;
			continue;
		}

		if (char === '[') {
			if (buffer.length > 0) {
				segments.push(buffer);
				buffer = '';
			}
			// Find matching ']'. May contain a quoted string ("..." or '...') for keys with special chars.
			index++; // skip the '['
			const quoteChar = path[index];

			if (quoteChar === '"' || quoteChar === "'") {
				index++; // skip opening quote
				while (index < path.length && path[index] !== quoteChar) {
					buffer += path[index];
					index++;
				}
				index++; // skip closing quote
				index++; // skip ']'
				segments.push(buffer);
				buffer = '';
			} else {
				// Unquoted index, e.g. tags[0]
				while (index < path.length && path[index] !== ']') {
					buffer += path[index];
					index++;
				}
				index++; // skip ']'
				segments.push(buffer);
				buffer = '';
			}
			continue;
		}

		buffer += char;
		index++;
	}

	if (buffer.length > 0) {
		segments.push(buffer);
	}

	return segments;
}

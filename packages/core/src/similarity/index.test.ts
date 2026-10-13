/**
 * @remarks
 * Pass-3 coverage for the similarity barrel — asserts the public re-exports are live class
 * bindings (constructable / callable), guarding against an accidentally-dropped or renamed
 * export in {@link ../similarity/index.ts}. The barrel itself is declarative; this suite only
 * verifies the runtime surface it exposes.
 *
 * @packageDocumentation
 */

import { describe, expect, it } from 'vitest';

import { LSH, MinHash, SimilaritySearch } from './index.js';

describe('similarity barrel exports', () => {
	it('re-exports MinHash as a constructable class', () => {
		expect(typeof MinHash).toBe('function');
		expect(new MinHash(8).numHashes).toBe(8);
	});

	it('re-exports LSH as a constructable class', () => {
		expect(typeof LSH).toBe('function');
		expect(new LSH(8, 4).numBands).toBe(2);
	});

	it('re-exports SimilaritySearch as a constructable class', () => {
		expect(typeof SimilaritySearch).toBe('function');
		expect(new SimilaritySearch().getConfig()).toBeUndefined();
	});
});

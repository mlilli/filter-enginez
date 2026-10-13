/**
 * Barrel export for the similarity layer (MinHash + LSH + the `engine.findSimilar` API).
 *
 * @packageDocumentation
 */

export { MinHash } from './MinHash.js';
export { LSH } from './LSH.js';
export {
	type SimilarityConfig,
	type SimilarityQuery,
	type SimilarityResult,
	SimilaritySearch,
} from './SimilaritySearch.js';
export { attachSimilarity, type SimilarityAttachTarget } from './attachSimilarity.js';

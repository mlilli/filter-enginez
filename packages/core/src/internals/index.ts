/**
 * Barrel export for the acceleration internals.
 *
 * @remarks
 * Per `docs/architecture.md` §6. These classes are engine-internal — most consumers don't
 * touch them directly; they're orchestrated by `FilterEngine` based on `acceleration` config.
 * Exposed for advanced consumers + the worker-bridge + the benchmark suite.
 *
 * @packageDocumentation
 */

export {
	type AccelerationMode,
	AUTO_BITMAP_THRESHOLD,
	type SpatialIndexMode,
	TEXT_INDEX_AUTO_THRESHOLD,
	type TextIndexMode,
} from './accelerationModes.js';
export { BitmapIndex } from './BitmapIndex.js';
export { ExclusionGraph } from './ExclusionGraph.js';
export { SimulationCache } from './SimulationCache.js';
export { type GeoCoords as SpatialGeoCoords, SpatialIndex } from './SpatialIndex.js';
export { TextInvertedIndex } from './TextInvertedIndex.js';
export {
	initializeBitmapAcceleration,
	isBitmapAccelerationReady,
} from './roaringInit.js';

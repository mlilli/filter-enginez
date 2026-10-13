/**
 * `createAccelerationStack` — construct the engine's three composed acceleration objects
 * (bitmap index, exclusion graph, simulation cache) from the public `AccelerationOptions`.
 *
 * @remarks
 * Factored out of the `FilterEngine` constructor so the facade stays lean and the
 * public-vocabulary → internal-mode mapping lives in one place. The returned
 * `exclusionGraphMode` is surfaced back to the engine so it can re-warm the graph after
 * invalidations when the consumer opted into `'eager'`.
 *
 * @packageDocumentation
 */

import type { AccelerationOptions } from '../FilterEngineOptions.js';
import type { InternalStore } from '../store/InternalStore.js';
import type { AccelerationMode } from './accelerationModes.js';

import { BitmapIndex } from './BitmapIndex.js';
import { ExclusionGraph, type ExclusionGraphMode } from './ExclusionGraph.js';
import { SimulationCache } from './SimulationCache.js';

/**
 * The composed acceleration objects plus the resolved exclusion-graph mode.
 */
export interface AccelerationStack<T> {
	readonly bitmapIndex: BitmapIndex<T>;
	readonly exclusionGraph: ExclusionGraph<T>;
	readonly exclusionGraphMode: ExclusionGraphMode;
	readonly simulationCache: SimulationCache<T>;
}

/**
 * Build the acceleration stack for a store from the (already-defaulted-to-`{}`) options.
 */
export function createAccelerationStack<T>(
	store: InternalStore<T>,
	options: AccelerationOptions,
): AccelerationStack<T> {
	// Map the public `bitmap` vocabulary ('on'/'off'/'auto') onto BitmapIndex's internal
	// evaluator mode ('bitmap'/'predicate'/'auto').
	const bitmapMode: AccelerationMode
		= options.bitmap === 'on' ? 'bitmap'
			: options.bitmap === 'off' ? 'predicate'
				: 'auto';
	const exclusionGraphMode: ExclusionGraphMode = options.exclusionGraph ?? 'lazy';
	const bitmapIndex = new BitmapIndex<T>(
		store,
		bitmapMode,
		options.spatialIndex ?? 'auto',
		options.textIndex ?? 'auto',
	);
	const exclusionGraph = new ExclusionGraph<T>(store, bitmapIndex, exclusionGraphMode);
	const simulationCache = new SimulationCache<T>(store, {
		bitmapIndex,
		enabled: options.simulationCache ?? true,
		exclusionGraph,
	});

	return { bitmapIndex, exclusionGraph, exclusionGraphMode, simulationCache };
}

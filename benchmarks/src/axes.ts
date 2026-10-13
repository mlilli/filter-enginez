/**
 * The registered acceleration-stack axes the benchmark matrix can toggle. Each axis contributes
 * a fragment of `AccelerationOptions`; the matrix builder (`matrix.ts`) takes the cartesian
 * product over whichever axes a scenario declares applicable. New axes drop in here without
 * touching the runner.
 *
 * @packageDocumentation
 */
import type { AccelerationOptions } from '@filter-enginez/core';

/** Identifiers for the live acceleration axes. */
export type AxisId = 'bitmap' | 'exclusionGraph' | 'simulationCache' | 'spatialIndex' | 'textIndex';

/** One candidate setting for an axis — a labelled fragment of `AccelerationOptions`. */
export interface AxisSetting {
	/** Short label for the matrix cell, e.g. `bitmap:on`. */
	readonly label: string;
	/** The `AccelerationOptions` fragment this setting applies. */
	readonly value: AccelerationOptions;
}

/** A single toggleable axis plus the settings the matrix will sweep over. */
export interface Axis {
	readonly id: AxisId;
	readonly settings: readonly AxisSetting[];
}

/**
 * The axis registry. `exclusionGraph` sweeps `lazy` vs `off` (eager is query-identical to lazy,
 * so it adds no measurement value here); the rest sweep their on/off poles.
 */
export const AXES: Readonly<Record<AxisId, Axis>> = {
	bitmap: {
		id: 'bitmap',
		settings: [
			{ label: 'bitmap:on', value: { bitmap: 'on' }},
			{ label: 'bitmap:off', value: { bitmap: 'off' }},
		],
	},
	exclusionGraph: {
		id: 'exclusionGraph',
		settings: [
			{ label: 'exclGraph:lazy', value: { exclusionGraph: 'lazy' }},
			{ label: 'exclGraph:off', value: { exclusionGraph: 'off' }},
		],
	},
	simulationCache: {
		id: 'simulationCache',
		settings: [
			{ label: 'simCache:on', value: { simulationCache: true }},
			{ label: 'simCache:off', value: { simulationCache: false }},
		],
	},
	spatialIndex: {
		id: 'spatialIndex',
		settings: [
			{ label: 'rtree:auto', value: { spatialIndex: 'auto' }},
			{ label: 'rtree:off', value: { spatialIndex: 'off' }},
		],
	},
	textIndex: {
		id: 'textIndex',
		settings: [
			{ label: 'textIndex:auto', value: { textIndex: 'auto' }},
			{ label: 'textIndex:off', value: { textIndex: 'off' }},
		],
	},
};

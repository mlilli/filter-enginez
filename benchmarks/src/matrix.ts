/**
 * The generic matrix builder — the cartesian product over a scenario's applicable axes. Empty
 * `axisIds` yields a single default cell (the engine's built-in defaults). This is the piece
 * that lets the suite grow from 16 cells to 32 without rework: register an axis in `axes.ts`,
 * declare it applicable on a scenario, and the product picks it up.
 *
 * @packageDocumentation
 */
import type { AccelerationOptions } from '@filter-enginez/core';

import { AXES, type AxisId } from './axes.js';

/** One fully-specified matrix cell — an `AccelerationOptions` combo plus its composite label. */
export interface MatrixCell {
	readonly acceleration: AccelerationOptions;
	readonly label: string;
}

/** Build the cartesian product of the given axes' settings, in registration order. */
export function buildMatrix(axisIds: readonly AxisId[]): readonly MatrixCell[] {
	let cells: MatrixCell[] = [{ acceleration: {}, label: 'defaults' }];

	for (const axisId of axisIds) {
		const axis = AXES[axisId];
		const expanded: MatrixCell[] = [];

		for (const cell of cells) {
			for (const setting of axis.settings) {
				expanded.push({
					acceleration: { ...cell.acceleration, ...setting.value },
					label: cell.label === 'defaults' ? setting.label : `${cell.label} · ${setting.label}`,
				});
			}
		}
		cells = expanded;
	}

	return cells;
}

/**
 * The `Scenario` contract — one measurable engine operation, run across the acceleration axes it
 * declares applicable. Scenario modules live in `scenarios/` and register in `scenarios/index.ts`.
 *
 * @packageDocumentation
 */
import type { AccelerationOptions } from '@filter-enginez/core';

import type { AxisId } from './axes.js';
import type { CorpusTier } from './corpus.js';

/** One configured, ready-to-time cell — the engine + fixtures for a single matrix combo. */
export interface ScenarioCell {
	/** The operation to time. Must funnel its output through `consume` to defeat DCE. */
	readonly run: () => void;
	/** Optional cleanup after the bench run for this cell (e.g. `engine.destroy()`). */
	teardown?: () => Promise<void> | void;
}

/** A benchmark scenario — measured once per applicable-axis combo, per corpus tier. */
export interface Scenario {
	/** Acceleration axes whose settings are meaningful here — drives the per-scenario matrix. */
	readonly applicableAxes: readonly AxisId[];
	/** One-line description of what the scenario measures. */
	readonly description: string;
	/** Stable kebab-case identifier — the RESULTS.md section anchor + JSON key. */
	readonly id: string;
	/** When `true`, the runner skips this scenario and lists it as pending. */
	readonly pending?: boolean;
	/** Human-readable title for report headings. */
	readonly title: string;
	/** Build the engine + fixtures for one matrix cell. Only invoked for non-pending scenarios. */
	setup(tier: CorpusTier, acceleration: AccelerationOptions): Promise<ScenarioCell> | ScenarioCell;
}

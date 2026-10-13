/**
 * `createFilterEngine` — the canonical ergonomic factory for `FilterEngine` instances.
 *
 * @remarks
 * Per `docs/architecture.md` §2.2. The Factory Method pattern (GoF Creational) sits in front of
 * `new FilterEngine(options)` to give consumers a stable function-shaped entry point that can
 * be re-implemented in adapter packages without forcing them to subclass `FilterEngine`.
 *
 * **Why a separate factory.** Consumers writing test fixtures, mock engines, or DI containers
 * pass a `createEngine` function around as a first-class value. A class constructor isn't as
 * ergonomic to thread through that surface — a plain function is. The factory also gives the
 * reactive-surface adapters (`@filter-enginez/reactive-signals`, `@filter-enginez/reactive-rxjs`)
 * a clean point to wrap with their adapter-specific factory overloads.
 *
 * @example
 *   import { createFilterEngine, range, inSet } from '@filter-enginez/core';
 *
 *   const engine = createFilterEngine<Wine>({
 *     sourceData: wines,
 *     devtools: { enabled: true, reduxDevtoolsName: 'Wine Search' },
 *   });
 *   engine.addRule('price-range', range('price', { min: 10, max: 50 }));
 *   engine.addRule('varietal', inSet('varietal', ['Pinot Noir', 'Syrah']));
 *   console.log(engine.getResults());
 *
 * @packageDocumentation
 */

import { FilterEngine, type FilterEngineOptions } from './FilterEngine.js';

/**
 * Construct a new `FilterEngine` with the given options. Returns the constructed instance.
 *
 * @typeParam T - The item type the engine operates over
 * @param options - Construction-time options (source data, devtools, acceleration, JSON config).
 *   Similarity is NOT among them — it attaches separately via `attachSimilarity` from
 *   `@filter-enginez/core/similarity`, which is what keeps MinHash and LSH out of this import graph.
 * @returns A new, ready-to-use `FilterEngine<T>` instance
 */
export function createFilterEngine<T = unknown>(
	options: FilterEngineOptions<T> = {},
): FilterEngine<T> {
	return new FilterEngine<T>(options);
}

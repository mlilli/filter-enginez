/**
 * Dead-code-elimination guard. A benchmarked operation must funnel a cheap numeric summary of
 * its output through `consume`, so neither the JIT nor the bundler can elide the measured work
 * as unused. `readSink` is printed once at the end of a run so the accumulator stays observably
 * live across the whole suite.
 *
 * @packageDocumentation
 */

let blackhole = 0;

/** Fold a numeric summary of a benchmark result into the global sink. */
export function consume(value: number): void {
	blackhole = (blackhole + value) | 0;
}

/** Read the accumulated sink. Call once after all runs so `consume` can't be optimized away. */
export function readSink(): number {
	return blackhole;
}

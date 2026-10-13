/**
 * The tiered wine corpus the benchmark suite runs against: the 10k default tier always (generated
 * at module load, or a sample of the local real corpus when one has been imported), plus the
 * gitignored 130k full tier when it has been materialized. Sourced from
 * `@filter-enginez/mock-data/wine` so dev, tests, and benchmarks all filter the same data.
 *
 * @packageDocumentation
 */
import { loadFullWines, type Wine, wines } from '@filter-enginez/mock-data/wine';

/** A named corpus tier — the wine dataset at a given size. */
export interface CorpusTier {
	readonly data: readonly Wine[];
	readonly name: string;
}

/**
 * Resolve the available corpus tiers. The 10k default tier is always present (`mock-data`'s `wines`);
 * the 130k full tier appears only after `pnpm regen:wine:real` has written its gitignored JSON,
 * in which case it is appended. Callers iterate whatever tiers come back.
 *
 * @param requested - Optional tier-name allowlist (e.g. `['10k']`). When omitted, every available
 *   tier is returned. Filtering happens BEFORE the 130k JSON is read, so `['10k']` never pays the
 *   ~116MB `loadFullWines()` cost — which is what makes a fast, single-tier run (CI, a low-memory
 *   smoke) practical.
 */
export async function loadCorpusTiers(requested?: readonly string[]): Promise<readonly CorpusTier[]> {
	const wants = (name: string): boolean => requested === undefined || requested.includes(name);
	const tiers: CorpusTier[] = [];

	if (wants('10k')) {
		tiers.push({ data: wines, name: '10k' });
	}
	if (wants('130k')) {
		const full = await loadFullWines();

		if (full !== null) {
			tiers.push({ data: full, name: '130k' });
		}
	}

	return tiers;
}

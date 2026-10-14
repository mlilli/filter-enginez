/**
 * The tiered wine corpus the benchmark suite runs against: the 10k default tier (generated at module
 * load, or a sample of the local real corpus when one has been imported) and the full tier — the
 * 150k synthetic wines, or the ~130k-review real corpus where it has been imported locally. Sourced
 * from `@filter-enginez/mock-data/wine` so dev, tests, and benchmarks all filter the same data.
 *
 * @packageDocumentation
 */
import { loadFullWines, type Wine, wines } from '@filter-enginez/mock-data/wine';

/** A named corpus tier — the wine dataset at a given size. */
export interface CorpusTier {
	readonly data: readonly Wine[];
	readonly name: string;
}

/** Name of the default tier, and the `--tiers` value that selects it alone. */
const DEFAULT_TIER_NAME = '10k';

/**
 * A tier's report name: its size in thousands, so a report says which full tier it measured
 * (`150k` synthetic, `130k` real).
 *
 * @param data - The tier's records.
 * @returns The name, such as `150k`.
 */
function tierName(data: readonly Wine[]): string {
	return `${Math.round(data.length / 1000)}k`;
}

/**
 * Resolve the corpus tiers. The 10k default tier is `mock-data`'s `wines`; the full tier is
 * `loadFullWines()`.
 *
 * @param requested - Optional tier allowlist (e.g. `['10k']`). When omitted, both tiers are
 *   returned. Any name other than `10k` (`full`, `130k`, `150k`) selects the full tier. Filtering
 *   happens BEFORE the full tier is loaded, so `['10k']` never pays for generating 150k wines or
 *   parsing the ~116MB real corpus — which is what makes a fast, single-tier run (CI, a low-memory
 *   smoke) practical.
 * @returns The selected tiers, default tier first.
 */
export async function loadCorpusTiers(requested?: readonly string[]): Promise<readonly CorpusTier[]> {
	const tiers: CorpusTier[] = [];

	if (requested === undefined || requested.includes(DEFAULT_TIER_NAME)) {
		tiers.push({ data: wines, name: DEFAULT_TIER_NAME });
	}
	if (requested === undefined || requested.some((name) => name !== DEFAULT_TIER_NAME)) {
		const full = await loadFullWines();

		tiers.push({ data: full, name: tierName(full) });
	}

	return tiers;
}

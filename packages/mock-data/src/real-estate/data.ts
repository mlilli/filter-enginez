/**
 * Real-estate dataset — exported data array.
 *
 * @remarks
 * Synthetic: the 10,000-listing default tier is materialized at module load via `./generate.ts`.
 * The full tier (50k) is the same seeded generator run at a larger count by
 * `pnpm regen:mock-data --full`, written to a gitignored JSON file. Neither tier contains
 * third-party listing or address data.
 *
 * @packageDocumentation
 */

import type { Listing } from './types.js';

import { DEFAULT_TIER_SIZE } from '../tier-sizes.js';
import { generateListings } from './generate.js';

/**
 * The default-tier listing bootstrap dataset. Materialized deterministically via
 * `DEFAULT_TIER_SIZE` (currently 10,000) — same seed every run, same bytes every machine,
 * stable references in docs / tests / bug reports.
 */
export const listings: readonly Listing[] = generateListings(DEFAULT_TIER_SIZE);

/**
 * Lazy-load the full 50k+ corpus from gitignored JSON (generated via
 * `pnpm regen:mock-data --full`). Returns `null` when not present; the MSW handler factory
 * surfaces that as a structured 404 with a hint.
 */
export async function loadFullListings(): Promise<null | readonly Listing[]> {
	try {
		// Variable-path dynamic import — bypasses TypeScript's static JSON-resolution graph
		// (which would otherwise parse the multi-MB JSON at typecheck and OOM the compiler). The
		// inline `@vite-ignore` is load-bearing: without it Vite tries to bundle the multi-MB full
		// corpus into the app graph and OOMs the dev optimizer (the full tier is a runtime-only
		// resource, never bundled). The `*/data-full.json` ambient declaration provides the type.
		const path = './data-full.json';
		const mod = (await import(/* @vite-ignore */ path, { with: { type: 'json' }})) as {
			default: readonly Listing[];
		};

		return mod.default;
	} catch {
		return null;
	}
}

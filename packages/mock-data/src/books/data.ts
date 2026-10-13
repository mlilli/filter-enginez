/**
 * Books dataset — exported data array.
 *
 * @remarks
 * Synthetic: the 10,000-book default tier is materialized at module load via `./generate.ts`.
 * The full tier (100k) is the same seeded generator run at a larger count by
 * `pnpm regen:mock-data --full`, written to a gitignored JSON file. Neither tier contains
 * OpenLibrary records; the generator only mimics their shape (subject tags, ID format).
 *
 * @packageDocumentation
 */

import type { Book } from './types.js';

import { DEFAULT_TIER_SIZE } from '../tier-sizes.js';
import { generateBooks } from './generate.js';

/**
 * The default-tier book bootstrap dataset. Materialized deterministically via
 * `DEFAULT_TIER_SIZE` (currently 10,000) — stable across runs and machines.
 */
export const books: readonly Book[] = generateBooks(DEFAULT_TIER_SIZE);

/**
 * Lazy-load the full 100k corpus from gitignored JSON (generated via
 * `pnpm regen:mock-data --full`). Returns `null` when not present.
 */
export async function loadFullBooks(): Promise<null | readonly Book[]> {
	try {
		// Variable-path dynamic import — bypasses TypeScript's static JSON-resolution graph
		// (which would otherwise parse the multi-MB JSON at typecheck and OOM the compiler). The
		// inline `@vite-ignore` is load-bearing: without it Vite tries to bundle the multi-MB full
		// corpus into the app graph and OOMs the dev optimizer (the full tier is a runtime-only
		// resource, never bundled). The `*/data-full.json` ambient declaration provides the type.
		const path = './data-full.json';
		const mod = (await import(/* @vite-ignore */ path, { with: { type: 'json' }})) as {
			default: readonly Book[];
		};

		return mod.default;
	} catch {
		return null;
	}
}

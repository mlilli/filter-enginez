/**
 * Ambient declarations for the optional `data-full.json` files in each dataset directory.
 *
 * @remarks
 * The books and real-estate full-tier corpora (100k books, 50k listings) live in gitignored JSON files
 * that consumers generate on demand via `pnpm regen:mock-data --full`. The `loadFullX`
 * functions in each `data.ts` dynamically import these files — but TypeScript's static
 * resolver still wants to type-check the import path at compile time, so we declare a
 * module ambient for each potential path. The actual runtime resolves only when the JSON
 * file exists; otherwise the dynamic `import()` rejects and our `loadFullX` returns `null`.
 *
 * This mirrors the lz-string / estree ambient-declaration pattern used elsewhere in the
 * monorepo.
 */

declare module '*/data-full.json' {
	// Untyped contents — the consuming module casts to its expected `readonly T[]` shape.
	const data: unknown;

	export default data;
}

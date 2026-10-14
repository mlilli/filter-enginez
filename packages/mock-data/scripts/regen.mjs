#!/usr/bin/env node
/**
 * `regen.mjs` — CLI to (re)generate the mock datasets at default and full tiers.
 *
 * Default mode (`pnpm regen` / `pnpm regen:mock-data` from repo root):
 *   - Validates the bootstrap default-tier datasets (10k each) by running the procedural
 *     generators and reporting shape + uniqueness + distribution stats. Does NOT write
 *     anything — the default tier is materialized at module load via deterministic seeds,
 *     so there's no JSON to write. The validation surfaces drift early.
 *
 * Full mode (`pnpm regen:full` / `pnpm regen:mock-data --full`):
 *   - Generates the full-tier corpora (wine 150k, real-estate 50k, books 100k). Real estate and
 *     books are written to their gitignored `src/<dataset>/data-full.json` files; after this,
 *     their `loadFullX()` functions resolve to actual data instead of `null`, and their MSW
 *     handlers stop returning 404 on `?tier=full`.
 *   - Wine's full tier is generated on demand (`loadFullWines()`, or `generateWines` in a browser
 *     Web Worker), so nothing is written for it: the run validates it and reports how long the
 *     150k generation takes.
 *
 * The script runs against the built `dist/` output (after `pnpm build`) because Node can't
 * load the `.ts` source files directly under nodenext resolution. If `dist/` is missing or
 * stale, the script tells you to run `pnpm build` first rather than silently using old
 * artifacts.
 *
 * @packageDocumentation
 */

import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ─── Paths ───────────────────────────────────────────────────────────────
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(SCRIPT_DIR, '..');
const DIST_DIR = join(PACKAGE_ROOT, 'dist');
const SRC_DIR = join(PACKAGE_ROOT, 'src');

// ─── Argv ────────────────────────────────────────────────────────────────
const FULL_MODE = process.argv.includes('--full');

// ─── Pre-flight ──────────────────────────────────────────────────────────
async function ensureDistExists() {
	try {
		await stat(join(DIST_DIR, 'tier-sizes.js'));
	} catch {
		console.error('✗ dist/ output not found — run `pnpm build` (or `pnpm -r build`) first, then re-run this script.');
		process.exit(1);
	}
}

// ─── Generation ──────────────────────────────────────────────────────────
async function loadGenerators() {
	const wineModule = await import(pathToFileURL(join(DIST_DIR, 'wine/generate.js')).href);
	const reModule = await import(pathToFileURL(join(DIST_DIR, 'real-estate/generate.js')).href);
	const booksModule = await import(pathToFileURL(join(DIST_DIR, 'books/generate.js')).href);
	const tierModule = await import(pathToFileURL(join(DIST_DIR, 'tier-sizes.js')).href);

	return {
		DEFAULT_TIER_SIZE: tierModule.DEFAULT_TIER_SIZE,
		FULL_TIER_SIZES: tierModule.FULL_TIER_SIZES,
		generateBooks: booksModule.generateBooks,
		generateListings: reModule.generateListings,
		generateWines: wineModule.generateWines,
	};
}

/**
 * Validate a generator's output — shape, uniqueness, basic distribution health. Used in
 * default mode where we don't write anything but want to confirm the bootstrap dataset is
 * still healthy.
 */
function validate(name, records, expectedCount) {
	const t0 = performance.now();

	if (records.length !== expectedCount) {
		throw new Error(`${name}: expected ${expectedCount} records, got ${records.length}`);
	}
	const ids = new Set(records.map((r) => r.id));

	if (ids.size !== records.length) {
		throw new Error(`${name}: ${records.length - ids.size} duplicate ids`);
	}
	const ms = (performance.now() - t0).toFixed(1);

	console.log(`✓ ${name}: ${records.length.toLocaleString()} records, all ids unique [${ms}ms validate]`);
}

/**
 * Generate and write a full-tier corpus to its gitignored JSON file. Writes to BOTH `src/`
 * and `dist/` paths — bundlers (Vite/Webpack) read from `src/` per the package.json exports
 * map, while direct Node consumers loading the compiled `dist/` modules expect the JSON
 * co-located with the JS module. Both copies are gitignored. Returns the time taken so
 * the script can report a perf summary at the end.
 */
async function writeFullTier(name, records, datasetDir) {
	const t0 = performance.now();
	// JSON.stringify with no indent — this file is huge (tens of MB for the largest tier)
	// and gitignored, so readability isn't a concern; we want the smallest bytes-on-disk.
	const payload = JSON.stringify(records);
	const srcPath = join(SRC_DIR, datasetDir, 'data-full.json');
	const distPath = join(DIST_DIR, datasetDir, 'data-full.json');

	await mkdir(dirname(srcPath), { recursive: true });
	await mkdir(dirname(distPath), { recursive: true });
	await Promise.all([
		writeFile(srcPath, payload, 'utf8'),
		writeFile(distPath, payload, 'utf8'),
	]);
	const ms = (performance.now() - t0).toFixed(0);
	const mb = (payload.length / (1024 * 1024)).toFixed(2);

	console.log(`✓ ${name}: ${records.length.toLocaleString()} records → src/ + dist/ [${mb}MB each, ${ms}ms write]`);
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
	console.log(FULL_MODE ? 'Mode: --full (generating full-tier corpora)\n' : 'Mode: default (validating bootstrap datasets)\n');
	await ensureDistExists();
	const g = await loadGenerators();

	if (!FULL_MODE) {
		// Default mode: regenerate at DEFAULT_TIER_SIZE and validate. Don't write — the
		// default tier is materialized at module load via deterministic seeds.
		const t0 = performance.now();
		const wines = g.generateWines(g.DEFAULT_TIER_SIZE);
		const listings = g.generateListings(g.DEFAULT_TIER_SIZE);
		const books = g.generateBooks(g.DEFAULT_TIER_SIZE);
		const totalMs = (performance.now() - t0).toFixed(0);

		console.log(`Total generation time: ${totalMs}ms for ${(3 * g.DEFAULT_TIER_SIZE).toLocaleString()} records\n`);
		validate('wines', wines, g.DEFAULT_TIER_SIZE);
		validate('listings', listings, g.DEFAULT_TIER_SIZE);
		validate('books', books, g.DEFAULT_TIER_SIZE);
		console.log('\nDefault-tier datasets are healthy. No files written (default tier is generated at module load).');
		console.log('To materialize the FULL tier (real-estate 50k, books 100k; wine 150k is generated on demand), re-run with --full.');

		return;
	}

	// Full mode: generate per-dataset full-tier sizes and write to gitignored JSON.
	const t0 = performance.now();
	const fullWines = g.generateWines(g.FULL_TIER_SIZES.wine, undefined, 'full');
	const tWines = performance.now() - t0;

	console.log(`✓ wines generation: ${g.FULL_TIER_SIZES.wine.toLocaleString()} records [${tWines.toFixed(0)}ms]`);
	validate('wines', fullWines, g.FULL_TIER_SIZES.wine);

	const t1 = performance.now();
	const fullListings = g.generateListings(g.FULL_TIER_SIZES['real-estate'], undefined, 'full');
	const tListings = performance.now() - t1;

	console.log(`✓ listings generation: ${g.FULL_TIER_SIZES['real-estate'].toLocaleString()} records [${tListings.toFixed(0)}ms]`);

	const t2 = performance.now();
	const fullBooks = g.generateBooks(g.FULL_TIER_SIZES.books, undefined, 'full');
	const tBooks = performance.now() - t2;

	console.log(`✓ books generation: ${g.FULL_TIER_SIZES.books.toLocaleString()} records [${tBooks.toFixed(0)}ms]`);

	console.log('\nWriting full-tier JSON files (gitignored; wine is generated on demand and needs none)...');
	await writeFullTier('listings', fullListings, 'real-estate');
	await writeFullTier('books', fullBooks, 'books');

	const totalMs = (performance.now() - t0).toFixed(0);
	const totalRecords = g.FULL_TIER_SIZES.wine + g.FULL_TIER_SIZES['real-estate'] + g.FULL_TIER_SIZES.books;

	console.log(`\nFull-tier materialization complete: ${totalRecords.toLocaleString()} records in ${totalMs}ms.`);
	console.log('The books and real-estate `loadFullX()` functions will now resolve to data; their MSW handlers will serve `?tier=full` requests.');
}

main().catch((err) => {
	console.error('\n✗ regen.mjs failed:', err.message);
	console.error(err.stack);
	process.exit(1);
});

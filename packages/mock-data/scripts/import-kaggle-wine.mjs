#!/usr/bin/env node
/**
 * `import-kaggle-wine.mjs` — CLI that fetches the real Kaggle Wine Reviews CSV
 * (winemag-data-130k-v2.csv, ~50MB, ~130k rows) from the TidyTuesday raw GitHub mirror,
 * transforms each row into the Filter EngineZ `Wine` shape, and emits two JSON files:
 *
 *   - `src/wine/data-real-default.json` — stratified 10k sample (gitignored)
 *   - `src/wine/data-real-full.json` — full ~130k corpus (gitignored)
 *
 * Both are also mirrored to `dist/wine/` so direct Node consumers (smoke tests, downstream
 * apps loading the built artifacts) find the files where the compiled `data.js` looks.
 *
 * **CSV caching.** The raw CSV is cached at `scripts/_cache/winemag-data-130k-v2.csv`
 * (gitignored) so repeated runs don't re-download. Delete the cache file to force re-fetch.
 *
 * **Source provenance.** The TidyTuesday repo mirrors the Kaggle "Wine Reviews" dataset by
 * zackthoutt (Kaggle user `zynicide`), scraped from WineEnthusiast (winemag.com) in 2017:
 *   https://www.kaggle.com/datasets/zynicide/wine-reviews
 * TidyTuesday raw URL (what we fetch):
 *   https://raw.githubusercontent.com/rfordatascience/tidytuesday/master/data/2019/2019-05-28/winemag-data-130k-v2.csv
 *
 * 🔴 **The data is NOT open in the way the code is, so it stays on the machine that ran this.**
 * Kaggle lists the dataset under CC BY-NC-SA 4.0 — attribution required, non-commercial use only,
 * and any adaptation (the JSON this script writes is one) under the same license. The review text
 * and taster names are WineEnthusiast's content on top of that. The rest of the project is
 * Apache-2.0 and may be used commercially, so the two must never mix in anything distributed:
 *
 *   - every output path is gitignored, so it cannot be committed;
 *   - `@filter-enginez/mock-data`'s `files` allow-list ships compiled `.js` and `.d.ts` only,
 *     and `scripts/pack-engine-tarballs.sh` fails if a `data-real-*` file reaches a tarball;
 *   - the example apps strip linked corpus files from every production build;
 *   - nothing in CI downloads it, so CI and any hosted demo run on the synthetic generators.
 *
 * Because the license is the user's to accept, the script refuses to download anything until it
 * is run with `--accept-data-license` (or `FILTER_ENGINEZ_ACCEPT_DATA_LICENSE=1`), and prints the
 * terms either way.
 *
 * @packageDocumentation
 */

import { mkdirSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import {
	BODY_WEIGHTS_BY_COLOR,
	COLOR_BY_VARIETY,
	SWEETNESS_WEIGHTS_BY_COLOR,
	TASTING_NOTE_VOCAB,
} from './_wine-lookups.mjs';

// ─── Paths ───────────────────────────────────────────────────────────────
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(SCRIPT_DIR, '..');
const SRC_WINE_DIR = join(PACKAGE_ROOT, 'src/wine');
const DIST_WINE_DIR = join(PACKAGE_ROOT, 'dist/wine');
const CACHE_DIR = join(SCRIPT_DIR, '_cache');
const CACHE_PATH = join(CACHE_DIR, 'winemag-data-130k-v2.csv');

const SOURCE_URL = 'https://raw.githubusercontent.com/rfordatascience/tidytuesday/master/data/2019/2019-05-28/winemag-data-130k-v2.csv';

// ─── Output sizing ───────────────────────────────────────────────────────
const DEFAULT_TIER_SIZE = 10_000;

// ─── Tiny deterministic PRNG (mulberry32) for body/sweetness/ABV synthesis ─
// We don't want random shifts every script run — synthesized fields stay stable across runs
// so the default-tier JSON has stable bytes across regenerations.

function mulberry32(seed) {
	let state = seed >>> 0;

	return function next() {
		state = (state + 0x6D2B79F5) >>> 0;
		let t = state;

		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function pickWeighted(rng, weightedItems) {
	let total = 0;

	for (const [, w] of weightedItems) {
		total += Math.max(0, w);
	}
	if (total === 0) {
		return weightedItems[0][0];
	}
	let target = rng() * total;

	for (const [item, w] of weightedItems) {
		target -= Math.max(0, w);
		if (target <= 0) {
			return item;
		}
	}

	return weightedItems[weightedItems.length - 1][0];
}

function randomFloat(rng, min, max) {
	return rng() * (max - min) + min;
}

function slugify(input) {
	return input
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

// ─── CSV parser — handles quoted fields with embedded commas + escaped quotes ──

/**
 * Parse a CSV string into an array of row arrays. Handles RFC 4180 quoting:
 * fields with commas / newlines must be wrapped in double quotes; embedded double quotes
 * are escaped by doubling (`""`). No streaming — loads the whole CSV into memory, which is
 * fine for our 50MB target.
 */
function parseCsv(csv) {
	const rows = [];
	let row = [];
	let field = '';
	let i = 0;
	let inQuotes = false;

	while (i < csv.length) {
		const ch = csv[i];

		if (inQuotes) {
			if (ch === '"') {
				if (csv[i + 1] === '"') {
					// Escaped quote inside a quoted field.
					field += '"';
					i += 2;
					continue;
				}
				inQuotes = false;
				i += 1;
				continue;
			}
			field += ch;
			i += 1;
			continue;
		}
		if (ch === '"') {
			inQuotes = true;
			i += 1;
			continue;
		}
		if (ch === ',') {
			row.push(field);
			field = '';
			i += 1;
			continue;
		}
		if (ch === '\n' || ch === '\r') {
			// End of row. Handle both \n and \r\n.
			row.push(field);
			field = '';
			rows.push(row);
			row = [];
			if (ch === '\r' && csv[i + 1] === '\n') {
				i += 2;
			} else {
				i += 1;
			}
			continue;
		}
		field += ch;
		i += 1;
	}
	// Flush the final field/row if no trailing newline.
	if (field.length > 0 || row.length > 0) {
		row.push(field);
		rows.push(row);
	}

	return rows;
}

// ─── Row → Wine transformer ───────────────────────────────────────────────

/**
 * Extract a 4-digit year (1900-2029) from a wine title string. Real Wine Enthusiast titles
 * typically embed the vintage like "Nicosia 2013 Vulkà Bianco (Etna)" — we grab the year if
 * present, else return null (will fall back to a synthesized default).
 */
function extractVintageFromTitle(title) {
	if (!title) {
		return null;
	}
	const match = title.match(/\b(19\d{2}|20[0-2]\d)\b/);

	return match ? Number.parseInt(match[1], 10) : null;
}

/**
 * Resolve a wine variety (which may be a blend like "Cabernet Sauvignon-Merlot") to a color.
 * Tries the exact name first, then the first half of a hyphenated blend, then defaults to
 * 'red' (matches the Kaggle dataset's red-dominant distribution).
 */
function colorFromVariety(variety, region1) {
	// Region-specific override: Champagne → sparkling regardless of variety.
	if (region1 && region1.toLowerCase().includes('champagne')) {
		return 'sparkling';
	}
	if (!variety) {
		return 'red';
	}
	const exact = COLOR_BY_VARIETY[variety];

	if (exact) {
		return exact;
	}
	// Try the first variety in a hyphenated blend.
	const firstPart = variety.split(/[-,/]/)[0]?.trim();

	if (firstPart && COLOR_BY_VARIETY[firstPart]) {
		return COLOR_BY_VARIETY[firstPart];
	}

	return 'red';
}

/**
 * Extract tasting-note keywords from the real description prose by simple case-insensitive
 * substring match against `TASTING_NOTE_VOCAB`. Returns deduplicated up to 6 notes.
 */
function extractTastingNotes(description) {
	if (!description) {
		return [];
	}
	const lower = description.toLowerCase();
	const found = new Set();

	for (const note of TASTING_NOTE_VOCAB) {
		if (found.size >= 6) {
			break;
		}
		if (lower.includes(note)) {
			found.add(note);
		}
	}

	return [...found];
}

/**
 * Transform one parsed Kaggle CSV row into a `Wine` record.
 *
 * @param row - The CSV row as `[index, country, description, designation, points, price,
 *   province, region_1, region_2, taster_name, taster_twitter_handle, title, variety, winery]`
 * @param index - The output array index (used to derive a stable id + to seed synthesized
 *   per-row fields like ABV/body/sweetness deterministically)
 * @param tier - The tier marker to stamp into the record
 * @returns A `Wine` object, or `null` if the row is too sparse to be useful
 */
function transformRow(row, index, tier) {
	const [
		, country,
		description,
		designation,
		pointsRaw,
		priceRaw,
		province,
		region1,
		region2, , , title,
		variety,
		winery,
	] = row;

	// Skip rows with no country (can't filter / cluster meaningfully) or no variety.
	if (!country || !variety) {
		return null;
	}

	const points = Number.parseInt(pointsRaw, 10);

	if (!Number.isFinite(points)) {
		return null;
	}

	// Price may be empty (Kaggle has many missing prices). Synthesize from points if missing
	// — higher points → higher implied price, roughly $1 per point above 80 with noise.
	const seed = index + 1; // avoid seed=0
	const rng = mulberry32(seed);
	let priceUsd = Number.parseFloat(priceRaw);

	if (!Number.isFinite(priceUsd)) {
		// Synthesize: price ~= e^((points - 80) * 0.12) * 8, capped reasonably.
		priceUsd = Math.round(Math.exp((points - 80) * 0.12) * 8 * randomFloat(rng, 0.7, 1.3) * 100) / 100;
	}

	// No year in the title (an NV wine): the year after the corpus's youngest vintage, 2017, the
	// same rule the synthetic generator's NON_VINTAGE_YEAR follows.
	const vintage = extractVintageFromTitle(title) ?? 2018;
	const color = colorFromVariety(variety, region1);
	const body = pickWeighted(rng, BODY_WEIGHTS_BY_COLOR[color]);
	const sweetness = pickWeighted(rng, SWEETNESS_WEIGHTS_BY_COLOR[color]);
	// Synthesize ABV — typical 11-15% for non-fortified, 15-22% for fortified.
	const abvMax = color === 'fortified' ? 22 : 15.5;
	const abv = Math.round(randomFloat(rng, 11.0, abvMax) * 10) / 10;

	const tastingNotes = extractTastingNotes(description);

	// Build originId from non-empty levels.
	const originLevels = [country, province, region1, region2].filter((s) => s && s.length > 0);
	const originId = originLevels.join('|');

	// Stable id from title slug + index (slug alone collides for many wines).
	const id = `${slugify(title || `wine-${index}`)}-${index}`;

	// Synthetic timestamp — single fixed reference date so the JSON has stable bytes.
	const lastUpdated = new Date('2024-01-01T00:00:00Z').toISOString();

	return {
		abv,
		body,
		color,
		description: description || '',
		designation: designation || '',
		id,
		labelImage: `https://placehold.co/240x360/0b1220/22d3ee?text=${encodeURIComponent(variety)}`,
		lastUpdated,
		name: title || `Untitled ${index}`,
		origin: {
			country,
			province: province || '',
			region: region1 || '',
			subregion: region2 || '',
		},
		originId,
		points,
		priceUsd,
		sweetness,
		tastingNotes,
		tier,
		varietal: variety,
		vintage,
		winery: winery || 'Unknown',
	};
}

// ─── Stratification — pick 10k records evenly across the 130k ────────────

function stratify(wines, targetSize) {
	if (wines.length <= targetSize) {
		return wines;
	}
	const step = wines.length / targetSize;
	const result = [];

	for (let i = 0; i < targetSize; i++) {
		result.push(wines[Math.floor(i * step)]);
	}

	// Restamp tier + reindex ids so the default-tier records show tier='default' even
	// though they were transformed initially as 'full'.
	return result.map((w, i) => ({ ...w, id: `${slugify(w.name || `wine-${i}`)}-${i}`, tier: 'default' }));
}

// ─── Fetch with on-disk cache ────────────────────────────────────────────

async function fetchCsv() {
	try {
		const stats = await stat(CACHE_PATH);

		console.log(`✓ Using cached CSV: ${CACHE_PATH.replace(PACKAGE_ROOT, '.')} (${(stats.size / (1024 * 1024)).toFixed(1)}MB)`);

		return await readFile(CACHE_PATH, 'utf8');
	} catch {
		// Not cached — fetch.
	}
	console.log(`→ Fetching ${SOURCE_URL}`);
	const t0 = performance.now();
	const res = await fetch(SOURCE_URL);

	if (!res.ok) {
		throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
	}
	const text = await res.text();

	console.log(`✓ Fetched ${(text.length / (1024 * 1024)).toFixed(1)}MB in ${(performance.now() - t0).toFixed(0)}ms`);
	mkdirSync(CACHE_DIR, { recursive: true });
	await writeFile(CACHE_PATH, text, 'utf8');
	console.log(`✓ Cached to ${CACHE_PATH.replace(PACKAGE_ROOT, '.')}`);

	return text;
}

// ─── Main ────────────────────────────────────────────────────────────────

// ─── License acknowledgement ─────────────────────────────────────────────
const LICENSE_NOTICE = `Wine Reviews dataset — zackthoutt on Kaggle (zynicide/wine-reviews), scraped from WineEnthusiast.
  License: CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/)
    • attribution required  • NON-COMMERCIAL use only  • adaptations under the same license
  Review text and taster names are WineEnthusiast's content.
  The files this writes are for local development on this machine. They are gitignored, never
  packaged and stripped from production builds — do not commit, publish or deploy them.`;

/**
 * Whether the person running the script has accepted the dataset's license.
 *
 * @returns `true` when `--accept-data-license` was passed or `FILTER_ENGINEZ_ACCEPT_DATA_LICENSE=1` is set.
 */
function hasAcceptedDataLicense() {
	return process.argv.includes('--accept-data-license') || process.env.FILTER_ENGINEZ_ACCEPT_DATA_LICENSE === '1';
}

async function main() {
	console.log('Filter EngineZ · Kaggle Wine Reviews import\n');
	console.log(`${LICENSE_NOTICE}\n`);

	// 🔴 Before ANY network or cache access: nothing is fetched or read until the terms are accepted.
	if (!hasAcceptedDataLicense()) {
		console.error('✗ Not downloading: re-run with --accept-data-license to accept the terms above.');
		console.error('  (pnpm regen:wine:real --accept-data-license)');
		process.exitCode = 1;

		return;
	}

	const csv = await fetchCsv();
	const t0 = performance.now();
	const rows = parseCsv(csv);

	console.log(`✓ Parsed ${rows.length.toLocaleString()} CSV rows in ${(performance.now() - t0).toFixed(0)}ms`);

	// Drop the header row.
	const header = rows[0];
	const dataRows = rows.slice(1);

	console.log(`  Header: ${header.join(' | ')}`);

	// Transform each row to Wine, skipping invalid ones.
	const t1 = performance.now();
	const allWines = [];

	for (let i = 0; i < dataRows.length; i++) {
		const wine = transformRow(dataRows[i], i, 'full');

		if (wine) {
			allWines.push(wine);
		}
	}
	console.log(`✓ Transformed ${allWines.length.toLocaleString()} valid wines (dropped ${(dataRows.length - allWines.length).toLocaleString()} sparse rows) in ${(performance.now() - t1).toFixed(0)}ms`);

	// Stratify the default tier.
	const defaultWines = stratify(allWines, DEFAULT_TIER_SIZE);

	console.log(`✓ Stratified default tier: ${defaultWines.length.toLocaleString()} wines`);

	// Write outputs to both src/ (for bundlers) and dist/ (for direct Node consumers).
	mkdirSync(SRC_WINE_DIR, { recursive: true });
	mkdirSync(DIST_WINE_DIR, { recursive: true });

	const defaultJson = JSON.stringify(defaultWines);
	const fullJson = JSON.stringify(allWines);

	// NDJSON variant of the full corpus — one wine per line. Lets browser-side consumers
	// stream-parse the file line-by-line via `response.body.getReader()`, reporting an
	// accurate running count of bottles loaded as they parse. With JSON-array-of-objects
	// you can't reliably know "we're 47k bottles in" until the full parse completes;
	// NDJSON gives you that for free at the cost of trivial framing overhead.
	const fullNdjson = `${allWines.map((w) => JSON.stringify(w)).join('\n')}\n`;

	await Promise.all([
		writeFile(join(SRC_WINE_DIR, 'data-real-default.json'), defaultJson, 'utf8'),
		writeFile(join(DIST_WINE_DIR, 'data-real-default.json'), defaultJson, 'utf8'),
		writeFile(join(SRC_WINE_DIR, 'data-real-full.json'), fullJson, 'utf8'),
		writeFile(join(DIST_WINE_DIR, 'data-real-full.json'), fullJson, 'utf8'),
		writeFile(join(SRC_WINE_DIR, 'data-real-full.ndjson'), fullNdjson, 'utf8'),
		writeFile(join(DIST_WINE_DIR, 'data-real-full.ndjson'), fullNdjson, 'utf8'),
	]);

	console.log(`\n✓ Wrote data-real-default.json (${(defaultJson.length / (1024 * 1024)).toFixed(2)}MB) — gitignored`);
	console.log(`✓ Wrote data-real-full.json (${(fullJson.length / (1024 * 1024)).toFixed(2)}MB) — gitignored`);
	console.log(`✓ Wrote data-real-full.ndjson (${(fullNdjson.length / (1024 * 1024)).toFixed(2)}MB) — gitignored, for streaming consumers`);
	console.log(`\nDone. Restart any running dev server to pick up the new data.`);
}

main().catch((err) => {
	console.error('\n✗ import-kaggle-wine.mjs failed:', err.message);
	console.error(err.stack);
	process.exit(1);
});

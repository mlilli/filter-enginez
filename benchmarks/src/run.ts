/**
 * The benchmark runner. For every non-pending scenario, over every available corpus tier, it
 * builds the scenario's applicable-axis matrix, times each cell with tinybench, and collects the
 * outcomes. `--write` persists `RESULTS.md` + `results.json`; otherwise the report prints to
 * stdout. `initializeBitmapAcceleration()` is awaited once up front so the Roaring-Bitmap path is
 * ready before any `computeResults` call (it constructs `RoaringBitmap32` eagerly).
 *
 * **Flags** (all optional; the committed report is a full default run):
 *   - `--write` — persist `RESULTS.md` + `results.json` (else print to stdout).
 *   - `--tiers=10k[,full]` — restrict to corpus tiers. `--tiers=10k` skips loading the full tier
 *     entirely (see `corpus.ts`), which is what makes a CI / low-memory smoke fast + safe.
 *   - `--scenarios=<id>[,<id>]` — restrict to scenario ids (kebab-case, e.g. `filter-intersection`).
 *   - `--time=<ms>` / `--warmup=<ms>` — override the per-cell sampling + warmup budgets.
 *   - `--iterations=<n>` — override the minimum sampled iterations per cell (default 64; the warmup
 *     runs at most 16). A cell runs until both its time budget and this count are met, so a smoke
 *     run that only needs every cell to produce a number pairs a tiny `--time` with a small count.
 *
 * **A run with an unmeasured cell fails.** Every cell runs with tinybench's `throws`, so a cell whose
 * function throws stops the run with that error; and a cell that still ends with no samples or a
 * non-finite mean (see `unmeasuredCells`) sets a non-zero exit code and nothing is written.
 *
 * **Run it through the package scripts** (`pnpm bench`, `pnpm bench:write`), which start `tsx` with
 * `tsconfig.runtime.json`. `tsx` honors a tsconfig's `paths` at runtime, and the shared base config
 * maps `rbush` to core's type-only stub (`packages/core/src/types/rbush.d.ts`); under that mapping
 * the R-tree cells load the stub instead of the package and throw. The runtime config clears it.
 *
 * @packageDocumentation
 */
import { initializeBitmapAcceleration } from '@filter-enginez/core';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bench } from 'tinybench';

import { loadCorpusTiers } from './corpus.js';
import { buildMatrix } from './matrix.js';
import { outcomeFromTask, renderJson, renderMarkdown, type ScenarioReport, unmeasuredCells } from './report.js';
import { scenarios } from './scenarios/index.js';
import { readSink } from './sink.js';

/** tinybench sampling budget per cell — enough for a stable mean without dragging the suite. */
const DEFAULT_TIME_MS = 1000;
const DEFAULT_WARMUP_MS = 150;

/** tinybench's own minimum sampled iterations per cell, stated here so `--iterations` can lower it. */
const DEFAULT_MIN_ITERATIONS = 64;

/** tinybench's own warmup iteration count — the most warmup iterations a cell runs. */
const MAX_WARMUP_ITERATIONS = 16;

/** Write a line to stdout — progress + report output land here (keeps `no-console` happy). */
function log(line: string): void {
	process.stdout.write(`${line}\n`);
}

/** Read a `--key=value` flag's value from argv, or `undefined` when the flag is absent. */
function flagValue(name: string): string | undefined {
	const prefix = `--${name}=`;
	const hit = process.argv.find((arg) => arg.startsWith(prefix));

	return hit === undefined ? undefined : hit.slice(prefix.length);
}

/** Parse a positive-number flag, falling back to `fallback` when absent or non-finite. */
function numberFlag(name: string, fallback: number): number {
	const raw = flagValue(name);
	const parsed = raw === undefined ? Number.NaN : Number.parseFloat(raw);

	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Parse a comma-separated allowlist flag into a trimmed array, or `undefined` when absent. */
function listFlag(name: string): string[] | undefined {
	const raw = flagValue(name);

	return raw === undefined ? undefined : raw.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '');
}

async function main(): Promise<void> {
	const shouldWrite = process.argv.includes('--write');
	const timeMs = numberFlag('time', DEFAULT_TIME_MS);
	const warmupMs = numberFlag('warmup', DEFAULT_WARMUP_MS);
	const iterations = Math.ceil(numberFlag('iterations', DEFAULT_MIN_ITERATIONS));
	const tierFilter = listFlag('tiers');
	const scenarioFilter = listFlag('scenarios');

	await initializeBitmapAcceleration();
	const tiers = await loadCorpusTiers(tierFilter);
	const reports: ScenarioReport[] = [];

	for (const scenario of scenarios) {
		if (scenario.pending === true) {
			log(`[skip] ${scenario.id} — pending`);
			continue;
		}
		if (scenarioFilter !== undefined && !scenarioFilter.includes(scenario.id)) {
			continue;
		}

		for (const tier of tiers) {
			const cells = buildMatrix(scenario.applicableAxes);
			const bench = new Bench({
				iterations,
				throws: true,
				time: timeMs,
				warmupIterations: Math.min(iterations, MAX_WARMUP_ITERATIONS),
				warmupTime: warmupMs,
			});
			const teardowns: (() => Promise<void> | void)[] = [];

			for (const cell of cells) {
				const scenarioCell = await scenario.setup(tier, cell.acceleration);

				if (scenarioCell.teardown !== undefined) {
					teardowns.push(scenarioCell.teardown);
				}
				bench.add(cell.label, scenarioCell.run);
			}

			log(`[run]  ${scenario.id} @ ${tier.name} (${cells.length} cells)`);
			await bench.run();

			reports.push({
				outcomes: bench.tasks.map((task) => outcomeFromTask(task.name, task)),
				scenarioId: scenario.id,
				scenarioTitle: scenario.title,
				tierName: tier.name,
			});

			for (const teardown of teardowns) {
				await teardown();
			}
		}
	}

	const unmeasured = unmeasuredCells(reports);

	if (unmeasured.length > 0) {
		process.stderr.write(`[fail] ${unmeasured.length} cell(s) produced no measurement; nothing written:\n`);
		for (const cell of unmeasured) {
			process.stderr.write(`  ${cell}\n`);
		}
		process.exitCode = 1;

		return;
	}

	const markdown = renderMarkdown(reports);

	if (shouldWrite) {
		const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

		writeFileSync(path.join(dir, 'RESULTS.md'), markdown, 'utf8');
		writeFileSync(path.join(dir, 'results.json'), renderJson(reports), 'utf8');
		log('[write] RESULTS.md + results.json');
	} else {
		log(`\n${markdown}`);
	}
	log(`(sink=${readSink()})`);
}

await main();

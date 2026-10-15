/**
 * Every `tsx` script runs with a tsconfig that maps no import to a declaration file, and the
 * benchmark harness, started the way its scripts start it, measures every cell.
 *
 * @remarks
 * ## The failure this pins
 *
 * `tsconfig.base.json` maps `rbush` to `packages/core/src/types/rbush.d.ts`, core's type-only stub
 * for the untyped `rbush` package. For `tsc` that is a type mapping and nothing more. `tsx` reads the
 * same `paths` at RUNTIME, so a `tsx` process started under the base config (or any config extending
 * it, such as `benchmarks/tsconfig.json`) imports the stub file in place of the package: core's
 * `SpatialIndex` gets a module with no `RBush` class, and the first R-tree build throws
 * `tree.load is not a function`. tinybench catches a throwing cell and records no samples, so the
 * benchmark report printed `NaN ms` over 0 samples for `geo-radius-query`'s `rtree:auto` cell on
 * every tier, with every other cell measured and the run exiting 0.
 *
 * The harness now runs with `benchmarks/tsconfig.runtime.json`, which clears `paths`, and refuses to
 * write a report with an unmeasured cell. Three checks keep it that way, each catching what the
 * others cannot:
 *
 * - **Every `tsx` script, found by scanning every `package.json`,** passes `--tsconfig` and the
 *   config it names maps nothing to a `.d.ts`. A new `tsx` entry point is covered the day its script
 *   is added.
 * - **A control** proves the mapping detector sees the mapping that broke the harness, so the check
 *   above cannot pass by detecting nothing.
 * - **The harness itself runs**, at a one-iteration budget over the 10k tier, with the exact command
 *   line of the `bench` script: every cell it announces must appear in the report with a finite mean
 *   and at least one sample.
 *
 * @packageDocumentation
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT, walkRepoFiles } from './support/repoFiles.js';

/** One `package.json` script that starts `tsx`. */
interface TsxScript {
	/** The script's command line. */
	readonly command: string;
	/** The manifest's path, relative to the repo root. */
	readonly manifest: string;
	/** The script's name. */
	readonly name: string;
}

/** The benchmark package, whose `bench` script the behavioral check runs. */
const BENCHMARKS_DIR = resolve(REPO_ROOT, 'benchmarks');

/**
 * Flags appended to the `bench` command line for the behavioral check: the 10k tier only (the full
 * tier would generate 150k wines), and one sampled iteration per cell after a one-iteration warmup.
 * Enough for every cell to produce a number, which is all this check asks of it.
 */
const SMOKE_FLAGS: readonly string[] = ['--tiers=10k', '--time=1', '--warmup=1', '--iterations=1'];

/**
 * Budget for the behavioral check: the one-iteration run of every scenario takes about 11 s on a
 * container, most of it the 5000-action replay, and a parallel tooling run competes for the CPU.
 */
const HARNESS_TIMEOUT_MS = 120_000;

/**
 * Split a script command line into whitespace-separated tokens.
 *
 * @param command - A `package.json` script.
 * @returns Its tokens.
 */
function tokens(command: string): readonly string[] {
	return command.trim().split(/\s+/u);
}

/**
 * Every script, in every `package.json` of the repository, that starts `tsx`.
 *
 * @returns The scripts, in walk order.
 */
function findTsxScripts(): readonly TsxScript[] {
	return walkRepoFiles()
		.filter((path) => basename(path) === 'package.json')
		.flatMap((manifest) => {
			const { scripts } = JSON.parse(readFileSync(resolve(REPO_ROOT, manifest), 'utf8')) as {
				readonly scripts?: Readonly<Record<string, string>>;
			};

			return Object.entries(scripts ?? {})
				.filter(([, command]) => tokens(command).includes('tsx'))
				.map(([name, command]) => ({ command, manifest, name }));
		});
}

/**
 * The tsconfig path a `tsx` command line passes, as `--tsconfig <path>` or `--tsconfig=<path>`.
 *
 * @param command - A script that starts `tsx`.
 * @returns The path as written, or `undefined` when the command passes none.
 */
function tsconfigArgument(command: string): string | undefined {
	const parts = tokens(command);
	const separate = parts.indexOf('--tsconfig');

	if (separate !== -1) {
		return parts[separate + 1];
	}

	return parts.find((part) => part.startsWith('--tsconfig='))?.slice('--tsconfig='.length);
}

/**
 * Every `paths` entry of a tsconfig, `extends` chain resolved, whose target is a declaration file.
 *
 * @param configPath - Absolute path of the tsconfig.
 * @returns `<specifier> → <target>` for each such mapping; empty when there is none.
 */
function declarationFileMappings(configPath: string): readonly string[] {
	const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
		...ts.sys,
		onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
			throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
		},
	});

	return Object.entries(parsed?.options.paths ?? {}).flatMap(([specifier, targets]) =>
		targets.filter((target) => /\.d\.[cm]?ts$/u.test(target)).map((target) => `${specifier} → ${target}`));
}

const TSX_SCRIPTS = findTsxScripts();

describe('tsx runtime configs', () => {
	it('finds the tsx scripts it guards, the benchmark scripts among them', () => {
		expect(TSX_SCRIPTS.map((script) => `${script.manifest}#${script.name}`)).toEqual(
			expect.arrayContaining(['benchmarks/package.json#bench', 'benchmarks/package.json#bench:write']),
		);
	});

	it('sees a declaration-file mapping where one exists — the base config\'s rbush stub', () => {
		// The control: without it, a detector that never matched would pass every script below.
		expect(declarationFileMappings(resolve(REPO_ROOT, 'benchmarks/tsconfig.json'))).toEqual([
			expect.stringMatching(/^rbush → .*packages\/core\/src\/types\/rbush\.d\.ts$/u),
		]);
	});

	it.each(TSX_SCRIPTS.map((script) => [`${script.manifest}#${script.name}`, script] as const))(
		'%s starts tsx with a config that maps no import to a declaration file',
		(_label, script) => {
			const tsconfig = tsconfigArgument(script.command);

			expect(
				tsconfig,
				`"${script.command}" starts tsx without --tsconfig, so tsx applies the nearest tsconfig's paths at runtime `
				+ '— including the base config\'s rbush → rbush.d.ts. Pass a runtime config that clears paths, like '
				+ 'benchmarks/tsconfig.runtime.json.',
			).toBeDefined();

			const configPath = resolve(REPO_ROOT, dirname(script.manifest), tsconfig ?? '');

			expect(existsSync(configPath), `${configPath} does not exist`).toBe(true);
			expect(
				declarationFileMappings(configPath),
				`${tsconfig ?? ''} maps imports to declaration files, which tsx would load at runtime. Clear them with "paths": {}.`,
			).toEqual([]);
		},
	);
});

describe('the benchmark harness', () => {
	it('measures every cell when started the way its bench script starts it', { timeout: HARNESS_TIMEOUT_MS }, () => {
		const bench = TSX_SCRIPTS.find((script) => script.manifest === 'benchmarks/package.json' && script.name === 'bench');
		const [, ...args] = tokens(bench?.command ?? '');
		const run = spawnSync(resolve(BENCHMARKS_DIR, 'node_modules/.bin/tsx'), [...args, ...SMOKE_FLAGS], {
			cwd: BENCHMARKS_DIR,
			encoding: 'utf8',
			timeout: HARNESS_TIMEOUT_MS,
		});
		const output = `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`;

		expect(run.status, output).toBe(0);

		// `[run]  <scenario> @ <tier> (<n> cells)` per scenario and tier, then one table row per cell.
		const announced = [...run.stdout.matchAll(/^\[run\] .* \((\d+) cells?\)$/gmu)]
			.reduce((sum, match) => sum + Number(match[1]), 0);
		const rows = [...run.stdout.matchAll(/^\| `([^`]+)` \| (\S+) ms \| [^|]+ \| (\d+) \|/gmu)].map((match) => ({
			cell: match[1],
			meanMs: Number(match[2]),
			samples: Number(match[3]),
		}));

		expect(announced, output).toBeGreaterThan(0);
		expect(rows, output).toHaveLength(announced);
		expect(rows.map((row) => row.cell)).toContain('rtree:auto');
		expect(rows.filter((row) => !Number.isFinite(row.meanMs) || row.samples < 1), output).toEqual([]);
	});
});

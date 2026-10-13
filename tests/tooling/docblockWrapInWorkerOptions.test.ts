/**
 * Every `wrapInWorker({ … })` example written in PROSE uses only options that exist.
 *
 * @remarks
 * ## What it prevents
 *
 * `wrapInWorker` takes a pre-spawned `worker`, not a URL to spawn one from — for a reason written
 * into that option's own docblock: Vite, Webpack 5+ and esbuild detect workers by static analysis at
 * the `new Worker(...)` site, so the spawn has to stay at the consumer's call site or the worker file
 * is served as an ordinary ESM module and Comlink never wires up.
 *
 * When an option is renamed or removed, the compiler forces every call site to follow and none of
 * the prose. A docblock still showing `wrapInWorker({ workerUrl: new URL(…) })` teaches an option
 * that does not exist. 🔴 One showing `factoryOptions: { onProgress }` is wrong in a second way: it
 * nests a function where Comlink hands the object to `structuredClone`, which is the exact mistake
 * `factoryCallbacks` exists to prevent.
 *
 * ## Why no other gate can see it
 *
 * `tsc` type-checks code. A docblock example is not code — nothing compiles it, nothing imports it,
 * and `prettier` will happily format a call to an option that does not exist. Lint reads the AST,
 * where a comment is a trivium. Yet these docblocks ship inside the `.d.ts` files published to npm,
 * which is where a consumer's IDE renders them.
 *
 * **The defect is specifically that the prose was RIGHT when written.** Nobody edits it; the type
 * moves underneath it. No amount of care at the call site prevents that, which is what makes it a
 * guard's job rather than a reviewer's.
 *
 * ## 🔴 This guard reads ONLY prose, which is the inverse of its neighbors
 *
 * `cjsNamedImports.test.ts` strips comments before matching, because a comment can describe an
 * import and can never be one. Here the comment IS the subject: a `wrapInWorker` call in real code
 * is already checked by `tsc`, and checking it twice would only add a way for this guard to disagree
 * with the compiler. So the two kinds of guard partition a file between them, and the rule is one
 * thing stated from both ends: **decide by category which half of a file you are asserting
 * about.**
 *
 * ## Why it derives the key set instead of hardcoding it
 *
 * The allowed options are read out of `WrapInWorkerOptions` at run time. Hardcoding them would make
 * this guard one more copy of the thing that goes stale — it would keep passing after a genuine
 * rename and start failing on a legitimately-added option. Deriving means a renamed option fails
 * every doc example that still uses the old name, in the same run that renames it.
 *
 * ## ⚠ Known gap
 *
 * It matches CALLS (`wrapInWorker({`), not declaration-shaped sketches such as
 * `function wrapInWorker(factoryName, options)`. A broader matcher would catch those too, but it
 * also fires on correct code, and a guard that fires on correct code is a guard somebody deletes.
 *
 * @packageDocumentation
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Where `WrapInWorkerOptions` is declared — the source of truth for the key set. */
const OPTIONS_SOURCE = resolve(REPO_ROOT, 'packages/worker-bridge/src/wrapInWorker.ts');

/**
 * Trees that may contain a `wrapInWorker` example.
 *
 * @remarks
 * `packages` and `docs`, because a wrong example is equally harmful in either and the published
 * `.d.ts` files carry the `packages` ones to every consumer. `tests` is excluded: a test's comments
 * describe fixtures rather than teach an API.
 */
const SEARCH_ROOTS = ['packages', 'docs'] as const;

/** Extensions worth scanning. Markdown counts — a guide teaches the same API. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.md'] as const;

/**
 * A `wrapInWorker` call with an inline object literal — `wrapInWorker<Wine>({`, `wrapInWorker({`.
 *
 * @remarks
 * 🔴 The literal must open IMMEDIATELY after the call's paren. Taking the nearest following `{`
 * instead lets a sentence merely NAMING `wrapInWorker` ("`wrapInWorker`'s own options docblock
 * says…") latch onto an unrelated brace further down the file and report its keys as options.
 * Anchoring the brace to the call is what distinguishes a call from a mention.
 */
const CALL_WITH_LITERAL = /wrapInWorker\s*(?:<[^>]*>)?\s*\(\s*\{/gu;

/** One `wrapInWorker({ … })` example found in prose. */
interface DocExample {
	/** The option keys the example passes. */
	readonly keys: readonly string[];
	/** Repo-relative path. */
	readonly path: string;
}

/**
 * Every source file under a directory, recursively, skipping generated and vendored trees.
 *
 * @remarks
 * `statSync` is guarded because a pnpm workspace holds self-referential entries that are unreadable
 * on some mounted checkouts; an unhandled throw here takes the whole guard out rather than skipping one
 * path. This guard cannot avoid those entries by narrowing its roots — its subject lives under
 * `packages` — so it swallows the error instead.
 *
 * @param dir - Absolute directory.
 * @returns Absolute file paths.
 */
function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		if (entry === 'node_modules' || entry === 'dist' || entry === '.svelte-kit') {
			return [];
		}

		const path = join(dir, entry);
		let isDirectory = false;

		try {
			isDirectory = statSync(path).isDirectory();
		} catch {
			return [];
		}

		if (isDirectory) {
			return sourceFiles(path);
		}

		return SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension)) ? [path] : [];
	});
}

/**
 * The regions of a file this guard reads — and the split is by file TYPE, deliberately.
 *
 * @remarks
 * For `.ts` / `.tsx`, comments only: real calls are `tsc`'s job, and backticks inside a docblock are
 * emphasis rather than a fenced-versus-inline distinction, so every example in a comment counts.
 * For `.md`, fenced blocks only: here the distinction is real, because a fence presents code as
 * usage while an inline span inside a sentence is prose ABOUT code. That matters because a guide
 * warning against the bad form has to be able to quote it.
 *
 * 🔴 **This split is what keeps the guard from flagging the documents that describe its defect.** A
 * guide that warns against the wrong form has to quote it, and a guard that read every region would
 * flag exactly that guide. The rule is by CATEGORY rather than an excluded
 * filename: it asks what KIND of region can present a call as correct usage.
 *
 * ⚠ The acid test for any simpler rule: stripping inline spans everywhere would also miss a stale
 * example written in a `.ts` docblock as a backticked sentence, which is the commonest shape of this
 * defect. Any rule this guard adopts has to still catch that shape.
 *
 * @param path - Absolute file path, used only to pick the rule.
 * @param source - File contents.
 * @returns The readable regions, joined by newlines.
 */
function readableRegions(path: string, source: string): string {
	if (path.endsWith('.md')) {
		return (source.match(/```[\s\S]*?```/gu) ?? []).join('\n');
	}

	return [
		...(source.match(/\/\*[\s\S]*?\*\//gu) ?? []),
		...(source.match(/\/\/[^\n]*/gu) ?? []),
	].join('\n');
}

/**
 * The option keys declared on `WrapInWorkerOptions`.
 *
 * @remarks
 * Matches `readonly <name>?:` / `readonly <name>:` inside the interface body, which is found by its
 * declaration line and closed at the first line that is exactly `}`. Adequate because the body has
 * no nested braces at column zero — and a brittle parse that FAILS is caught by the first vacuity
 * case rather than silently returning nothing.
 *
 * @returns The declared key names.
 */
function declaredOptionKeys(): readonly string[] {
	const source = readFileSync(OPTIONS_SOURCE, 'utf8');
	const start = source.indexOf('export interface WrapInWorkerOptions {');
	const body = source.slice(start, source.indexOf('\n}', start));

	return [...body.matchAll(/^\treadonly (?<name>[a-zA-Z]+)\??:/gmu)].map(
		(match) => match.groups?.['name'] ?? '',
	);
}

/**
 * The DEPTH-1 keys of an object literal, given the index of its opening brace.
 *
 * @remarks
 * 🔴 Depth-aware. Taking every `name:` at any depth would report `type` in
 * `{ worker: new Worker(url, { type: 'module' }) }` as an unknown option, and `tier` in
 * `factoryOptions: { tier: 'full' }` likewise. A nested key shares a namespace with nothing; only
 * depth 1 is an option.
 *
 * @param source - The region being scanned.
 * @param open - Index of the literal's `{`.
 * @returns The keys declared directly on the literal.
 */
function topLevelKeys(source: string, open: number): readonly string[] {
	const keys: string[] = [];
	let depth = 0;

	for (let i = open; i < source.length; i++) {
		const char = source[i];

		if (char === '{' || char === '(' || char === '[') {
			depth++;
			continue;
		}
		if (char === '}' || char === ')' || char === ']') {
			depth--;

			if (depth === 0) {
				break;
			}
			continue;
		}
		if (depth !== 1) {
			continue;
		}

		// At depth 1 a key is an identifier immediately followed by a colon, and not the tail of a
		// longer identifier we are standing in the middle of.
		const ahead = /^(?<name>[a-zA-Z][\w$]*)\s*:/u.exec(source.slice(i));

		if (ahead?.groups?.['name'] !== undefined && !/[\w$]/u.test(source[i - 1] ?? '')) {
			keys.push(ahead.groups['name']);
		}
	}

	return keys;
}

/**
 * Every `wrapInWorker({ … })` example in a readable region, with the options it passes.
 *
 * @returns One entry per example found.
 */
function docExamples(): readonly DocExample[] {
	const found: DocExample[] = [];

	for (const root of SEARCH_ROOTS) {
		for (const file of sourceFiles(resolve(REPO_ROOT, root))) {
			const region = readableRegions(file, readFileSync(file, 'utf8'));

			for (const match of region.matchAll(CALL_WITH_LITERAL)) {
				const open = region.indexOf('{', match.index);

				found.push({ keys: topLevelKeys(region, open), path: relative(REPO_ROOT, file) });
			}
		}
	}

	return found;
}

describe('wrapInWorker doc examples use options that exist', () => {
	const allowed = declaredOptionKeys();
	const examples = docExamples();

	it('parsed the option keys off WrapInWorkerOptions at all', () => {
		// Vacuity guard #1. A renamed interface or a reformatted body would make `allowed` empty, and
		// an empty allow-set turns the main case into "every key is wrong" — loud — while an
		// over-broad parse turns it into "every key is fine", which is silent. Pinning the two options
		// that cannot go away without a redesign distinguishes those two failures.
		expect(allowed, 'WrapInWorkerOptions parsed to no keys — has the interface moved?').toContain('worker');
		expect(allowed).toContain('factoryName');
	});

	it('found some doc examples to check', () => {
		// 🔴 Vacuity guard #2, and the case that matters most. This guard's whole value is that it
		// reads prose, and prose is easy to stop finding: a renamed package directory, a docblock
		// rewritten without an example, a walk that threw EACCES and returned nothing. Pointing
		// SEARCH_ROOTS at an example-free tree leaves both assertions below GREEN, and this one is the
		// only thing that fires. Zero examples and zero violations are the same
		// exit code.
		expect(
			examples.length,
			'no wrapInWorker doc examples found — is the walk still reaching packages/?',
		).toBeGreaterThan(2);
	});

	it('passes no option that WrapInWorkerOptions does not declare', () => {
		const violations = examples.flatMap((example) =>
			example.keys
				.filter((key) => !allowed.includes(key))
				.map((key) => `${example.path}: '${key}'`),
		);

		expect(
			violations,
			`doc example(s) pass an option wrapInWorker does not have. Allowed: ${allowed.join(', ')}.`,
		).toStrictEqual([]);
	});

	it('never nests a callback inside factoryOptions', () => {
		// Pinned separately from the unknown-option case, because a callback nested inside a VALID
		// option passes it. `factoryOptions` is structuredClone'd whole, so a function anywhere inside
		// it throws; `factoryCallbacks` exists for exactly that and is proxied per entry.
		const offenders = examples
			.filter((example) => example.keys.includes('factoryOptions'))
			.filter((example) => {
				const absolute = resolve(REPO_ROOT, example.path);

				return /factoryOptions:\s*\{[^}]*\bon[A-Z]/u.test(
					readableRegions(absolute, readFileSync(absolute, 'utf8')),
				);
			})
			.map((example) => example.path);

		expect(
			offenders,
			'factoryOptions carries what looks like a callback (an `onX` key). Functions cannot be '
			+ "structuredClone'd — use factoryCallbacks, which proxies each entry.",
		).toStrictEqual([]);
	});
});

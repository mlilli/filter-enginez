/**
 * Rule serialization, asserted against a REAL minified bundle.
 *
 * @remarks
 * ### The defect
 *
 * A rule type name derived from `this.constructor.name` does not survive minification. A minifier
 * rewrites class identifiers, so a production build ships `InSetRule` as `d` — while
 * `ruleRegistry`'s keys are string literals (`register('InSetRule', …)`) and are never mangled.
 * `ruleRegistry.deserialize` throws `Unknown rule type: 'd'`, and **every call site swallows that
 * throw in a `catch`**. So `?f=` shareable links, the worker tier, JSON-config load and devtools
 * snapshots all stop restoring — silently, in the artifact users get, and nowhere else.
 *
 * ### Why this test has to exist, and why it has to be THIS test
 *
 * **Dev servers do not minify.** Every e2e spec, every unit suite and every browser pass exercises
 * the unminified path, so all of them stay green with this defect present. `pnpm build` produces the
 * broken artifact, and nothing else asserts against it.
 *
 * Nothing in the implementation is self-guarding either: the next person to touch a bundler config, or to
 * "simplify" `getRuleTypeName` back to `constructor.name` because the two agree in every unit
 * test, reintroduces it with every gate green. **The only instrument that can see this failure is
 * one that minifies.** That is what this file is.
 *
 * ### The vacuity guard
 *
 * A test that minifies is worthless if the minifier quietly stops mangling — it would pass for the
 * wrong reason forever. So {@link expectIdentifiersWereMangled} asserts the class identifier
 * really WAS rewritten in the artifact under test. If that assertion ever fails, this suite is no
 * longer measuring anything and the failure says so, rather than going green in silence.
 *
 * ### Scope: one minifier, deliberately
 *
 * `MINIFIERS` is a matrix so a second entry is one object literal. It currently holds Vite /
 * Rolldown, the bundler most of the example verticals ship with. The invariant is
 * minifier-independent (no rule type name is derived from a class identifier), so one honest
 * minifier proves it; a second would add install surface without adding a property.
 *
 * ### Where the minifier comes from
 *
 * The engine packages build with `tsc` alone, so no workspace package here depends on a bundler.
 * Vite reaches this repo as a hard dependency of `vitest`, which IS an explicit root devDependency,
 * so the bundler is resolved THROUGH vitest — see {@link resolveThroughDevDependency}. That makes the
 * suite's own runner the guarantee that its instrument is installed, and pins the bundler to the
 * copy the lockfile resolved for vitest, rather than whatever a search path happens to expose.
 */

import { mkdtempSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CORE_ENTRY = resolve(REPO_ROOT, 'packages/core/src/index.ts');

/** One class of core's error hierarchy, as the minified bundle exports it. */
type MinifiedErrorClass = new (code: string, message: string) => { readonly code: string } & Error;

/**
 * The subset of `@filter-enginez/core`'s surface this suite drives, declared structurally so the
 * dynamically-imported bundle is typed without a `Promise<any>`.
 */
interface MinifiedCoreModule {
	readonly CompositeRule: new (
		op: 'and',
		rules: readonly unknown[],
	) => { serialize(): { readonly type: string }};
	readonly FilterEngineConfigError: MinifiedErrorClass;
	readonly FilterEngineDestroyedError: MinifiedErrorClass;
	readonly FilterEngineError: MinifiedErrorClass;
	readonly FilterEngineModeError: MinifiedErrorClass;
	readonly FilterEngineRuleError: MinifiedErrorClass;
	readonly InSetRule: new (field: string, initialSet: readonly string[]) => {
		serialize(): { readonly type: string };
	};
	readonly RangeRule: new (
		field: string,
		config: { readonly max: number; readonly min: number },
	) => { serialize(): { readonly type: string }};
	readonly ruleRegistry: {
		[Symbol.iterator](): IterableIterator<[string, { readonly ruleTypeName: string }]>;
		deserialize(json: { readonly type: string }): object;
	};
	readonly RuleRegistryError: MinifiedErrorClass;
}

/** The shape of a Rollup-style build result, narrowed to what {@link findEntryChunkFileName} reads. */
interface RollupBuildResult {
	readonly output?: readonly RollupOutputArtifact[];
}

/** One emitted file from a Rollup-style build. */
interface RollupOutputArtifact {
	readonly fileName: string;
	readonly isEntry?: boolean;
	readonly type: string;
}

/**
 * Narrow a build result to the multi-output form.
 *
 * @remarks
 * A type predicate rather than a bare `Array.isArray`, which widens a `readonly T[]` member of a
 * union to `any[]` and takes the typed-lint rules down with it.
 *
 * @param result - Whatever `build()` returned
 * @returns `true` when the result is one entry per output config
 */
function isBuildResultArray(
	result: RollupBuildResult | readonly RollupBuildResult[],
): result is readonly RollupBuildResult[] {
	return Array.isArray(result);
}

/**
 * Find the entry chunk's emitted filename from a build result.
 *
 * @remarks
 * Asking the bundler what it wrote beats predicting it. Vite's lib mode derives the name from the
 * entry rather than from `lib.fileName` in some configurations, so a hardcoded `'core.js'` here
 * would fail with a module-not-found that reads like a bundling failure instead of a naming one.
 *
 * @param result - Whatever `build()` returned (single result or one per output config)
 * @returns The entry chunk's filename, relative to `outDir`
 */
function findEntryChunkFileName(result: RollupBuildResult | readonly RollupBuildResult[]): string {
	const results: readonly RollupBuildResult[] = isBuildResultArray(result) ? result : [result];
	const entryChunk = results
		.flatMap((one) => one.output ?? [])
		.find((artifact) => artifact.type === 'chunk' && artifact.isEntry === true);

	if (!entryChunk) {
		throw new Error('The minified build emitted no entry chunk — the bundle step failed.');
	}

	return entryChunk.fileName;
}

/** One entry per bundler whose minified output this suite asserts against. */
interface MinifierUnderTest {
	/**
	 * Bundle + minify `packages/core/src/index.ts` into `outDir` and return the artifact path.
	 *
	 * @param outDir - A scratch directory that already has a `node_modules` symlink for externals
	 * @returns Absolute path to the emitted ES module
	 */
	readonly bundle: (outDir: string) => Promise<string>;
	/** Shown in the test name. */
	readonly name: string;
}

/**
 * Resolve a module through one of the root manifest's own devDependencies.
 *
 * @remarks
 * 🔴 **Anchored at a package that exists, on purpose.** `createRequire` does not check that its
 * anchor exists, so a lookup anchored at a missing directory walks up past it and can still succeed —
 * but only because `pnpm exec` exports a `NODE_PATH` into pnpm's hoisted store. Run the same suite
 * through `node` directly and it fails with "Cannot find module 'vite'", which reads like a broken
 * install rather than a stale path.
 *
 * So the lookup is two explicit hops, each through a manifest that declares the next: the repo
 * root declares `devDependency`, and that package declares `specifier`. Neither hop consults a
 * search path, so the result is the same under `pnpm exec`, a bare `node`, or an editor's runner.
 *
 * @param devDependency - A package named in the root `package.json`'s `devDependencies`
 * @param specifier - A bare specifier that package itself depends on
 * @returns A `file://` URL suitable for dynamic import
 */
function resolveThroughDevDependency(devDependency: string, specifier: string): string {
	const requireFromRoot = createRequire(pathToFileURL(resolve(REPO_ROOT, 'package.json')));
	const devDependencyManifest = requireFromRoot.resolve(`${devDependency}/package.json`);
	const requireFromDevDependency = createRequire(pathToFileURL(devDependencyManifest));

	return pathToFileURL(requireFromDevDependency.resolve(specifier)).href;
}

const MINIFIERS: readonly MinifierUnderTest[] = [
	{
		bundle: async (outDir: string): Promise<string> => {
			const { build } = (await import(
				resolveThroughDevDependency('vitest', 'vite'),
			)) as { build: (config: unknown) => Promise<RollupBuildResult> };

			const result = await build({
				build: {
					lib: { entry: CORE_ENTRY, formats: ['es']},
					// The whole point. Vite defaults production builds to minified; being explicit
					// keeps a future default change from turning this suite vacuous.
					minify: true,
					outDir,
					rollupOptions: {
						// Keep third-party deps (fuse.js, roaring-wasm) external so Node resolves
						// them through the `node_modules` symlink — bundling them in would drag WASM
						// loading into a test that is about identifier mangling.
						external: (id: string): boolean =>
							!id.startsWith('.') && !id.startsWith('/') && !id.startsWith('@filter-enginez'),
					},
					// `ssr` so the artifact targets Node and this suite can import it directly.
					ssr: true,
					target: 'node22',
				},
				configFile: false,
				logLevel: 'silent',
			});

			return join(outDir, findEntryChunkFileName(result));
		},
		name: 'Vite / Rolldown',
	},
];

/**
 * Create a scratch directory the emitted bundle can resolve its externals from.
 *
 * @remarks
 * Node resolves a bare import by walking up from the importing FILE, so the artifact needs a
 * reachable `node_modules`. Symlinking core's own is both the smallest thing that works and the
 * most faithful — those are exactly the copies core builds against.
 *
 * @returns The absolute scratch directory path
 */
function createScratchDirectoryWithExternals(): string {
	const scratchDir = mkdtempSync(join(tmpdir(), 'filter-enginez-minified-'));

	symlinkSync(resolve(REPO_ROOT, 'packages/core/node_modules'), join(scratchDir, 'node_modules'));

	return scratchDir;
}

/**
 * Assert the artifact under test really did have its class identifiers rewritten.
 *
 * @remarks
 * Without this, a minifier that stopped mangling would make every other assertion in this file
 * pass for the wrong reason, permanently and silently — which is the same shape as the bug itself.
 *
 * @param instance - Any instance constructed from the minified bundle
 * @param sourceIdentifier - The class identifier as written in source
 */
function expectIdentifiersWereMangled(instance: object, sourceIdentifier: string): void {
	expect(
		instance.constructor.name,
		`Expected the minifier to rewrite '${sourceIdentifier}', but the identifier survived. `
		+ 'This suite exists to prove serialization does not depend on class identifiers; if they '
		+ 'are no longer mangled it proves nothing. Check the bundler config before touching the fix.',
	).not.toBe(sourceIdentifier);
}

describe.each(MINIFIERS)('rule type names survive $name', (minifier) => {
	let core: MinifiedCoreModule;

	beforeAll(async () => {
		const artifactPath = await minifier.bundle(createScratchDirectoryWithExternals());

		core = (await import(pathToFileURL(artifactPath).href)) as MinifiedCoreModule;
	});

	it('mangles class identifiers — the precondition that makes this suite meaningful', () => {
		expectIdentifiersWereMangled(new core.InSetRule('genre', ['fiction']), 'InSetRule');
		expectIdentifiersWereMangled(new core.RangeRule('year', { max: 2025, min: 2000 }), 'RangeRule');
	});

	it('declares a ruleTypeName matching its registry key, for EVERY registered rule', () => {
		// Driven off the registry inside the bundle rather than a hand-kept list, so a rule added
		// later is covered the day it is registered — a roster that can silently cover fewer rules
		// than exist is a shorter list reading as a shorter green suite.
		const entries = [...core.ruleRegistry];

		expect(entries.length).toBeGreaterThanOrEqual(16);
		for (const [registeredName, ruleClass] of entries) {
			expect(ruleClass.ruleTypeName, `registry key '${registeredName}'`).toBe(registeredName);
		}
	});

	it('round-trips a rule through serialize → deserialize', () => {
		const rule = new core.InSetRule('genre', ['fiction']);
		const serialized = rule.serialize();

		expect(serialized.type).toBe('InSetRule');
		expect(core.ruleRegistry.deserialize(serialized)).toBeInstanceOf(core.InSetRule);
	});

	it('keeps every error class name — what consumers log and the worker bridge rebuilds by', () => {
		// The same defect class as rule type names: an error `name` derived from a class identifier
		// reads `d` in production, and the worker bridge, which rebuilds errors by `name`, would hand
		// the main thread a plain Error. Each class pins its name as a literal; this proves it held.
		const classes = [
			['FilterEngineError', core.FilterEngineError],
			['FilterEngineConfigError', core.FilterEngineConfigError],
			['FilterEngineRuleError', core.FilterEngineRuleError],
			['FilterEngineModeError', core.FilterEngineModeError],
			['FilterEngineDestroyedError', core.FilterEngineDestroyedError],
			['RuleRegistryError', core.RuleRegistryError],
		] as const;

		for (const [sourceName, ErrorClass] of classes) {
			const error = new ErrorClass('RULE_NOT_FOUND', 'minified');

			expectIdentifiersWereMangled(error, sourceName);
			expect(error.name, sourceName).toBe(sourceName);
			expect(error).toBeInstanceOf(core.FilterEngineError);
		}
	});

	it('round-trips a composite expression, children included', () => {
		// The expression path is what the worker tier rebuilds on every settle, and it recurses —
		// a composite whose children fail to revive is the shape the wine tier hits.
		const expression = new core.CompositeRule('and', [
			new core.InSetRule('genre', ['fiction']),
			new core.RangeRule('year', { max: 2025, min: 2000 }),
		]);
		const serialized = expression.serialize();

		expect(serialized.type).toBe('CompositeRule');
		expect(core.ruleRegistry.deserialize(serialized)).toBeInstanceOf(core.CompositeRule);
	});
});

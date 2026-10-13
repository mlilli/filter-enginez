/**
 * Every `pnpm` override carries an upper version bound, overrides nothing that left the tree, and
 * resolves below its own cap.
 *
 * @remarks
 * ## Why this exists
 *
 * A pnpm override replacement is a RANGE, and pnpm resolves it to the **highest** available match. So
 * `cookie: '>=0.7.0'` does not mean "at least 0.7.0" in practice — it means "whatever is newest",
 * forever, across every future major.
 *
 * `pnpm-workspace.yaml` states the rule in its own comments: every replacement carries an UPPER major
 * bound. 🔴 **A rule that lives only in a comment is not enforced.** Without this guard, an
 * open-ended override floats across a major boundary unnoticed, and an override whose package has
 * left the tree keeps pinning nothing while still reading as a decision.
 *
 * ## What one uncapped override breaks, because it is the argument for this guard
 *
 * `cookie@2.x` renamed its entire API — `parse` → `parseCookie`, `serialize` → `stringifySetCookie`.
 * `@sveltejs/kit` declares `cookie: ^0.6.0` and imports `{ parse, serialize }`. If an open-ended
 * `cookie: '>=0.7.0'` override floats to 2.x, those exports do not exist, SvelteKit's SSR runtime
 * fails to evaluate, and every Playwright project behind a SvelteKit dev server dies before the first
 * test runs.
 *
 * 🔴 **And no type check catches it.** Kit ships `@types/cookie@0.6.0` as its own dependency, so
 * TypeScript resolves `serialize` from the 0.6 stubs while Node resolves a module that does not export
 * it. `pnpm typecheck` stays green. cookie 2.x even keeps a *type* called `SerializeOptions` "for
 * backward compatibility" while having dropped the function — the type survives the rename and the
 * value does not, which is the worst arrangement for noticing early.
 *
 * ⚠ So the hazard is specifically invisible to every other instrument in this repo: an override is
 * declared in one file, takes effect in a second, and breaks a third at runtime only. The lockfile
 * records the outcome faithfully and nothing reads it back against the intent. That is the gap here.
 *
 * ## What this can and cannot check
 *
 * It checks three things that are true at rest — every range has a cap, every override has a subject
 * in the lockfile, and every resolved version sits below its cap. It cannot tell whether a cap is the
 * *right* one: whether `markdown-it@15` is actually compatible with markdownlint is a question for
 * `pnpm lint:markdown`, not for a regex. What it guarantees is that crossing a major becomes a
 * decision somebody makes, rather than something that happens.
 *
 * 🟢 This is the `ignoreGhsas` lesson applied one block up in the same file: a rule that lives only in
 * a comment generates wrong entries, and the entries then look like evidence for the rule.
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * `pnpm-lock.yaml`, read ONCE.
 *
 * @remarks
 * ⚠ Read at module scope rather than per lookup on purpose. `resolvedVersions` is called three times
 * per override across the cases below, and this lockfile is ~14,000 lines — re-reading and re-scanning
 * it ~35 times would add whole seconds to the suite. **A guard that noticeably slows the suite is a
 * guard somebody disables**, which costs more than the guard was worth.
 */
const LOCKFILE = readFileSync(resolve(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8');

/** A `major.minor.patch` triple, compared field by field. */
type VersionTriple = readonly [major: number, minor: number, patch: number];

/** One parsed entry of the `overrides` map. */
interface OverrideEntry {
	/** The override's key, verbatim — may carry a selector, as in `brace-expansion@^1.0.0`. */
	readonly key: string;
	/** The package name with any selector stripped. */
	readonly name: string;
	/** The replacement range. */
	readonly range: string;
	/**
	 * Does the key carry a selector, restricting the override to dependents declaring that range?
	 *
	 * @remarks
	 * 🔴 **The resolved-below-cap check is unsound for a scoped entry.** Applied to
	 * `brace-expansion@^1.0.0: '>=1.1.16 <2.0.0'`, it would fail because the tree also holds a
	 * `brace-expansion@5.x` — which that entry does not govern. The `^5.0.0` sibling entry does.
	 *
	 * ⚠ **Attributing a resolved copy to the selector that produced it needs the dependency graph**,
	 * not a lockfile regex: you would have to know each dependent's DECLARED range to know which
	 * selector matched. That is a real resolver, and writing a half-correct one here would be worse
	 * than admitting the limit — so scoped entries get the weaker check documented at its call site.
	 */
	readonly isScoped: boolean;
}

/**
 * Escape a package name for literal use inside a regular expression.
 *
 * @remarks
 * Package names legitimately contain `@`, `/`, `-` and `.`, and `.` is the one that matters: an
 * unescaped `smol.toml` would also match `smol-toml`, so a guard built on raw interpolation reports
 * success against the wrong package. Cheap to escape, invisible when wrong.
 *
 * @param literal - The text to match literally.
 * @returns A pattern source matching exactly that text.
 */
function escapeForRegExp(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&');
}

/**
 * Parse a `major.minor.patch` prefix, ignoring any pre-release or build suffix.
 *
 * @param version - A version string such as `1.1.1` or `0.29.0-rc.1`.
 * @returns The triple, or `undefined` when the string does not start with one.
 */
function parseVersion(version: string): VersionTriple | undefined {
	const match = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)/u.exec(version);

	if (match?.groups === undefined) {
		return undefined;
	}

	return [Number(match.groups['major']), Number(match.groups['minor']), Number(match.groups['patch'])];
}

/**
 * Is `left` strictly below `right`?
 *
 * @param left - The version to test.
 * @param right - The exclusive ceiling.
 * @returns `true` when `left < right` field by field.
 */
function isBelow(left: VersionTriple, right: VersionTriple): boolean {
	for (let index = 0; index < 3; index += 1) {
		// `noUncheckedIndexedAccess` is on, and a fixed-length tuple read still widens to `| undefined`
		// through a computed index — so these are coalesced rather than asserted.
		const leftField = left[index] ?? 0;
		const rightField = right[index] ?? 0;

		if (leftField !== rightField) {
			return leftField < rightField;
		}
	}

	return false;
}

/**
 * The inclusive lower bound a range implies, if it has one.
 *
 * @remarks
 * The mirror of {@link exclusiveCeiling}, and needed only for selector-scoped overrides: proving a
 * scoped entry is doing something means finding a resolved copy INSIDE its range, which takes both
 * ends. `>=X.Y.Z`, `^X.Y.Z`, `~X.Y.Z` and a bare `X.Y.Z` all floor at `X.Y.Z`.
 *
 * ⚠ A `>X.Y.Z` exclusive floor is not supported, for the same reason `<=` is not: unused here, and
 * an off-by-one in a comparator is precisely the kind of quiet wrongness this file is about.
 *
 * @param range - A replacement range from the `overrides` map.
 * @returns The inclusive floor, or `undefined` when the range has none.
 */
function inclusiveFloor(range: string): VersionTriple | undefined {
	const match = /(?:^|\s)(?:>=|\^|~)?(?<version>\d+\.\d+\.\d+)/u.exec(range.trim());

	return match?.groups === undefined ? undefined : parseVersion(match.groups['version'] ?? '');
}

/**
 * The exclusive upper bound a range implies, if it has one.
 *
 * @remarks
 * Four bounded forms are recognized, which is every form this file uses:
 *
 * - `<X.Y.Z` — an explicit ceiling, taken verbatim.
 * - `^X.Y.Z` — the next *significant* release. ⚠ For `0.x` that is `0.(Y+1).0`, not `1.0.0`: in `0.x`
 *   semver the MINOR is the breaking boundary, which is also why `esbuild`'s cap is `<0.29.0` and a
 *   `<1.0.0` cap on a `0.x` package would not be a cap at all.
 * - `~X.Y.Z` — the next minor.
 * - `X.Y.Z` — an exact pin, whose ceiling is the next patch.
 *
 * Anything else — a bare `>=X`, a `>X`, a `*`, a `||` union with an open arm — has no ceiling and
 * returns `undefined`, which is the failure this guard exists for.
 *
 * `<=` is deliberately NOT supported. It is unused here, and an inclusive ceiling would need
 * different comparison logic at every call site; refusing it keeps one comparator honest instead of
 * two approximately right.
 *
 * @param range - A replacement range from the `overrides` map.
 * @returns The exclusive ceiling, or `undefined` when the range is open-ended.
 */
function exclusiveCeiling(range: string): VersionTriple | undefined {
	const explicit = /<\s*(?<version>\d+\.\d+\.\d+)/u.exec(range);

	if (explicit?.groups !== undefined) {
		return parseVersion(explicit.groups['version'] ?? '');
	}

	const caret = /^\^(?<version>\d+\.\d+\.\d+)$/u.exec(range.trim());

	if (caret?.groups !== undefined) {
		const triple = parseVersion(caret.groups['version'] ?? '');

		if (triple === undefined) {
			return undefined;
		}

		return triple[0] === 0 ? [0, triple[1] + 1, 0] : [triple[0] + 1, 0, 0];
	}

	const tilde = /^~(?<version>\d+\.\d+\.\d+)$/u.exec(range.trim());

	if (tilde?.groups !== undefined) {
		const triple = parseVersion(tilde.groups['version'] ?? '');

		return triple === undefined ? undefined : [triple[0], triple[1] + 1, 0];
	}

	const exact = /^(?<version>\d+\.\d+\.\d+)$/u.exec(range.trim());

	if (exact?.groups !== undefined) {
		const triple = parseVersion(exact.groups['version'] ?? '');

		return triple === undefined ? undefined : [triple[0], triple[1], triple[2] + 1];
	}

	return undefined;
}

/**
 * The `overrides` map, read from `pnpm-workspace.yaml`.
 *
 * @remarks
 * Read by scoping to the block and then by line, rather than by parsing the YAML, for the same reason
 * `acceptedAdvisoryParity` does: this file is ~260 lines of load-bearing prose around a handful of
 * settings, and the comments name retired overrides ON PURPOSE so the record of why they went
 * survives.
 *
 * 🔴 The comments around `overrides:` quote un-capped ranges and retired overrides in order to explain
 * them. A looser pattern that scanned the whole file would parse that prose as the declaration and
 * report failures for overrides that do not exist. Block-scoping is what keeps prose from reading as
 * policy; comments start at column 0, so the indented-lines-only body ends where the block does.
 *
 * @returns Every override entry, in file order.
 */
function overrideEntries(): readonly OverrideEntry[] {
	const source = readFileSync(resolve(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8');
	const block = /^overrides:\n(?<body>(?:[ \t]+.*\n?)+)/mu.exec(source);

	expect(block?.groups?.['body'], 'overrides block not found in pnpm-workspace.yaml').toBeDefined();

	return (block?.groups?.['body'] ?? '')
		.split('\n')
		.map((line) => /^\s+'?(?<key>[^':]+?)'?\s*:\s*'(?<range>[^']+)'/u.exec(line))
		.filter((match): match is RegExpExecArray => match?.groups !== undefined)
		.map((match) => {
			const key = match.groups?.['key'] ?? '';
			// A selector override is keyed `name@range` — `brace-expansion@^1.0.0`. The name is everything
			// before the LAST `@`, since a scoped name opens with one: `@hono/node-server@^2.0.0`.
			const selectorAt = key.lastIndexOf('@');

			// Alphabetical, per `perfectionist/sort-objects`.
			return {
				isScoped: selectorAt > 0,
				key,
				name: selectorAt > 0 ? key.slice(0, selectorAt) : key,
				range: match.groups?.['range'] ?? '',
			};
		});
}

/**
 * Every version of `name` present in `pnpm-lock.yaml`.
 *
 * @remarks
 * Matched against lockfile KEYS — `  cookie@2.0.1:` and `  'brace-expansion@1.1.21':` — with the name
 * anchored to the line's indent so near-misses cannot satisfy it. That anchoring is the whole
 * correctness argument: this repo's tree holds `cookie`, `cookie-es`, `js-cookie` and `tough-cookie`,
 * and `postcss` alongside `postcss-selector-parser`. Requiring `@` immediately after the escaped name
 * separates all of them, and requiring the line to START the key separates `markdown-it` from
 * `@types/markdown-it`.
 *
 * @param name - A package name.
 * @returns The distinct resolved versions, in lockfile order.
 */
function resolvedVersions(name: string): readonly string[] {
	const keyPattern = new RegExp(`^ {2}'?${escapeForRegExp(name)}@(?<version>\\d[^ '(:]*)`, 'gmu');

	return [...new Set([...LOCKFILE.matchAll(keyPattern)].map((match) => match.groups?.['version'] ?? ''))].filter(
		(version) => version !== '',
	);
}

describe('pnpm overrides — bounded, live, and resolving below their caps', () => {
	const entries = overrideEntries();

	it('parsed an overrides map, so the cases below have subjects', () => {
		// Vacuity guard. An empty list satisfies every `forEach` beneath it, so a renamed key, a
		// reindented block or a switch to double-quoted scalars would turn this whole file green while
		// measuring nothing. `.prettierignore` carries `pnpm-workspace.yaml` precisely because prettier
		// rewrites those quotes, which makes that failure mode a live one rather than a theoretical one.
		expect(entries.length, 'no overrides parsed — has the block moved or changed quoting?').toBeGreaterThan(5);
	});

	it.each(entries.map((entry) => [entry.key, entry.range] as const))(
		'%s: %s — carries an upper bound',
		(key, range) => {
			// 🔴 The case that stops an override from floating across a major unnoticed.
			expect(
				exclusiveCeiling(range),
				`override '${key}: ${range}' is open-ended, so pnpm will resolve it to the newest `
				+ 'version forever, across every future major. Add a cap: `>=x.y.z <MAJOR.0.0` '
				+ '(or `<0.MINOR.0` for a 0.x package, where the minor is the breaking boundary).',
			).toBeDefined();
		},
	);

	it.each(entries.map((entry) => [entry.key, entry.name] as const))(
		'%s — overrides something that is actually in the tree',
		(key, name) => {
			// 🔴 The dead-override case, and the same lesson as an ignore that matches nothing: a pin
			// against an absent package is a standing claim that a risk was weighed, and it keeps looking
			// true long after the risk is gone. A dependency chain that stops pulling a package leaves its
			// override behind, and nothing else says so.
			expect(
				resolvedVersions(name),
				`override '${key}' pins a package with no entry in pnpm-lock.yaml. Nothing depends on it, `
				+ 'so the override affects nothing — retire it. If its advisory returns with the package, '
				+ '`pnpm audit` is the instrument that should say so.',
			).not.toStrictEqual([]);
		},
	);

	const unscoped = entries.filter((entry) => !entry.isScoped);
	const scoped = entries.filter((entry) => entry.isScoped);

	it.each(unscoped.map((entry) => [entry.key, entry.name, entry.range] as const))(
		'%s — every resolved copy sits below the cap',
		(key, name, range) => {
			// The strong form, and it is only sound for UNSCOPED overrides: those govern every copy in
			// the tree, so every copy must obey the cap. Scoped entries are handled below — see
			// `OverrideEntry.isScoped` for why a regex cannot attribute a copy to a selector.
			const ceiling = exclusiveCeiling(range);

			// Guarded rather than asserted: the bounded-range case above owns that failure, and repeating
			// it here would report one defect as two.
			if (ceiling === undefined) {
				return;
			}

			for (const version of resolvedVersions(name)) {
				const resolved = parseVersion(version);

				expect(resolved, `unparseable version '${version}' for ${name} in pnpm-lock.yaml`).toBeDefined();
				expect(
					resolved !== undefined && isBelow(resolved, ceiling),
					`${name}@${version} is at or above the cap in '${key}: ${range}'. Either the lockfile `
					+ 'is stale against this file (run `pnpm install`), or the cap was widened without '
					+ 'the tree being re-resolved.',
				).toBe(true);
			}
		},
	);

	it.each(scoped.map((entry) => [entry.key, entry.name, entry.range] as const))(
		'%s — at least one resolved copy falls inside its range',
		(key, name, range) => {
			// ⚠ THE WEAKER CHECK, AND ITS WEAKNESS IS THE POINT. A scoped override governs only the
			// dependents that declared its selector, so "every copy below the cap" is simply false for
			// `brace-expansion@^1.0.0` while `brace-expansion@5.0.12` legitimately exists under the
			// `^5.0.0` sibling. What IS checkable without a resolver: the entry has a copy inside its own
			// range, so it is doing something rather than describing a line that left the tree.
			//
			// 🟢 That is still the failure worth catching. A scoped override whose range matches nothing
			// is the dead-override shape one case up — a standing claim that a risk was weighed, looking
			// true long after the risk is gone.
			const ceiling = exclusiveCeiling(range);
			const floor = inclusiveFloor(range);

			if (ceiling === undefined || floor === undefined) {
				return;
			}

			const inRange = resolvedVersions(name)
				.map((version) => parseVersion(version))
				.filter((version): version is VersionTriple => version !== undefined)
				.filter((version) => !isBelow(version, floor) && isBelow(version, ceiling));

			expect(
				inRange.length,
				`no resolved copy of ${name} falls inside '${key}: ${range}', so this scoped override `
				+ `patches nothing. Installed: ${resolvedVersions(name).join(', ') || '(none)'}. Either the `
				+ 'selector no longer matches any dependent — retire the entry — or the lockfile is stale.',
			).toBeGreaterThan(0);
		},
	);

	it('exercised both the scoped and unscoped cap paths', () => {
		// Vacuity guard for the split above. The two cases are mutually exclusive partitions of one
		// list, so a parsing change that pushed every entry into one bucket would leave the other
		// measuring nothing — and `it.each([])` registers no tests at all rather than failing.
		expect(unscoped.length, 'no unscoped overrides — the strong cap check ran against nothing').toBeGreaterThan(0);
		expect(scoped.length, 'no scoped overrides — the in-range check ran against nothing').toBeGreaterThan(0);
	});

	it('lists each package once', () => {
		// Two overrides for one package can disagree, and pnpm obeys one of them. A selector override
		// (`brace-expansion@^1.0.0`) is exempt: scoping by major is the documented way to patch two
		// vulnerable lines independently, so those are expected to repeat the NAME but never the KEY.
		const keys = entries.map((entry) => entry.key);

		expect(new Set(keys).size, 'duplicate key in the overrides map').toBe(keys.length);
	});

	describe('the bound detector itself', () => {
		// 🔴 Negative controls. A check that does not run looks exactly like a check that passes, and
		// `exclusiveCeiling` returning a ceiling for everything would make every case above green while
		// measuring nothing. These assert the detector's two directions against inputs whose answer is
		// known by construction rather than by reading the repo.
		it.each([
			['>=0.7.0', 'an open floor that floats across majors'],
			['>=3.1.4', 'a bare floor'],
			['>0.0.1', 'an exclusive bare floor'],
			['*', 'anything at all'],
			['>=1.0.0 || >=2.0.0', 'a union with an open arm'],
		])('rejects %s (%s)', (range) => {
			expect(exclusiveCeiling(range)).toBeUndefined();
		});

		const CEILING_CASES: readonly (readonly [range: string, ceiling: VersionTriple])[] = [
			['>=0.7.0 <2.0.0', [2, 0, 0]],
			['>=0.28.2 <0.29.0', [0, 29, 0]],
			['^19.2.7', [20, 0, 0]],
			// ⚠ The `0.x` caret case, which is the one a reader is most likely to get wrong: `^0.6.0`
			// means `>=0.6.0 <0.7.0`, NOT `<1.0.0`. It is also exactly the range SvelteKit declares for
			// `cookie`, the motivating case in this file's docblock.
			['^0.6.0', [0, 7, 0]],
			['~1.2.3', [1, 3, 0]],
			['1.8.0', [1, 8, 1]],
		];

		it.each(CEILING_CASES)('reads %s as a ceiling of %j', (range, ceiling) => {
			expect(exclusiveCeiling(range)).toStrictEqual(ceiling);
		});

		const FLOOR_CASES: readonly (readonly [range: string, floor: VersionTriple])[] = [
			['>=1.1.16 <2.0.0', [1, 1, 16]],
			['>=0.28.2 <0.29.0', [0, 28, 2]],
			['^19.2.7', [19, 2, 7]],
			['~1.2.3', [1, 2, 3]],
			['1.8.0', [1, 8, 0]],
		];

		it.each(FLOOR_CASES)('floors %s at %j', (range, floor) => {
			// ⚠ The floor must come from the range's FIRST version, not any version in it. A pattern
			// that scanned loosely would read `>=1.1.16 <2.0.0` as flooring at 2.0.0, which inverts the
			// in-range check into one that can never pass — and a check that can never pass gets deleted
			// rather than fixed.
			expect(inclusiveFloor(range)).toStrictEqual(floor);
		});

		it('orders versions field by field, not lexically', () => {
			// `'9' > '10'` as strings, and a lexical comparator would call `markdown-it@9.x` an upgrade
			// over `15.0.2`. The float this guard exists to catch is exactly a numeric-major change.
			expect(isBelow([1, 1, 1], [2, 0, 0])).toBe(true);
			expect(isBelow([0, 28, 2], [0, 29, 0])).toBe(true);
			expect(isBelow([2, 0, 1], [2, 0, 0])).toBe(false);
			expect(isBelow([9, 0, 0], [15, 0, 0])).toBe(true);
			expect(isBelow([2, 0, 0], [2, 0, 0])).toBe(false);
		});

		it('separates near-miss package names in the lockfile', () => {
			// The anchoring argument, measured rather than asserted in a comment. `cookie` must not pick
			// up `cookie-es`, `js-cookie` or `tough-cookie` — all three are in this tree, which is what
			// makes this a real control rather than a decorative one.
			const cookieVersions = resolvedVersions('cookie');

			expect(cookieVersions.length, 'no `cookie` entry found — has the lockfile format changed?').toBeGreaterThan(0);
			expect(cookieVersions, 'resolvedVersions("cookie") leaked a neighboring package').not.toContain('3.1.1');
			expect(resolvedVersions('postcss'), 'resolvedVersions("postcss") leaked postcss-selector-parser').not.toContain(
				'6.0.10',
			);
		});
	});
});

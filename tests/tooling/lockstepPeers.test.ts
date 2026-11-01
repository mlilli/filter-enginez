/**
 * Packages that pin each other's exact version move together: in the lockfile, and in Dependabot's groups.
 *
 * @remarks
 * ## Why this exists
 *
 * Some packages ship as families whose members name each other's EXACT version as a peer: `@angular/common` 22.2.3
 * requires `@angular/core` 22.2.3, `@vitest/ui` 4.1.11 requires `vitest` 4.1.11. pnpm reports an unmet peer as a
 * warning, not an error, so an install where one member moved without the others succeeds, and so does every gate
 * that does not happen to load both halves together.
 *
 * Dependabot produces exactly that install when a family is not grouped: it opens one pull request per package, each
 * bumping a single member, and each one passes CI on its own.
 *
 * So the guard checks two things, both derived from the lockfile rather than listed:
 *
 * - **the lockfile**: wherever a package pins a peer exactly and that peer is installed beside it, the installed
 *   version is the pinned one;
 * - **`.github/dependabot.yml`**: when both sides of such a pin are direct dependencies (which are what version updates
 *   bump), they fall in the same group of the npm entry, and that group has no `update-types` filter, so a major
 *   arrives as one pull request too.
 *
 * Read as TEXT, like the other guards over these files. `pnpm-lock.yaml` is a two-document YAML stream (pnpm's own
 * environment first, then the workspace), each with its own `importers`, `packages` and `snapshots`; every section of
 * both documents is read.
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './support/repoFiles.js';

/** One lockfile entry: its key as written, quotes removed, and its indented body. */
type LockfileEntry = readonly [key: string, body: string];

/** An exactly pinned peer, installed beside the package that pins it. */
interface ResolvedPin {
	/** The installed version of the peer, peer suffix removed. */
	readonly installed: string;
	/** The peer's package name. */
	readonly peer: string;
	/** The version the dependent requires. */
	readonly required: string;
	/** The snapshot key of the dependent. */
	readonly snapshot: string;
}

/** One group of the npm `updates:` entry in `.github/dependabot.yml`. */
interface DependabotGroup {
	/** Whether the group limits itself with `update-types`. */
	readonly isLimitedByUpdateType: boolean;
	/** The group's name. */
	readonly name: string;
	/** Its `patterns`, quotes removed. */
	readonly patterns: readonly string[];
}

/** A peer range that admits exactly one version. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u;

/**
 * Read a repo file.
 *
 * @param relative - Path from the repo root.
 * @returns Its contents.
 */
function read(relative: string): string {
	return readFileSync(resolve(REPO_ROOT, relative), 'utf8');
}

/**
 * Remove one pair of matching quotes.
 *
 * @param text - A YAML scalar as written.
 * @returns The scalar without its quotes.
 */
function unquote(text: string): string {
	return text.trim().replace(/^(?<quote>['"])(?<inner>.*)\k<quote>$/u, '$<inner>');
}

/**
 * The bodies of every top-level section with one key, across every document of the stream.
 *
 * @param lockfile - The text of `pnpm-lock.yaml`.
 * @param key - A top-level key, such as `snapshots`.
 * @returns Each section's body, in file order.
 */
function sections(lockfile: string, key: string): readonly string[] {
	return [...lockfile.matchAll(new RegExp(String.raw`^${key}:[ \t]*\n(?<body>(?:(?:[ \t]+.*)?\n)*)`, 'gmu'))]
		.map((match) => match.groups?.['body'] ?? '');
}

/**
 * The entries of one `packages` or `snapshots` section.
 *
 * @param body - The section's body.
 * @returns Each entry's key and its indented lines.
 */
function entries(body: string): readonly LockfileEntry[] {
	return [...body.matchAll(/^ {2}(?<key>\S[^\n]*?):(?:[ \t]+\{\})?[ \t]*\n(?<lines>(?: {4}.*\n)*)/gmu)]
		.map((match) => [unquote(match.groups?.['key'] ?? ''), match.groups?.['lines'] ?? ''] as const);
}

/**
 * The `name: value` pairs of one mapping inside an entry, such as its `peerDependencies`.
 *
 * @param lines - The entry's body.
 * @param key - The mapping's key.
 * @returns Each pair with the name's quotes removed; empty when the entry has no such mapping.
 */
function mapping(lines: string, key: string): readonly (readonly [name: string, value: string])[] {
	const items = new RegExp(String.raw`^ {4}${key}:\n(?<items>(?: {6}.*\n)*)`, 'mu').exec(lines)?.groups?.['items'] ?? '';

	return [...items.matchAll(/^ {6}(?<name>\S[^\n]*?): (?<value>\S.*)$/gmu)]
		.map((match) => [unquote(match.groups?.['name'] ?? ''), (match.groups?.['value'] ?? '').trim()] as const);
}

/**
 * The package name in a lockfile key or dependency version.
 *
 * @param key - `name@version`, optionally followed by a peer suffix in parentheses.
 * @returns The name.
 */
function packageName(key: string): string {
	const withoutPeers = key.replace(/\(.*$/u, '');

	return withoutPeers.slice(0, withoutPeers.lastIndexOf('@'));
}

/**
 * Every exactly pinned peer that is installed beside a package pinning it.
 *
 * @param lockfile - The text of `pnpm-lock.yaml`.
 * @returns One record per snapshot and pinned peer.
 */
function resolvedPins(lockfile: string): readonly ResolvedPin[] {
	const snapshots = sections(lockfile, 'snapshots').flatMap(entries);

	return sections(lockfile, 'packages').flatMap(entries).flatMap(([dependent, lines]) =>
		mapping(lines, 'peerDependencies')
			.filter(([, range]) => EXACT_VERSION.test(range))
			.flatMap(([peer, required]) =>
				snapshots
					.filter(([snapshot]) => snapshot === dependent || snapshot.startsWith(`${dependent}(`))
					.flatMap(([snapshot, body]) => {
						const installed = [...mapping(body, 'dependencies'), ...mapping(body, 'optionalDependencies')]
							.find(([name]) => name === peer)?.[1];

						return installed === undefined ? [] : [{ installed: installed.replace(/\(.*$/u, ''), peer, required, snapshot }];
					})));
}

/**
 * The names every workspace importer depends on directly.
 *
 * @param lockfile - The text of `pnpm-lock.yaml`.
 * @returns The names, from every dependency kind of every importer.
 */
function directDependencies(lockfile: string): ReadonlySet<string> {
	return new Set(sections(lockfile, 'importers').flatMap((body) =>
		[...body.matchAll(/^ {6}(?<name>\S[^\n]*?):$/gmu)].map((match) => unquote(match.groups?.['name'] ?? ''))));
}

/**
 * The pairs of direct dependencies where one pins the other exactly.
 *
 * @param lockfile - The text of `pnpm-lock.yaml`.
 * @returns Each pair once, as `[dependent, peer]`, sorted.
 */
function lockstepPairs(lockfile: string): readonly (readonly [dependent: string, peer: string])[] {
	const direct = directDependencies(lockfile);
	const pairs = new Map<string, readonly [string, string]>();

	for (const pin of resolvedPins(lockfile)) {
		const dependent = packageName(pin.snapshot);

		if (direct.has(dependent) && direct.has(pin.peer)) {
			pairs.set(`${dependent} ${pin.peer}`, [dependent, pin.peer]);
		}
	}

	return [...pairs.values()].toSorted(([a], [b]) => a.localeCompare(b));
}

/**
 * The groups of the npm `updates:` entry.
 *
 * @param config - The text of `.github/dependabot.yml`.
 * @returns The groups in file order, which is the order Dependabot assigns a dependency in.
 */
function npmGroups(config: string): readonly DependabotGroup[] {
	const npm = config.split(/^(?=[ \t]+- package-ecosystem:)/mu)
		.find((block) => /^[ \t]+- package-ecosystem:[ \t]*npm[ \t]*$/mu.test(block)) ?? '';
	const groups = /^ {4}groups:\n(?<body>(?: {6}.*\n|[ \t]*\n)*)/mu.exec(npm)?.groups?.['body'] ?? '';

	return groups.split(/^(?= {6}[\w-]+:)/mu).filter((block) => /^ {6}[\w-]+:/u.test(block)).map((block) => {
		const patterns = / {8}patterns:\n(?<items>(?: {10}.*\n| {6,}#.*\n)*)/u.exec(block)?.groups?.['items'] ?? '';

		return {
			isLimitedByUpdateType: /^ {8}update-types:/mu.test(block),
			name: /^ {6}(?<name>[\w-]+):/u.exec(block)?.groups?.['name'] ?? '',
			patterns: [...patterns.matchAll(/^ {10}- (?<pattern>\S.*?)[ \t]*$/gmu)].map((match) => unquote(match.groups?.['pattern'] ?? '')),
		};
	});
}

/**
 * The first group whose patterns match a dependency, as Dependabot assigns it.
 *
 * @param groups - The npm entry's groups, in file order.
 * @param name - A dependency name.
 * @returns The group, or `undefined` when none matches.
 */
function groupOf(groups: readonly DependabotGroup[], name: string): DependabotGroup | undefined {
	const matches = (pattern: string): boolean => new RegExp(
		`^${pattern.split('*').map((part) => part.replace(/[$()+.?[\\\]^{|}]/gu, String.raw`\$&`)).join('.*')}$`,
		'u',
	).test(name);

	return groups.find((group) => group.patterns.some(matches));
}

const LOCKFILE = read('pnpm-lock.yaml');
const PINS = resolvedPins(LOCKFILE);
const PAIRS = lockstepPairs(LOCKFILE);
const GROUPS = npmGroups(read('.github/dependabot.yml'));

describe('exactly pinned peers in pnpm-lock.yaml', () => {
	it('finds exactly pinned peers installed beside their dependents', () => {
		// The vacuity check: with no pins parsed, the case below would pass on any lockfile.
		expect(PINS.length).toBeGreaterThan(0);
	});

	it('installs every exactly pinned peer at the pinned version', () => {
		expect(
			PINS.filter((pin) => pin.installed !== pin.required)
				.map((pin) => `${pin.snapshot} requires ${pin.peer} ${pin.required}, installed ${pin.installed}`),
			'a family that pins each other exactly moved in halves. Bump every member to the same version in one change '
			+ '(and group the family in .github/dependabot.yml, so its pull requests arrive that way).',
		).toEqual([]);
	});

	it('reports a peer installed at another version — the control for the case above', () => {
		// Without it, a parser that never paired a pin with a snapshot would pass the case above on any input.
		const lockfile = [
			'packages:',
			'',
			"  '@f/a@1.0.1':",
			'    resolution: {integrity: x}',
			'    peerDependencies:',
			"      '@f/b': 1.0.1",
			'      c: ^2.0.0',
			'',
			'snapshots:',
			'',
			"  '@f/a@1.0.1(@f/b@1.0.0)(c@2.1.0)':",
			'    dependencies:',
			"      '@f/b': 1.0.0(c@2.1.0)",
			'      c: 2.1.0',
			'',
			"  '@f/b@1.0.0': {}",
			'',
		].join('\n');

		expect(resolvedPins(lockfile)).toEqual([
			{ installed: '1.0.0', peer: '@f/b', required: '1.0.1', snapshot: '@f/a@1.0.1(@f/b@1.0.0)(c@2.1.0)' },
		]);
	});
});

describe('Dependabot groups for lockstep families', () => {
	it('finds lockstep pairs among the direct dependencies, and the npm groups', () => {
		// The vacuity check: with no pairs or no groups parsed, every case below would pass or vanish.
		expect(PAIRS.length).toBeGreaterThan(0);
		expect(GROUPS.map((group) => group.name)).toEqual(expect.arrayContaining(['dev-toolchain', 'react']));
		expect(GROUPS.every((group) => group.patterns.length > 0)).toBe(true);
	});

	it.each(PAIRS)('%s and %s share one group with no update-types filter', (dependent, peer) => {
		const dependentGroup = groupOf(GROUPS, dependent);
		const peerGroup = groupOf(GROUPS, peer);
		const fix = `${dependent} pins ${peer} exactly, so Dependabot must bump them in one pull request. Give the `
			+ 'family its own group in .github/dependabot.yml, with no update-types filter, ahead of any group that also '
			+ 'matches either name.';

		expect(dependentGroup?.name, fix).toBeDefined();
		expect(peerGroup?.name, fix).toBe(dependentGroup?.name);
		expect(dependentGroup?.isLimitedByUpdateType, fix).toBe(false);
	});
});

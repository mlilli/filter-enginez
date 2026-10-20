/**
 * pnpm's release-age quarantine is at least 7 days, every Dependabot cooldown is at least as long as it, and every
 * quarantine exemption names exact versions.
 *
 * @remarks
 * ## Why this exists
 *
 * Two independent delays guard this repository against a freshly published, compromised dependency:
 *
 * - `minimumReleaseAge` in `pnpm-workspace.yaml` (minutes): pnpm refuses to resolve, or to keep in a lockfile, any
 *   version published more recently than that;
 * - `cooldown` in `.github/dependabot.yml` (days): Dependabot does not propose a version update to a release younger
 *   than that.
 *
 * 🔴 **Their ORDER matters, and getting it wrong is silent.** When the cooldown is shorter than the quarantine,
 * Dependabot proposes a version pnpm still refuses, the `pnpm install` in Dependabot's lockfile step fails, and
 * Dependabot opens no pull request at all — which looks exactly like a week with nothing to update. Neither file can
 * see the other, so the ordering lives here.
 *
 * The exemption list gets the same treatment. `minimumReleaseAgeExclude` is how a security fix younger than the
 * quarantine gets in (see `SECURITY.md` → "Dependency release age"), and the safe form names the exact patched
 * version. A bare package name exempts every version, including the next one, which is the release the quarantine
 * exists to hold back. pnpm accepts the bare form, so only this guard rejects it.
 *
 * Read as TEXT, like the other guards over these two files: they are hand-edited configuration, and the shapes below
 * are the shapes they are written in.
 *
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './support/repoFiles.js';

/** The quarantine floor, in minutes: 7 days. */
const MINIMUM_QUARANTINE_MINUTES = 7 * 24 * 60;

/** Minutes in one Dependabot cooldown day. */
const MINUTES_PER_DAY = 24 * 60;

/** One `updates:` entry of `.github/dependabot.yml`. */
interface DependabotUpdate {
	/** Every `*-days` value under the entry's `cooldown:` key, by key. */
	readonly cooldownDays: ReadonlyMap<string, number>;
	/** The `package-ecosystem` value. */
	readonly ecosystem: string;
}

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
 * The top-level values of one key in `pnpm-workspace.yaml`, comments excluded.
 *
 * @param workspace - The file's text.
 * @param key - A top-level key, such as `minimumReleaseAge`.
 * @returns The value written after the key on its own line, once per occurrence.
 */
function topLevelValues(workspace: string, key: string): readonly string[] {
	return [...workspace.matchAll(new RegExp(`^${key}:[ \\t]*(?<value>[^#\\n]*?)[ \\t]*(?:#.*)?$`, 'gmu'))]
		.map((match) => match.groups?.['value'] ?? '');
}

/**
 * The entries of `minimumReleaseAgeExclude`, in either YAML style: a block list or an inline `[…]` list.
 *
 * @param workspace - The text of `pnpm-workspace.yaml`.
 * @returns Each entry with its quotes removed; empty when the key is absent.
 */
function quarantineExemptions(workspace: string): readonly string[] {
	const unquote = (entry: string): string => entry.trim().replace(/^(?<quote>['"])(?<inner>.*)\k<quote>$/u, '$<inner>');
	const inline = topLevelValues(workspace, 'minimumReleaseAgeExclude').find((value) => value.startsWith('['));

	if (inline !== undefined) {
		return inline.slice(1, -1).split(',').map(unquote).filter((entry) => entry !== '');
	}

	const block = /^minimumReleaseAgeExclude:[ \t]*\n(?<items>(?:[ \t]+.*\n|[ \t]*\n)*)/mu.exec(workspace)?.groups?.['items'] ?? '';

	return [...block.matchAll(/^[ \t]+-[ \t]+(?<entry>[^#\n]+?)[ \t]*(?:#.*)?$/gmu)].map((match) => unquote(match.groups?.['entry'] ?? ''));
}

/**
 * The `updates:` entries of `.github/dependabot.yml`, each with its cooldown values.
 *
 * @param config - The file's text.
 * @returns The entries in file order.
 */
function dependabotUpdates(config: string): readonly DependabotUpdate[] {
	const blocks = config.split(/^(?=[ \t]+- package-ecosystem:)/mu).slice(1);

	return blocks.map((block) => {
		const ecosystem = /^[ \t]+- package-ecosystem:[ \t]*(?<name>\S+)/mu.exec(block)?.groups?.['name'] ?? '';
		const cooldown = /^(?<indent>[ \t]+)cooldown:[ \t]*\n(?<body>(?:\k<indent>[ \t]+.*\n|[ \t]*#.*\n)*)/mu.exec(block)?.groups?.['body'] ?? '';
		const cooldownDays = new Map(
			[...cooldown.matchAll(/^[ \t]+(?<key>[\w-]+-days):[ \t]*(?<days>\d+)/gmu)]
				.map((match) => [match.groups?.['key'] ?? '', Number(match.groups?.['days'])] as const),
		);

		return { cooldownDays, ecosystem };
	});
}

const WORKSPACE = read('pnpm-workspace.yaml');
const DEPENDABOT = read('.github/dependabot.yml');
const QUARANTINE_VALUES = topLevelValues(WORKSPACE, 'minimumReleaseAge');
const QUARANTINE_MINUTES = Number(QUARANTINE_VALUES[0]);
const UPDATES = dependabotUpdates(DEPENDABOT);

describe('pnpm release-age quarantine', () => {
	it('sets minimumReleaseAge explicitly, once, to at least 7 days', () => {
		expect(
			QUARANTINE_VALUES,
			'pnpm-workspace.yaml must set `minimumReleaseAge` once, as a number of minutes; left unset, pnpm applies its '
			+ '24h default and does not fail on a too-young version',
		).toHaveLength(1);
		expect(QUARANTINE_VALUES[0]).toMatch(/^\d+$/u);
		expect(
			QUARANTINE_MINUTES,
			`minimumReleaseAge is ${String(QUARANTINE_MINUTES)} minutes; the policy is at least 7 days `
			+ `(${String(MINIMUM_QUARANTINE_MINUTES)})`,
		).toBeGreaterThanOrEqual(MINIMUM_QUARANTINE_MINUTES);
	});

	it('leaves minimumReleaseAgeStrict at its default, so a too-young version fails the install', () => {
		// With `minimumReleaseAge` set explicitly, strict defaults to true. `false` would let pnpm add a young version
		// to `minimumReleaseAgeExclude` itself, which is an exemption nobody decided on.
		expect(topLevelValues(WORKSPACE, 'minimumReleaseAgeStrict').filter((value) => value !== 'true')).toEqual([]);
	});

	it('exempts only exact versions from the quarantine', () => {
		const exactVersion = String.raw`\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?`;
		const exactEntry = new RegExp(String.raw`^(?:@[\w.-]+\/)?[\w.-]+@${exactVersion}(?: \|\| ${exactVersion})*$`, 'u');

		expect(
			quarantineExemptions(WORKSPACE).filter((entry) => !exactEntry.test(entry)),
			'each minimumReleaseAgeExclude entry must name exact versions, as `pkg@1.2.3` or `pkg@1.2.3 || 1.2.4`. A '
			+ 'bare name exempts every future release of the package as well. See SECURITY.md → "Dependency release age".',
		).toEqual([]);
	});

	it('reads exemption lists in both YAML styles — the control for the case above', () => {
		// Without it, a parser that never found an entry would pass the exact-version case on any input.
		expect(quarantineExemptions("minimumReleaseAgeExclude:\n  # GHSA\n  - 'a@1.2.3'\n  - \"@s/b\"\nnext: 1\n"))
			.toEqual(['a@1.2.3', '@s/b']);
		expect(quarantineExemptions("minimumReleaseAgeExclude: ['a@1.2.3 || 1.2.4', c]\n")).toEqual(['a@1.2.3 || 1.2.4', 'c']);
	});
});

describe('Dependabot cooldown', () => {
	it('finds the update entries, the npm one among them', () => {
		// The vacuity check: with no entries parsed, the ordering case below would pass on any file.
		expect(UPDATES.map((update) => update.ecosystem)).toEqual(expect.arrayContaining(['npm', 'github-actions']));
	});

	it.each(UPDATES.map((update) => [update.ecosystem, update] as const))(
		'%s: every cooldown is set and at least as long as pnpm\'s quarantine',
		(ecosystem, update) => {
			expect(
				update.cooldownDays.get('default-days'),
				`${ecosystem}: set cooldown.default-days explicitly; unset, Dependabot waits only 3 days`,
			).toBeDefined();

			for (const [key, days] of update.cooldownDays) {
				expect(
					days * MINUTES_PER_DAY,
					`${ecosystem}: cooldown.${key} is ${String(days)} days, shorter than pnpm's minimumReleaseAge of `
					+ `${String(QUARANTINE_MINUTES)} minutes. Dependabot would propose versions pnpm refuses, and the `
					+ 'lockfile step would fail without opening a pull request. Raise the cooldown to match.',
				).toBeGreaterThanOrEqual(QUARANTINE_MINUTES);
			}
		},
	);
});

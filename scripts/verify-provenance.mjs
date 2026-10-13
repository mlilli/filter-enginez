#!/usr/bin/env node
/**
 * `verify-provenance` — fail unless every package a release just published carries an npm provenance
 * attestation.
 *
 *     PUBLISHED_PACKAGES='[{"name":"@filter-enginez/core","version":"0.1.0"}]' node scripts/verify-provenance.mjs
 *
 * @remarks
 * `release.yml` runs this right after the Changesets publish step, feeding it that step's
 * `publishedPackages` output. Provenance is a property of the published version and can never be added
 * afterwards, so the check belongs in the release run itself: a version that shipped without it stays
 * that way.
 *
 * For each package the registry's attestations endpoint must answer 200 with a SLSA provenance
 * predicate. A fresh attestation can take a moment to appear, so a miss is retried until
 * `PROVENANCE_TIMEOUT_MS` (default 120 000) runs out. `NPM_REGISTRY` overrides the registry, which is how
 * `tests/tooling/releaseProvenance.test.ts` drives the script against a local stand-in.
 *
 * @packageDocumentation
 */

const REGISTRY = (process.env['NPM_REGISTRY'] ?? 'https://registry.npmjs.org').replace(/\/$/u, '');
const TIMEOUT_MS = Number(process.env['PROVENANCE_TIMEOUT_MS'] ?? 120_000);
const RETRY_DELAY_MS = Number(process.env['PROVENANCE_RETRY_DELAY_MS'] ?? 5_000);
const SLSA_PROVENANCE = /^https:\/\/slsa\.dev\/provenance\//u;

/**
 * Whether the registry holds a SLSA provenance attestation for one published version.
 *
 * @param {string} name - Package name, e.g. `@filter-enginez/core`.
 * @param {string} version - The version just published.
 * @returns {Promise<boolean>} `true` once the attestation is present.
 */
async function hasProvenance(name, version) {
	let response;

	try {
		response = await fetch(`${REGISTRY}/-/npm/v1/attestations/${encodeURIComponent(name)}@${version}`);
	} catch (error) {
		// A network failure is retried like a miss, but reported, so a dead registry connection is not
		// mistaken for a missing attestation.
		console.warn(`  ⚠ ${name}@${version}: ${error instanceof Error ? error.message : String(error)}`);

		return false;
	}
	if (!response.ok) {
		return false;
	}
	const body = /** @type {{ attestations?: { predicateType?: string }[] }} */ (await response.json());

	return (body.attestations ?? []).some((attestation) => SLSA_PROVENANCE.test(attestation.predicateType ?? ''));
}

const published = /** @type {{ name: string, version: string }[]} */ (JSON.parse(process.env['PUBLISHED_PACKAGES'] ?? '[]'));

if (published.length === 0) {
	console.error('✗ verify-provenance: PUBLISHED_PACKAGES is empty — nothing to verify, which means the input is wrong.');
	process.exit(1);
}

const deadline = Date.now() + TIMEOUT_MS;
let missing = published;

while (missing.length > 0) {
	const results = await Promise.all(missing.map(async (pkg) => ({ ok: await hasProvenance(pkg.name, pkg.version), pkg })));

	missing = results.filter((result) => !result.ok).map((result) => result.pkg);
	if (missing.length === 0 || Date.now() >= deadline) {
		break;
	}
	await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
}

if (missing.length > 0) {
	console.error(`✗ verify-provenance: ${missing.length} of ${published.length} published version(s) have no provenance attestation:`);
	for (const pkg of missing) {
		console.error(`  • ${pkg.name}@${pkg.version}`);
	}
	process.exit(1);
}

console.log(`✓ verify-provenance: all ${published.length} published version(s) carry a provenance attestation`);

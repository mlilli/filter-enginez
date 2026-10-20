#!/usr/bin/env bash
#
# audit-publish-surface.sh — what would npm actually ship for the 13 engine packages?
#
#     bash scripts/audit-publish-surface.sh            # the table
#     bash scripts/audit-publish-surface.sh --verbose  # plus the per-package detail
#
# ── Why this exists ──────────────────────────────────────────────────────────
#
# The full proof of the packaging is to `pnpm pack` each package and install the tarballs into a
# scratch app — that is `scripts/pack-engine-tarballs.sh` plus `scripts/verify-tarball-imports.sh`.
# This script is the cheaper measurement underneath it: `npm pack --dry-run` reports the exact file
# list npm WOULD ship without installing anything, without a registry, and without touching the
# local node_modules.
#
# 🔴 A path link does not exercise the publish surface. The usual warning is that a path link "sees
# `src/`, ignores the `files` array, and never exercises the `exports` map". In this repo the
# workspace exports map IS what resolves — and it resolves to `./src/*.ts`; only the `publishConfig`
# overrides applied at pack time point it at `dist`. So the publish surface has two halves, checked
# separately: the `files` allow-list (this script) and the packed manifest plus a real install (the
# two scripts above).
#
# ⚠ Keep this script read-only: it must be safe to run on a machine where installing is not an
# option (`pnpm install` there strips native bindings such as `roaring-wasm` and rolldown). `npm pack
# --dry-run` writes nothing; do not "improve" this into something that packs for real.
#
set -uo pipefail

# The script lives in `<repo>/scripts/`, so its parent is the repo root — no git required.
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

VERBOSE=0
[ "${1:-}" = '--verbose' ] && VERBOSE=1

# The 13 engine packages. Kept as a literal list rather than globbed from `packages/`
# BECAUSE the engine/examples boundary is the point: an examples-side package appearing here would be
# the error this audit should surface, and a glob would silently absorb it.
ENGINE_PACKAGES=(
	core reactive-signals reactive-rxjs react-signals react-rxjs
	svelte-signals vue-signals angular-rxjs redux-bridge
	url-state-router worker-bridge eslint mock-data
)

printf '%-20s %6s %10s %6s %6s %6s %6s %5s %6s\n' \
	PACKAGE FILES UNPACKED TESTS SRC DIST TURBO PRIV FILES?
printf '%-20s %6s %10s %6s %6s %6s %6s %5s %6s\n' \
	-------------------- ------ ---------- ------ ------ ------ ------ ----- ------

TOTAL_FILES=0
TOTAL_BYTES=0

for package in "${ENGINE_PACKAGES[@]}"; do
	row="$(
		cd "packages/$package" || exit 1
		npm pack --dry-run --json 2>/dev/null | node -e '
			let raw = "";

			process.stdin.on("data", (chunk) => { raw += chunk; });
			process.stdin.on("end", () => {
				const [report] = JSON.parse(raw);
				const manifest = require(`${process.cwd()}/package.json`);
				const count = (pattern) => report.files.filter((file) => pattern.test(file.path)).length;

				process.stdout.write([
					report.entryCount,
					report.unpackedSize,
					count(/\.(test|spec)\.ts$/u),
					count(/^src\//u),
					count(/^dist\//u),
					count(/^\.turbo\//u),
					manifest.private === true ? "yes" : "no",
					manifest.files === undefined ? "NONE" : manifest.files.length,
				].join(" "));
			});
		'
	)"

	# shellcheck disable=SC2086 # deliberate word splitting of the node payload
	set -- $row
	printf '%-20s %6s %9sMB %6s %6s %6s %6s %5s %6s\n' \
		"$package" "$1" "$(node -e "console.log(($2/1048576).toFixed(2))")" "$3" "$4" "$5" "$6" "$7" "$8"

	TOTAL_FILES=$((TOTAL_FILES + $1))
	TOTAL_BYTES=$((TOTAL_BYTES + $2))

	if [ "$VERBOSE" -eq 1 ]; then
		(
			cd "packages/$package" || exit 1
			npm pack --dry-run --json 2>/dev/null | node -e '
				let raw = "";

				process.stdin.on("data", (chunk) => { raw += chunk; });
				process.stdin.on("end", () => {
					const [report] = JSON.parse(raw);
					const biggest = report.files.slice().sort((a, b) => b.size - a.size).slice(0, 3);

					for (const file of biggest) {
						if (file.size < 1048576) continue;
						process.stdout.write(`      ${(file.size / 1048576).toFixed(1)} MB  ${file.path}\n`);
					}
				});
			'
		)
	fi
done

printf '%-20s %6s %9sMB\n' TOTAL "$TOTAL_FILES" "$(node -e "console.log(($TOTAL_BYTES/1048576).toFixed(1))")"

# ── The assertions worth stating in prose ────────────────────────────────────
#
# ⚠ `npm pack` does NOT apply pnpm's `publishConfig` overrides, so the table above reflects the
# `files` allow-list but NOT the exports rewrite. Whether pnpm applied the rewrite needs a real
# pack-and-install to confirm. What IS checkable here — and is what the guard
# `tests/tooling/publishSurface.test.ts` holds — is that the overrides are internally consistent:
# every workspace subpath has a published twin, and every published target exists on disk.
printf '\n'
printf '→ published exports targets that are MISSING from disk (run `pnpm build` first):\n'
node -e '
	const fs = require("node:fs");
	const packages = process.argv.slice(1);
	let missing = 0;

	for (const name of packages) {
		const manifest = JSON.parse(fs.readFileSync(`packages/${name}/package.json`, "utf8"));
		const published = manifest.publishConfig?.exports ?? {};

		for (const [subpath, target] of Object.entries(published)) {
			const values = typeof target === "string" ? [target] : Object.values(target);

			for (const value of values) {
				if (fs.existsSync(`packages/${name}/${value.slice(2)}`)) continue;
				missing += 1;
				process.stdout.write(`    ${name}${subpath === "." ? "" : subpath}: ${value}\n`);
			}
		}
	}
	if (missing === 0) process.stdout.write("    — none\n");
' "${ENGINE_PACKAGES[@]}"

printf '\n→ npm metadata absent from every public package:\n'
node -e '
	const fs = require("node:fs");
	const wanted = ["repository", "homepage", "bugs", "author", "keywords", "sideEffects", "engines"];
	const packages = process.argv.slice(1);
	const missingEverywhere = wanted.filter((field) =>
		packages.every((name) =>
			JSON.parse(fs.readFileSync(`packages/${name}/package.json`, "utf8"))[field] === undefined,
		),
	);

	process.stdout.write(`    ${missingEverywhere.join(" ") || "—"}\n`);
	process.stdout.write("    (fields left unset on purpose until there is a measurement to set them from —\n");
	process.stdout.write("     a guessed engines value is worse than none; sideEffects is set, and checked by\n");
	process.stdout.write("     tests/tooling/sideEffectFreePackages.test.ts)\n");
' "${ENGINE_PACKAGES[@]}"

printf '\n⚠ npm resolves ignore files PACKAGE-LOCALLY. The root .gitignore does not apply to a\n'
printf '  subdirectory pack, so a gitignored generated corpus still ships unless the package\n'
printf '  carries its own .npmignore or a `files` allow-list. Packages with neither:\n'
for package in "${ENGINE_PACKAGES[@]}"; do
	if [ ! -e "packages/$package/.npmignore" ] \
		&& [ ! -e "packages/$package/.gitignore" ] \
		&& ! node -e "process.exit(require('./packages/$package/package.json').files ? 0 : 1)"; then
		printf '    %s\n' "$package"
	fi
done

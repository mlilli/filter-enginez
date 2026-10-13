#!/usr/bin/env bash
#
# pack-engine-tarballs.sh — pack the 13 engine packages and VERIFY each tarball before anything uses it.
#
#     bash scripts/pack-engine-tarballs.sh
#
# Writes `tmp/engine-tarballs/*.tgz` (gitignored). Two things consume them:
#
#   - `bash scripts/verify-tarball-imports.sh` installs them into a scratch app outside the repo and
#     imports every published subpath, the way a consumer would.
#   - The sibling `filter-enginez-examples` repo installs the engine FROM these tarballs (its
#     `pnpm-workspace.yaml` overrides point at this directory), so run this before every examples
#     install that should see engine changes.
#
# Run it from anywhere: it resolves the repo root from its own location, so the working directory
# cannot change what gets packed, and it needs no git, so it also works in a downloaded source archive.
#
# ── Why a script rather than "run `pnpm pack`" ───────────────────────────────
#
# 🔴 `pnpm pack` at the repo root does NOT pack the 13 — it packs the WORKSPACE ROOT, which has no
# `files` allow-list, so that tarball carries every doc, script and test in the repo. Only
# `private: true` stands between it and npm. Packing has to happen per package, from inside
# each package directory, which is easy to get wrong by hand and impossible to get wrong here.
#
# 🔴 Only `pnpm pack` applies `publishConfig` overrides (`exports` → `dist`). A tarball is therefore the
# only artifact that shows what npm will actually serve; reading the workspace manifests cannot.
#
# What it checks, per tarball, by reading the PACKED manifest rather than the workspace one:
#
#   1. `exports` points at `dist`, not `./src/*.ts`  ← the publishConfig override actually applied
#   2. no `publishConfig` override keys survive into the published manifest
#   3. no `private` field survives
#   4. no test files, no source maps, no tsconfig, no `.turbo` entries
#   5. `NOTICE.md` is present (Apache-2.0 §4(d))
#   6. every module statically reachable from an entry point is in the tarball
#   7. no file from the real wine corpus (`data-real-*`, the Kaggle CSV) — it is CC BY-NC-SA 4.0 and
#      local-only; see `packages/mock-data/scripts/import-kaggle-wine.mjs`
#   8. no `.js` file still carries a `sourceMappingURL` comment (maps are not shipped)
#   9. every `@filter-enginez/*` dependency is a caret range (`^x.y.z`), so an app and its bindings
#      can share one copy of `core`; see `tests/tooling/internalDependencyRanges.test.ts`
#
set -uo pipefail

# The script lives in `<repo>/scripts/`, so its parent is the repo root — no git required.
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

OUT='tmp/engine-tarballs'

ENGINE_PACKAGES=(
	core reactive-signals reactive-rxjs react-signals react-rxjs
	svelte-signals vue-signals angular-rxjs redux-bridge
	url-state-router worker-bridge eslint mock-data
)

if ! command -v pnpm >/dev/null 2>&1; then
	printf '✗ pnpm not found. Install the version pinned in package.json#packageManager (corepack enable).\n'
	exit 1
fi

# ── Build ONLY the 13, and show the output when it fails ─────────────────────
#
# Scoped to the engine packages rather than a bare `pnpm build`, so an unrelated failure elsewhere in
# the workspace cannot block packing. Output is captured and printed in full on failure — a turbo
# summary line alone does not say what broke.
BUILD_FILTERS=()

for package in "${ENGINE_PACKAGES[@]}"; do
	BUILD_FILTERS+=(--filter "@filter-enginez/$package")
done

printf '→ building the %s engine packages (not the example apps)\n' "${#ENGINE_PACKAGES[@]}"

# `pnpm exec turbo`, not a bare `turbo`: the repo's package.json scripts call `turbo` directly and get
# away with it because pnpm puts node_modules/.bin on PATH for scripts — a shell script run by hand has
# no such guarantee. The filter list is derived from ENGINE_PACKAGES above rather than duplicated into a
# root script, so the set that gets BUILT cannot drift from the set that gets PACKED.
if ! build_log="$(pnpm exec turbo run build "${BUILD_FILTERS[@]}" 2>&1)"; then
	printf '✗ build failed for one of the engine packages. Full output:\n\n%s\n' "$build_log"
	exit 1
fi

printf '→ syncing license files (the per-package copies are gitignored, so a fresh clone has none)\n'
node scripts/sync-licenses.mjs || exit 1

rm -rf "$OUT"
mkdir -p "$OUT"

FAILED=0

for package in "${ENGINE_PACKAGES[@]}"; do
	printf '\n── %s\n' "$package"

	# ⚠ Read the tarball path from pnpm's OWN stdout rather than globbing the output directory.
	# A glob has to guess how the scoped name was mangled (`@filter-enginez/core` becomes
	# `filter-enginez-core-0.0.1.tgz`), and dating the match by mtime to pick "the fresh one" is a race
	# against a previous run. pnpm prints exactly one path; taking it is both shorter and correct.
	if ! packed="$(cd "packages/$package" && pnpm pack --pack-destination "../../$OUT" 2>/dev/null | tail -1)"; then
		printf '   ✗ pack failed\n'
		FAILED=$((FAILED + 1))
		continue
	fi

	tarball="$packed"
	[ -f "$tarball" ] || tarball="$OUT/$(basename "$packed")"

	if [ ! -f "$tarball" ]; then
		printf '   ✗ packed, but pnpm reported a path that does not exist: %s\n' "$packed"
		FAILED=$((FAILED + 1))
		continue
	fi

	listing="$(tar tzf "$tarball")"
	manifest="$(tar xzOf "$tarball" package/package.json)"

	# ── Check 6: the IMPORT CLOSURE, which is the one that catches a `files` mistake ──
	#
	# Extract the tarball and walk every `exports` entry point transitively through its relative
	# imports, confirming each resolved file is actually present. A manifest can name `./dist/index.js`
	# correctly while `files` quietly excluded a module that index.js imports — the tarball then
	# installs cleanly and throws on first import. This is the offline half of what the import smoke
	# test does, and it is stronger for that specific failure.
	extracted="$(mktemp -d)"
	tar xzf "$tarball" -C "$extracted"
	closure="$(DIR="$extracted/package" LISTING="$listing" node scripts/lib/tarball-import-closure.mjs)"
	# Check 8's evidence: JavaScript that still points at a source map the tarball does not ship.
	dangling_maps="$(grep -rl --include='*.js' 'sourceMappingURL=' "$extracted/package" 2>/dev/null | wc -l | tr -d ' ')"
	rm -rf "$extracted"

	problems="$(
		MANIFEST="$manifest" LISTING="$listing" NAME="$package" CLOSURE="$closure" DANGLING_MAPS="$dangling_maps" node -e '
			const manifest = JSON.parse(process.env.MANIFEST);
			const listing = process.env.LISTING.split("\n").filter(Boolean);
			const problems = [];
			const targets = Object.entries(manifest.exports ?? {}).flatMap(([subpath, value]) =>
				(typeof value === "string" ? [value] : Object.values(value)).map((v) => [subpath, v]),
			);

			// 1. the override applied — allowing eslint/./config, which ships hand-written src JS.
			for (const [subpath, target] of targets) {
				if (!/^\.\/src\/.*\.tsx?$/u.test(target)) continue;
				problems.push(`exports${subpath === "." ? "" : subpath} still points at source: ${target}`);
			}
			// 2. The OVERRIDE keys must be gone from publishConfig, because their absence is the evidence
			//    that pnpm consumed them. 🔴 Do NOT assert `publishConfig === undefined`: per the pnpm
			//    documentation, `registry`, `access`, `directory`, `linkDirectory` and `executableFiles`
			//    are SETTINGS and are "preserved in the published package.json", while `exports` / `main` /
			//    `types` / `module` / `browser` are OVERRIDES and are applied-then-removed. A correctly
			//    packed manifest keeps `{"access":"public"}`.
			const OVERRIDE_KEYS = ["exports", "main", "types", "typings", "module", "browser", "bin"];
			const leftoverOverrides = OVERRIDE_KEYS.filter((k) => manifest.publishConfig?.[k] !== undefined);

			if (leftoverOverrides.length > 0) {
				problems.push(`publishConfig still carries unconsumed override(s): ${leftoverOverrides.join(", ")}`);
			}
			// 3. `private` must not survive — publishConfig cannot override it, so it has to be absent.
			if (manifest.private !== undefined) problems.push("private survived into the packed manifest");
			// 4. nothing that belongs only to the repo got in.
			const junk = listing.filter((f) => /\.(test|spec)\.|\.map$|tsconfig|\.turbo\/|eslint\.config/u.test(f));
			if (junk.length > 0) problems.push(`${junk.length} unwanted file(s), e.g. ${junk[0]}`);
			// 5. Apache-2.0 §4(d).
			if (!listing.some((f) => f === "package/NOTICE.md")) problems.push("NOTICE.md missing");
			// 7. The real wine corpus is CC BY-NC-SA 4.0 and local-only: it must never ship in an
			//    Apache-2.0 package. `files` excludes it; this catches an allow-list that widens.
			const corpus = listing.filter((f) => /(^|\/)data-real-|winemag-data/u.test(f));
			if (corpus.length > 0) problems.push(`local-only wine corpus in the tarball: ${corpus.join(", ")}`);
			// 8. No `sourceMappingURL` comments: maps are not shipped, so each one would dangle and make
			//    the dev servers of consumers warn on every module load.
			if (process.env.DANGLING_MAPS !== "0") problems.push(`${process.env.DANGLING_MAPS} .js file(s) reference a source map the tarball does not ship`);
			// 9. Internal dependencies are caret ranges. An exact pin installs a second `core` beside the
			//    one an app depends on whenever the two differ by a patch, and `core` relies on `instanceof`.
			for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
				for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
					if (name.startsWith("@filter-enginez/") && !/^\^\d+\.\d+\.\d+$/u.test(spec)) {
						problems.push(`${field}.${name} is "${spec}", not a caret range`);
					}
				}
			}

			// 6. Every STATIC import reachable from an entry point ships. Dynamic ones are advisory.
			const closure = JSON.parse(process.env.CLOSURE);

			if (closure.missing.length > 0) {
				problems.push(`${closure.missing.length} imported module(s) absent from the tarball: ${closure.missing.join(", ")}`);
			}

			process.stdout.write(problems.join("\n"));
		'
	)"

	entries="$(printf '%s\n' "$listing" | wc -l | tr -d ' ')"

	if [ -n "$problems" ]; then
		printf '   ✗ %s entries — %s\n' "$entries" "$(basename "$tarball")"
		printf '%s\n' "$problems" | sed 's/^/      • /'
		FAILED=$((FAILED + 1))
	else
		reachable="$(printf '%s' "$closure" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).reachable)))')"
		optional="$(printf '%s' "$closure" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s).optional;process.stdout.write(o.length?`, ${o.length} optional dynamic`:"")})')"
		printf '   ✓ %s entries, %s modules reachable, exports → dist%s — %s\n' \
			"$entries" "$reachable" "$optional" "$(basename "$tarball")"
	fi
done

printf '\n'

if [ "$FAILED" -gt 0 ]; then
	printf '✗ %s of %s package(s) have packaging problems. Nothing has been published.\n' \
		"$FAILED" "${#ENGINE_PACKAGES[@]}"
	exit 1
fi

printf '✓ all %s tarballs verified in %s/\n' "${#ENGINE_PACKAGES[@]}" "$OUT"
printf '\nNext:\n'
printf '  • bash scripts/verify-tarball-imports.sh   — install them outside the repo and import every subpath\n'
printf '  • pnpm install in ../filter-enginez-examples — picks these tarballs up through its overrides\n'

#!/usr/bin/env bash
#
# verify-tarball-imports.sh — install the packed engine tarballs and import every published subpath.
#
#     bash scripts/verify-tarball-imports.sh            # scratch dir defaults to ~/fe-tarball-check
#     SCRATCH=~/somewhere bash scripts/verify-tarball-imports.sh
#
# Run `bash scripts/pack-engine-tarballs.sh` first. Run this from anywhere: the repo root comes from the
# script's own location and the scratch directory is made absolute, so the working directory cannot
# change what it does. It needs the npm registry, because the tarballs bring real third-party
# dependencies (`roaring-wasm`, `fuse.js`, `rbush`, `zod`, `rxjs`, `comlink`, …) that have to resolve.
#
# ── What this proves that nothing else does ──────────────────────────────────
#
# `pack-engine-tarballs.sh` reads manifests and walks the relative-import graph INSIDE each tarball.
# Both are static. Neither can tell you that a published entry point actually evaluates: a missing
# third-party dependency, a bad `exports` condition order, an ESM/CJS mismatch, or a top-level
# statement that throws under Node all survive every static check and fail here.
#
# 🔴 It is the check for `exports` pointing at `./src/index.ts` — which npm installs happily and Node
# cannot load at all — and for a CommonJS named import that bundlers tolerate and Node rejects.
#
set -uo pipefail

# The script lives in `<repo>/scripts/`, so its parent is the repo root — no git required.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || exit 1
SCRATCH="${SCRATCH:-$HOME/fe-tarball-check}"
TARBALLS="$REPO/tmp/engine-tarballs"

# ⚠ Refuse to put the scratch app inside the repo: its node_modules tree and lockfile are churn nobody
# wants in the history.
case "$(cd "$(dirname "$SCRATCH")" 2>/dev/null && pwd)/$(basename "$SCRATCH")" in
	"$REPO"/*)
		printf '✗ SCRATCH (%s) is inside the repo. Pick a path outside it.\n' "$SCRATCH"
		exit 1
		;;
esac

if ! command -v npm >/dev/null 2>&1; then
	printf '✗ npm not found.\n'
	exit 1
fi

if [ ! -d "$TARBALLS" ] || [ -z "$(find "$TARBALLS" -name '*.tgz' -print -quit 2>/dev/null)" ]; then
	printf '✗ no tarballs in %s\n' "$TARBALLS"
	printf '  Run `bash scripts/pack-engine-tarballs.sh` first.\n'
	exit 1
fi

count="$(find "$TARBALLS" -name '*.tgz' | wc -l | tr -d ' ')"

printf '→ %s tarballs in %s\n' "$count" "$TARBALLS"

# ── Collect every subpath a consumer could import, from the PACKED manifests ──
#
# Read from the tarballs, not from `packages/*/package.json`. The packed manifest is what a consumer
# gets, and reading the workspace one would re-introduce exactly the gap this script exists to close:
# a subpath present in the workspace but absent from what shipped.
SUBPATHS="$(
	for tarball in "$TARBALLS"/*.tgz; do
		tar xzOf "$tarball" package/package.json | node -e '
			let raw = "";

			process.stdin.on("data", (chunk) => { raw += chunk; });
			process.stdin.on("end", () => {
				const manifest = JSON.parse(raw);

				for (const subpath of Object.keys(manifest.exports ?? {})) {
					process.stdout.write(`${manifest.name}${subpath === "." ? "" : subpath.slice(1)}\n`);
				}
			});
		'
	done | sort
)"

printf '→ %s importable subpaths across them\n\n' "$(printf '%s\n' "$SUBPATHS" | wc -l | tr -d ' ')"

rm -rf "$SCRATCH"
mkdir -p "$SCRATCH"
cd "$SCRATCH" || exit 1

printf '→ installing into %s (type: module, so bare `import` works)\n' "$SCRATCH"
printf '{\n  "name": "fe-tarball-check",\n  "private": true,\n  "type": "module",\n  "version": "0.0.0"\n}\n' >package.json

if ! install_log="$(npm install --no-audit --no-fund "$TARBALLS"/*.tgz 2>&1)"; then
	printf '✗ npm install failed. Full output:\n\n%s\n' "$install_log"
	exit 1
fi

printf '✓ installed\n\n'

FAILED=0

while IFS= read -r subpath; do
	[ -n "$subpath" ] || continue

	if error="$(node --input-type=module -e "await import('$subpath');" 2>&1)"; then
		printf '  ✓ %s\n' "$subpath"
	else
		printf '  ✗ %s\n' "$subpath"
		printf '%s\n' "$error" | sed 's/^/        /' | head -6
		FAILED=$((FAILED + 1))
	fi
done <<<"$SUBPATHS"

printf '\n'

if [ "$FAILED" -gt 0 ]; then
	printf '✗ %s subpath(s) do not load from a real install. Nothing has been published.\n' "$FAILED"
	printf '  The install tree is left at %s for inspection.\n' "$SCRATCH"
	exit 1
fi

printf '✓ every subpath loads from a real npm install.\n'
printf '  Scratch tree left at %s; delete it when you are done.\n' "$SCRATCH"

#!/usr/bin/env bash
#
# secret-scan.sh — the secret sweep, over all three surfaces that can leak.
#
#     bash scripts/secret-scan.sh            # tree + commit messages + full diff history
#     bash scripts/secret-scan.sh --tree     # tree only (fast; the publication-gating surface)
#
# Run it from anywhere in the repo. Exits non-zero on any finding.
#
# ── The three surfaces, and why each is separate ─────────────────────────────
#
# 1. **The WORKING TREE.** What every clone sees: the tree as it stands. This is the fast gate.
#
# 2. **COMMIT MESSAGES.** 🔴 Published with the history, and easy to forget: a secret pasted into a
#    commit message is public the moment the commit is pushed, even if no file ever contained it.
#
# 3. **ALL DIFFS.** A credential committed and later removed is still in history, and history is
#    as public as the tree.
#
# ⚠ WHAT THIS CANNOT DO: it matches known vendor prefixes and assignment shapes. It will not catch a
# high-entropy string with no recognizable format, and a passphrase that looks like a word is invisible
# to it. A clean run is evidence, not proof — which is why the result is recorded with a date and a
# commit count rather than as a permanent tick.
#
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1

TREE_ONLY=0
[ "${1:-}" = '--tree' ] && TREE_ONLY=1

# Known credential formats. ⚠ Matched with `grep -e`: several begin with `-`, which grep would
# otherwise read as an option — the first version of this scan silently skipped the private-key
# pattern for exactly that reason, and reported a clean result for a check that never ran.
PATTERNS=(
	'-----BEGIN [A-Z ]*PRIVATE KEY-----'
	'AKIA[0-9A-Z]{16}'
	'ASIA[0-9A-Z]{16}'
	'ghp_[A-Za-z0-9]{36}'
	'gho_[A-Za-z0-9]{36}'
	'ghs_[A-Za-z0-9]{36}'
	'github_pat_[A-Za-z0-9_]{22,}'
	'npm_[A-Za-z0-9]{36}'
	'sk-[A-Za-z0-9]{32,}'
	'sk_live_[A-Za-z0-9]{24,}'
	'xox[a-z]-[A-Za-z0-9-]{10,}'
	'AIza[0-9A-Za-z_-]{35}'
	'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.'
	'(^|[^A-Za-z0-9])glpat-[A-Za-z0-9_-]{20}'
	'dop_v1_[a-f0-9]{64}'
	'SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}'
)

# Filenames that are credential stores by convention. Being TRACKED is the finding, whatever is inside.
CREDENTIAL_FILENAMES='(^|/)(\.env(\..*)?|\.dev\.vars|id_rsa|id_ed25519|.*\.pem|.*\.key|.*\.p12|.*\.pfx|credentials|secrets?\.(json|ya?ml|ts|js))$'

FINDINGS=0

report() { # $1 = heading, $2 = body
	printf '  🔴 %s\n' "$1"
	printf '%s\n' "$2" | cut -c1-160 | sed 's/^/       /'
	FINDINGS=$((FINDINGS + 1))
}

printf '→ surface 1 of 3: the working tree (%s tracked files)\n' "$(git ls-files | wc -l | tr -d ' ')"

for pattern in "${PATTERNS[@]}"; do
	hit="$(git grep -nIE -e "$pattern" -- . 2>/dev/null | head -3)"
	[ -n "$hit" ] && report "$pattern" "$hit"
done

# ⚠ `.npmrc` is tracked and holds only configuration today. It is the file an `_authToken` would land
# in, so the auth keys are checked rather than the filename.
if [ -f .npmrc ]; then
	hit="$(grep -nE '_authToken|_auth[^o]|_password|:_' .npmrc 2>/dev/null)"
	[ -n "$hit" ] && report '.npmrc contains auth material' "$hit"
fi

hit="$(git ls-files | grep -iE "$CREDENTIAL_FILENAMES")"
[ -n "$hit" ] && report 'credential-shaped filename is TRACKED' "$hit"

hit="$(git grep -nIE "(api[_-]?key|secret|token|passwd|password|private[_-]?key|client[_-]?secret)[\"']?[[:space:]]*[:=][[:space:]]*[\"'][A-Za-z0-9+/_=-]{20,}[\"']" -- . 2>/dev/null \
	| grep -vE 'example|placeholder|xxx|XXX|your-|\.test\.|__fixture' | head -5)"
[ -n "$hit" ] && report 'assignment-shaped secret' "$hit"

# 🔴 A path that was tracked once and is gitignored NOW is the classic leak: the ignore rule arrived
# after the commit, so the file is still in history while looking protected in the tree.
printf '→ checking for paths that were tracked once and are gitignored now\n'
git log --all --pretty=format: --name-only --diff-filter=A 2>/dev/null | sort -u | grep -v '^$' \
	| while IFS= read -r path; do
		git check-ignore -q "$path" 2>/dev/null && printf '%s\n' "$path"
	done >/tmp/secret-scan-shadowed.txt
if [ -s /tmp/secret-scan-shadowed.txt ]; then
	report 'once tracked, now gitignored' "$(head -10 /tmp/secret-scan-shadowed.txt)"
fi
rm -f /tmp/secret-scan-shadowed.txt

if [ "$TREE_ONLY" -eq 1 ]; then
	printf '\n(--tree: skipped commit messages and diff history)\n'
else
	commits="$(git rev-list --count HEAD)"

	# 🔴 Written to FILES and streamed, never captured into a shell variable. A command substitution
	# drops null bytes — bash says so, and the first version of this script printed
	# `warning: command substitution: ignored null byte in input` while scanning 21 MB of history.
	# Binary blobs in diffs carry null bytes, so part of surface 3 was silently not scanned and the
	# scan reported clean anyway. That is the same failure as the `grep -e` bug above: a check that
	# does not run looks exactly like a check that passes.
	scratch="$(mktemp -d)"
	# shellcheck disable=SC2064 # expand now: the directory name must be fixed at trap time
	trap "rm -rf '$scratch'" EXIT

	printf '→ surface 2 of 3: %s commit messages (published with the history)\n' "$commits"
	git log --format='%H%n%an%n%ae%n%s%n%b' >"$scratch/messages.txt"
	for pattern in "${PATTERNS[@]}"; do
		hit="$(grep -naE -e "$pattern" "$scratch/messages.txt" 2>/dev/null | head -2)"
		[ -n "$hit" ] && report "in a commit message: $pattern" "$hit"
	done

	printf '→ surface 3 of 3: every diff across %s commits\n' "$commits"
	git log -p --no-color >"$scratch/diffs.txt"
	for pattern in "${PATTERNS[@]}"; do
		# `-a` treats the file as text even where a binary blob made grep call it binary, which it
		# would otherwise refuse to search at all.
		hit="$(grep -naE -e "$pattern" "$scratch/diffs.txt" 2>/dev/null | head -2)"
		[ -n "$hit" ] && report "in history: $pattern" "$hit"
	done
fi

printf '\n'

if [ "$FINDINGS" -gt 0 ]; then
	printf '✗ %s finding(s). Do not publish until each is resolved.\n' "$FINDINGS"
	exit 1
fi

printf '✓ no findings across %s surface(s).\n' "$([ "$TREE_ONLY" -eq 1 ] && echo 1 || echo 3)"
printf '  Authors in history: %s\n' "$(git log --format='%ae' | sort -u | tr '\n' ' ')"
printf '  ⚠ Every author email above becomes public with the commits that carry it.\n'
printf '    Decide that deliberately.\n'
printf '  ⚠ Re-run immediately before publishing. A clean result is dated evidence, not a\n'
printf '    permanent property: the next commit can break it.\n'

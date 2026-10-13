// lint-staged.config.mjs
//
// Why a JS config file (vs. the `lint-staged` block in package.json)?
// ────────────────────────────────────────────────────────────────────
// lint-staged appends staged file paths to whatever command string it
// receives by default.
//
// The fix: lint-staged accepts a function value `(files) => command` —
// when used, the returned value is run verbatim, file paths are NOT
// appended, and an ARRAY of commands runs SEQUENTIALLY. Function syntax
// is only available in JS config files (JSON can't hold functions),
// hence this file.
//
// 🔴 Markdown is a function entry for that sequencing, and it is a
// correctness requirement rather than a tidy-up.
// ────────────────────────────────────────────────────────────────────
// `prettier --write` and `markdownlint-cli2 --fix` DISAGREE about
// markdown formatting — list continuation indent and table pipe
// alignment, at least. Whichever runs last wins.
//
// As two separate glob entries, a `.md` file would match both, and
// lint-staged runs tasks for DIFFERENT patterns concurrently, so the
// winner would be a race. Whenever markdownlint finished last, the
// commit would land markdown in a state `prettier --check` (which CI
// runs) rejects — including regions the commit never edited.
//
// Chaining them in one function entry makes **Prettier last,
// deterministically**. Prettier is the formatter of record for markdown
// here; markdownlint is the linter, so its `--fix` should run first and
// the formatter should have the final word.
//
// ⚠ `md`/`mdx` are therefore absent from the Prettier-only entry
// below. Adding them there would create the race, because the file
// would match both patterns.
//
// 🟢 Verified a stable fixpoint rather than assumed: after
// `markdownlint --fix` then `prettier --write`, BOTH tools accept the
// result. If that ever stops being true the two configs genuinely
// conflict, and the fix is to settle the rule (MD060 table style is the
// known flashpoint) rather than to reorder again.

/** Shell-quote a path list for a verbatim command string. */
const quote = (files) => files.map((file) => JSON.stringify(file)).join(' ');

/** @type {import('lint-staged').Configuration} */
const lintStaged = {
	'**/*.{cjs,css,html,js,json,jsx,mjs,md,mdx,scss,ts,tsx,yml,yaml}': 'cspell lint --cache --cache-location .cache/cspell/.cspellcache --no-must-find-files --no-progress',
	'**/*.{cjs,css,js,json,mjs,scss,ts,yml,yaml}': 'prettier --write --ignore-path ./.prettierignore --ignore-unknown',
	'**/*.{cjs,js,jsx,mjs,ts,tsx}': 'eslint --color --no-error-on-unmatched-pattern --no-warn-ignored --fix --max-warnings=0 --no-cache',
	// Sequential, and Prettier last. See the header.
	'**/*.{md,mdx}': (files) => [
		`markdownlint-cli2 --fix ${quote(files)}`,
		`prettier --write --ignore-path ./.prettierignore --ignore-unknown ${quote(files)}`,
	],
};

export default lintStaged;

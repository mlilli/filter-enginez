/**
 * Engine state ↔ URL string serializers — the three built-in formats plus the extension
 * interface for custom encodings.
 *
 * @remarks
 * Per `docs/architecture.md` §14. The URL state-router takes the engine's `exportConfig()`
 * output, runs it through one of these serializers, and writes the result into the URL
 * `?f=...` (or whatever `paramKey` the consumer chose). The inverse path — URL → engine —
 * runs the same serializer in reverse and feeds the result to `loadConfig`.
 *
 * **Three built-in formats**:
 *
 * - **`'json-base64'`** — `JSON.stringify(config)` → UTF-8 bytes → base64url. Opaque
 *   (intentional — discourages hand-editing), stable across schema versions, zero runtime
 *   deps. Base64url is the URL-safe variant: `+` → `-`, `/` → `_`, padding `=` stripped.
 * - **`'human-readable'`** — plain `JSON.stringify(config)`; the transport (`URLSearchParams` in
 *   `FilterEngineUrlSync`) does the single URL-encoding, so a decoded address bar shows the literal
 *   JSON. Longer than base64, but readable. Great for share links + bug reports. It must NOT
 *   pre-`encodeURIComponent` — that double-encodes once `URLSearchParams` runs (`%` → `%25`).
 * - **`'compact'`** — LZ-compressed via `lz-string`'s `compressToEncodedURIComponent`.
 *   The shortest of the three for typical config payloads — usually **3-4× smaller than
 *   json-base64** for JSON with the typical repetitive structure (keys like `"type":`,
 *   `"config":`, `"field":` repeat across rules and compress very well). Recommended when
 *   URL length matters and consumer-side legibility doesn't.
 *
 * All three serializers preserve the full `FilterEngineConfig` schema fidelity — version,
 * rules, groups, expression tree, metadata. The choice between them is the URL-length /
 * legibility / dep-cost tradeoff, not a capability question.
 *
 * @packageDocumentation
 */

import { type FilterEngineConfig, FilterEngineConfigError } from '@filter-enginez/core';
// 🔴 NAMESPACE import plus a `.default` fallback. Three forms are possible here and TWO OF THEM FAIL
// — in opposite environments.
//
// `lz-string@1.5.0` is CommonJS with `main` only: no `exports` map, no `module` field, no `type`.
// Its `typings/lz-string.d.ts` declares NAMED exports and nothing else, so TypeScript is happy with
// every form below and tells you nothing about which one runs.
//
//   1. `import { compressToEncodedURIComponent } from 'lz-string'`   ✗ throws in Node ESM
//      Node's cjs-module-lexer cannot statically detect the named exports:
//        SyntaxError: Named export 'compressToEncodedURIComponent' not found. The requested module
//        'lz-string' is a CommonJS module, which may not support all module.exports as named exports.
//      ⚠ It fails for CONSUMERS ONLY. Vite, Rolldown and vitest all interop CJS named imports for
//      you, so bundled apps, the unit suite and the e2e suite pass while
//      `@filter-enginez/url-state-router/serializers` cannot be imported from Node at all. Only a
//      pack-and-install import test, which loads the published entry point the way a Node consumer
//      does, sees it.
//
//   2. `import lzString from 'lz-string'` then destructure                ✗ throws in Vite SSR
//        TypeError: Cannot destructure property 'compressToEncodedURIComponent' of
//        '__vite_ssr_import_0__.default' as it is undefined
//      Vite's SSR transform hands back a namespace whose named exports are present and whose
//      `default` is NOT, so the default import resolves to `undefined` and every SSR route that
//      loads this module fails.
//
//   3. Namespace import, then `.default ?? the namespace itself`           ✓ both
//      Node ESM gives `{ default: module.exports }`, so the left side wins. Vite SSR gives the
//      flattened namespace with no `default`, so the right side wins. Bundlers supply both and
//      either is the same object.
//
// 🔴 A CJS interop form is a claim about every host that loads it, and this package has at least
// three — Node ESM, Vite's SSR runtime, and whatever a consumer bundles with. A form that works in
// one host can fail in another, so verify any change in all three. `tests/tooling/cjsNamedImports.test.ts` can only
// see form (1) statically; form (2) shows up only under a real Vite SSR end-to-end run, so leave
// this form alone unless `lz-string` ships an ESM build.
//
// ⚠ The unwrap lives in `./interopDefault.ts` rather than here because the branch it exists for is
// chosen by the HOST: under vitest the namespace always carries a synthesized `default`, so the
// fallback arm — the one Vite SSR takes — is unreachable from any test of THIS module. Taking the
// namespace as a parameter is what makes both shapes constructible, and a `v8 ignore` here would
// have bought the coverage threshold by asserting the opposite of the truth.
import * as lzStringModule from 'lz-string';

import { unwrapInteropDefault } from './interopDefault.js';

/** The two `lz-string` entry points this module needs. */
interface LzStringCompressors {
	/** LZ-compress a string into a URI-component-safe form. */
	readonly compressToEncodedURIComponent: (input: string) => string;
	/** Reverse {@link LzStringCompressors.compressToEncodedURIComponent}. */
	readonly decompressFromEncodedURIComponent: (compressed: string) => string;
}

const { compressToEncodedURIComponent, decompressFromEncodedURIComponent }
	= unwrapInteropDefault<LzStringCompressors>(lzStringModule);

/**
 * The string identifiers for the three built-in serializers.
 */
export type BuiltInSerializerName = 'compact' | 'human-readable' | 'json-base64';

/**
 * Custom serializer contract. Implementations encode a config into a URL-safe string and
 * decode it back. Errors (malformed input, version mismatch) should throw — the URL-sync
 * component reports them to its `onError` prop and, when `tolerateMalformedUrls` is `true` (the
 * default), leaves the engine unchanged rather than letting bad URL state break the app.
 */
export interface EngineStateSerializer {
	/** A short identifier (used for diagnostics + the "which serializer wrote this" check). */
	readonly name: string;
	/** Encode an engine config into a URL-safe string. */
	encode(config: FilterEngineConfig): string;
	/** Decode a URL-safe string back into an engine config. */
	decode(serialized: string): FilterEngineConfig;
}

/**
 * Resolve a serializer name (or pass-through a custom serializer instance) into a concrete
 * `EngineStateSerializer`. The URL-sync component calls this once on each engine state
 * change to get the encoder it needs.
 *
 * @param serializer - Either a built-in name or a custom serializer instance
 * @returns A resolved serializer
 *
 * @example
 *   // Built-in:
 *   const ser = resolveSerializer('human-readable');
 *
 *   // Custom (e.g., a CBOR-based one):
 *   const ser = resolveSerializer({
 *     name: 'cbor-base64',
 *     encode: (config) => base64UrlEncode(cborEncode(config)),
 *     decode: (s) => cborDecode(base64UrlDecode(s)),
 *   });
 */
export function resolveSerializer(
	serializer: BuiltInSerializerName | EngineStateSerializer,
): EngineStateSerializer {
	if (typeof serializer === 'string') {
		switch (serializer) {
			case 'compact':
				return compactSerializer;
			case 'human-readable':
				return humanReadableSerializer;
			case 'json-base64':
				return jsonBase64Serializer;
			default:
				// Runtime guard for off-type values arriving from untyped JS callers — the
				// `BuiltInSerializerName` union makes this branch unreachable to TypeScript.
				throw new FilterEngineConfigError(
					'URL_STATE_UNKNOWN_SERIALIZER',
					`resolveSerializer: unknown built-in serializer name '${String(serializer)}'. `
					+ `Valid options: 'json-base64', 'human-readable', 'compact', or a custom `
					+ `EngineStateSerializer instance.`,
				);
		}
	}

	// Trust the structural shape — duck typing on { name, encode, decode } is sufficient.
	return serializer;
}

// ─── Internal base64url helpers ─────────────────────────────────────────────
//
// `btoa` / `atob` are universally available on browsers + Node 16+. The URL state-router
// package is browser-only per its dependency on react-router, so we don't need a
// Node fallback path.

/**
 * Encode a UTF-8 string as URL-safe base64 (base64url). Adapts the standard btoa output
 * (which uses `+`, `/`, and padding `=`) to the URL-safe variant (`-`, `_`, no padding).
 *
 * @internal
 */
function base64UrlEncode(str: string): string {
	const bytes = new TextEncoder().encode(str);
	let binary = '';

	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

/**
 * Decode a URL-safe base64 string back to a UTF-8 string.
 *
 * @internal
 */
function base64UrlDecode(s: string): string {
	const padded = s.replace(/-/g, '+').replace(/_/g, '/');
	const paddingLength = padded.length % 4 ? 4 - (padded.length % 4) : 0;
	const binary = atob(padded + '='.repeat(paddingLength));
	const bytes = new Uint8Array(binary.length);

	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}

	return new TextDecoder().decode(bytes);
}

/**
 * The built-in `json-base64` serializer. Compact + opaque.
 */
export const jsonBase64Serializer: EngineStateSerializer = {
	decode(serialized: string): FilterEngineConfig {
		try {
			return JSON.parse(base64UrlDecode(serialized)) as FilterEngineConfig;
		} catch (err) {
			throw new FilterEngineConfigError(
				'URL_STATE_MALFORMED',
				`jsonBase64Serializer.decode: failed to decode URL state — ${(err as Error).message}. `
				+ `The serialized value may be truncated, corrupted, or in a different format.`,
				{ cause: err },
			);
		}
	},
	encode(config: FilterEngineConfig): string {
		return base64UrlEncode(JSON.stringify(config));
	},
	name: 'json-base64',
};

/**
 * The built-in `human-readable` serializer. Plain JSON — the transport (`URLSearchParams` in
 * `FilterEngineUrlSync`) performs the single URL-encoding, so a decoded address bar shows the
 * literal config. Longer than base64 but legible when pasted into a debug tool or shared.
 *
 * @remarks
 * It deliberately does NOT `encodeURIComponent` its output: the caller writes the value through
 * `URLSearchParams`, which URL-encodes it. Pre-encoding here would DOUBLE-encode (every `%` becomes
 * `%25`), so the URL would read `%257B%2522…` and need decoding twice. Emitting raw JSON and letting
 * the transport encode once keeps the URL single-escaped (and human-readable when decoded).
 */
export const humanReadableSerializer: EngineStateSerializer = {
	decode(serialized: string): FilterEngineConfig {
		try {
			return JSON.parse(serialized) as FilterEngineConfig;
		} catch (err) {
			throw new FilterEngineConfigError(
				'URL_STATE_MALFORMED',
				`humanReadableSerializer.decode: failed to parse URL state — ${(err as Error).message}. `
				+ `The serialized value may be truncated or malformed JSON.`,
				{ cause: err },
			);
		}
	},
	encode(config: FilterEngineConfig): string {
		return JSON.stringify(config);
	},
	name: 'human-readable',
};

/**
 * The built-in `compact` serializer. LZ-compressed via `lz-string`'s URL-safe variant.
 * Typically 3-4× smaller than `json-base64` for the kind of JSON `exportConfig()`
 * produces (repeated `"type":` / `"config":` / `"field":` keys compress very well).
 *
 * @remarks
 * Adds a ~3KB runtime dependency on `lz-string`. Pick this when URL length matters and
 * consumer-side legibility doesn't. For the wine + real-estate POCs where shareable URLs
 * are a feature, this is the right default.
 *
 * **Error semantics.** `lz-string`'s `decompressFromEncodedURIComponent` returns the empty
 * string (or `null` in some implementations) on malformed input rather than throwing. We
 * detect that here and throw a clear diagnostic so the URL-sync component's
 * `tolerateMalformedUrls` / `onError` paths fire cleanly.
 */
export const compactSerializer: EngineStateSerializer = {
	decode(serialized: string): FilterEngineConfig {
		const decompressed = decompressFromEncodedURIComponent(serialized);

		if (!decompressed) {
			throw new FilterEngineConfigError(
				'URL_STATE_MALFORMED',
				`compactSerializer.decode: failed to decompress URL state — input is malformed, `
				+ `truncated, or wasn't produced by the compact serializer.`,
			);
		}
		try {
			return JSON.parse(decompressed) as FilterEngineConfig;
		} catch (err) {
			throw new FilterEngineConfigError(
				'URL_STATE_MALFORMED',
				`compactSerializer.decode: decompression succeeded but JSON.parse failed — `
				+ `${(err as Error).message}. The decompressed payload may be from a different `
				+ `schema version or a different encoder.`,
				{ cause: err },
			);
		}
	},
	encode(config: FilterEngineConfig): string {
		return compressToEncodedURIComponent(JSON.stringify(config));
	},
	name: 'compact',
};

/** One-char format tags for {@link createTaggedSerializer} (`<tag>~<payload>`). `~` is URL-unreserved. */
const FORMAT_TAGS: Record<BuiltInSerializerName, string> = {
	compact: 'c',
	'human-readable': 'h',
	'json-base64': 'b',
};

/** Reverse of {@link FORMAT_TAGS} — a leading tag char back to its serializer name. */
const TAG_FORMATS: Record<string, BuiltInSerializerName> = {
	b: 'json-base64',
	c: 'compact',
	h: 'human-readable',
};

/**
 * Wrap the built-ins so an encoded value SELF-IDENTIFIES its format with a `<tag>~` prefix (`h~`
 * human-readable, `c~` compact, `b~` json-base64). `encode` tags with the given `format`; `decode`
 * reads the tag and dispatches to the matching serializer — so a URL written in one format still
 * decodes for a reader whose current setting is different. This is what makes a runtime format
 * toggle safe: shared links never break across formats.
 *
 * @param format - The format `encode` should produce (decode auto-detects regardless).
 */
export function createTaggedSerializer(format: BuiltInSerializerName): EngineStateSerializer {
	const inner = resolveSerializer(format);

	return {
		decode(serialized: string): FilterEngineConfig {
			// `charAt` rather than `serialized[0] ?? ''`: under `noUncheckedIndexedAccess` element access
			// is typed `string | undefined`, so the index form would need a `??` fallback that could never
			// actually run — reaching it requires `serialized[1] === '~'`, which already guarantees an
			// index 0. That left a permanently uncoverable branch. `charAt` is typed to return `string`,
			// so the impossible case disappears instead of being explained away with a coverage ignore.
			const taggedFormat = serialized[1] === '~' ? TAG_FORMATS[serialized.charAt(0)] : undefined;

			if (taggedFormat === undefined) {
				throw new FilterEngineConfigError(
					'URL_STATE_MALFORMED',
					`createTaggedSerializer.decode: missing or unknown format tag on '${serialized.slice(0, 8)}…'. `
					+ `Expected a 'h~' / 'c~' / 'b~' prefix.`,
				);
			}

			return resolveSerializer(taggedFormat).decode(serialized.slice(2));
		},
		encode(config: FilterEngineConfig): string {
			return `${FORMAT_TAGS[format]}~${inner.encode(config)}`;
		},
		name: `tagged:${format}`,
	};
}

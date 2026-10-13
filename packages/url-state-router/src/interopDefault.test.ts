/**
 * Both interop shapes, constructed rather than hoped for.
 *
 * @remarks
 * 🔴 **These two cases are the reason `unwrapInteropDefault` is a module at all.** The branch is
 * chosen by the HOST: under vitest a namespace import always carries a synthesized `default`, so
 * inlined in `serializers.ts` the fallback arm could never run from a test — and that arm is the one
 * Vite's SSR runtime takes in production, where getting it wrong fails every SSR route.
 *
 * ⚠ Passing plain object literals is the whole point: no host interop is involved, so each arm is
 * reached by construction instead of by whatever Vite happened to do that day.
 *
 * @packageDocumentation
 */

import { describe, expect, it } from 'vitest';

import { unwrapInteropDefault } from './interopDefault.js';

/** The two functions `serializers.ts` actually needs off `lz-string`. */
interface FakeCompressors {
	readonly compressToEncodedURIComponent: (input: string) => string;
	readonly decompressFromEncodedURIComponent: (compressed: string) => string;
}

const compressors: FakeCompressors = {
	compressToEncodedURIComponent: (input) => `z(${input})`,
	decompressFromEncodedURIComponent: (compressed) => compressed.slice(2, -1),
};

describe('unwrapInteropDefault', () => {
	it("returns the host's synthesized default — Node ESM's shape", () => {
		// `import * as ns` of a CommonJS module in Node gives `{ default: module.exports }`, because
		// cjs-module-lexer could not detect any named exports to hoist.
		const nodeShape = { default: compressors };

		expect(unwrapInteropDefault<FakeCompressors>(nodeShape)).toBe(compressors);
	});

	it('falls back to the namespace when there is no default — Vite SSR\'s shape', () => {
		// Vite's SSR transform hands back the flattened namespace: named exports present, no
		// `default`. The arm that `import pkg from 'lz-string'` got wrong.
		expect(unwrapInteropDefault<FakeCompressors>(compressors)).toBe(compressors);
	});

	it('falls back when default is present but undefined', () => {
		// 🔴 The case that rules out `'default' in moduleNamespace` as the test. A key check would
		// pass here and return `undefined`, and the caller unpacks the result — so the crash
		// this helper prevents would come straight back through the code written to prevent it.
		const withUndefinedDefault = { ...compressors, default: undefined };

		expect(unwrapInteropDefault<FakeCompressors>(withUndefinedDefault)).toBe(withUndefinedDefault);
	});

	it('is transparent about what it cannot check', () => {
		// ⚠ It cannot tell a wrong `default` from a right one — it is an interop shim, not a
		// validator. Documented by assertion so nobody mistakes it for a type guard: a host that
		// synthesizes a `default` of the wrong shape gets that shape back, unexamined.
		const wrongDefault = { default: { nothingUseful: true }};

		expect(unwrapInteropDefault<FakeCompressors>(wrongDefault)).toStrictEqual({ nothingUseful: true });
	});
});

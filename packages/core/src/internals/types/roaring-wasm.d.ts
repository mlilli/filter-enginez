/**
 * Ambient module declaration for `roaring-wasm` — minimal subset of the surface our
 * `roaringInit` adapter + `BitmapIndex` actually use.
 *
 * @remarks
 * `roaring-wasm` ships its own types in `@types/roaring-wasm`-like distribution channels,
 * but pulling them in adds an extra resolution step that's fragile in a fresh
 * checkout (no `pnpm install` yet). This ambient declares the narrow API surface we
 * touch, so tsc passes even before install. After `pnpm install` the real types take
 * precedence because they're more specific.
 *
 * Mirrors the lz-string / estree / data-full.json ambient-declaration pattern used
 * elsewhere in the monorepo.
 */

declare module 'roaring-wasm' {
	/**
	 * Idempotent async initialization for the WASM library. In Node, auto-resolves
	 * essentially synchronously. In the browser, kicks off the WASM module fetch +
	 * instantiation and resolves when ready.
	 */
	export function roaringLibraryInitialize(): Promise<void>;

	/**
	 * Compressed-bitmap data structure — set of 32-bit unsigned integers. Backed by
	 * CRoaring in WASM linear memory.
	 *
	 * @remarks
	 * Only the methods the engine's `BitmapIndex` calls are declared here. The real
	 * package's surface is broader.
	 */
	export class RoaringBitmap32 {
		readonly size: number;
		constructor(initial?: Uint32Array | readonly number[]);
		add(value: number): this;
		andCardinality(other: RoaringBitmap32): number;
		andInPlace(other: RoaringBitmap32): this;
		clone(): RoaringBitmap32;
		has(value: number): boolean;
		orInPlace(other: RoaringBitmap32): this;
		runOptimize(): boolean;
		toArray(): number[];
	}
}

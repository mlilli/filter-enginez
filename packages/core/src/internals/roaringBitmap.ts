/**
 * The Roaring-bitmap surface the engine uses, declared in core rather than imported from
 * `roaring-wasm`.
 *
 * @remarks
 * `roaring-wasm` is an optional peer dependency, so an app can install core without it. Core's
 * published declarations must then type-check without it too: one `import type` from the library in
 * an exported signature (`BitmapIndex.getBitmap()`, `TextInvertedIndex.queryAllWords()`) puts that
 * import in the emitted `.d.ts`, and an app compiled with `skipLibCheck: false` fails with "Cannot
 * find module 'roaring-wasm'" the moment it imports core. So the types live here, as the subset of
 * the library's `RoaringBitmap32` class the engine calls, and `roaringInit.ts` checks that the
 * loaded library satisfies them. `tests/tooling/lazyDependencies.test.ts` fails if any module in
 * core's source names `roaring-wasm` other than through `import()`.
 *
 * An app that installs `roaring-wasm` and wants the library's full type for a bitmap the engine
 * returns can assert it: the object IS the library's `RoaringBitmap32`.
 *
 * @packageDocumentation
 */

/**
 * A compressed set of 32-bit unsigned integers — the members of `roaring-wasm`'s `RoaringBitmap32`
 * the engine calls. The bitmaps the engine hands out are instances of that class.
 */
export interface RoaringBitmap32 {
	/** How many integers the set holds. */
	readonly size: number;
	/**
	 * Add one integer.
	 *
	 * @param value - The integer
	 * @returns This bitmap
	 */
	add(value: number): this;
	/**
	 * How many integers both sets hold, without building the intersection.
	 *
	 * @param other - The other set
	 * @returns The size of the intersection
	 */
	andCardinality(other: RoaringBitmap32): number;
	/**
	 * Keep only the integers the other set also holds.
	 *
	 * @param other - The other set
	 */
	andInPlace(other: RoaringBitmap32): void;
	/**
	 * A copy of this set.
	 *
	 * @returns The copy, owned by the caller
	 */
	clone(): RoaringBitmap32;
	/**
	 * Whether the set holds an integer.
	 *
	 * @param value - The integer
	 * @returns `true` when it does
	 */
	has(value: number): boolean;
	/**
	 * Add every integer the other set holds.
	 *
	 * @param other - The other set
	 * @returns This bitmap
	 */
	orInPlace(other: RoaringBitmap32): this;
	/**
	 * Compress runs of consecutive integers, which shrinks dense sets.
	 *
	 * @returns `true` when the representation changed
	 */
	runOptimize(): boolean;
	/**
	 * The integers, ascending.
	 *
	 * @returns A new array
	 */
	toArray(): number[];
}

/** The constructor of `roaring-wasm`'s `RoaringBitmap32`, as the engine calls it. */
export type RoaringBitmap32Constructor = new (initial?: Uint32Array | readonly number[]) => RoaringBitmap32;

/**
 * The members of the `roaring-wasm` module namespace the engine uses.
 *
 * @internal
 */
export interface RoaringLibrary {
	/** The bitmap class. */
	readonly RoaringBitmap32: RoaringBitmap32Constructor;
	/**
	 * Instantiate the library's WebAssembly module. Resolves at once when it already is.
	 *
	 * @returns A promise that resolves once bitmaps can be constructed
	 */
	readonly roaringLibraryInitialize: () => Promise<void>;
}

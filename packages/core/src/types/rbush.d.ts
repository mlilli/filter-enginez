/**
 * Type declarations for the `rbush` v4 package, which ships untyped.
 *
 * `@types/rbush` only covers v3 with incompatible signatures, so we declare the
 * minimum surface this codebase touches.
 *
 * **Why a module file + a `paths` mapping (not `declare module 'rbush'`).** Under
 * `moduleResolution: nodenext`, a bare specifier that resolves physically to a real
 * package (`node_modules/rbush/index.js`) does NOT fall back to an ambient
 * `declare module 'rbush'` shim — so an ambient form silently produces TS7016
 * ("could not find a declaration file"). Instead this file is a normal module
 * (top-level `export`), wired in as the types for `import … from 'rbush'` via a
 * `paths` entry. The mapping is type-only; Node's runtime resolution still loads the
 * real `rbush` package. Update if later work reaches for more methods (e.g. `toJSON`
 * / `fromJSON`).
 *
 * **That entry lives in `tsconfig.base.json`, NOT in this package's tsconfig.**
 * `@filter-enginez/core`'s `exports` map points at source, so any program importing
 * core compiles this file too and needs the mapping — a `paths` entry does not travel
 * through an import.
 */

export interface RBushBBox {
	readonly maxX: number;
	readonly maxY: number;
	readonly minX: number;
	readonly minY: number;
}

export default class RBush<T extends RBushBBox> {
	constructor(maxEntries?: number);
	all(): T[];
	clear(): this;
	insert(item: T): this;
	load(items: readonly T[]): this;
	remove(item: T, equalsFn?: (a: T, b: T) => boolean): this;
	search(bbox: { maxX: number; maxY: number; minX: number; minY: number; }): T[];
}

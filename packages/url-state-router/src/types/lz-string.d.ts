/**
 * Ambient type declaration for the two `lz-string` functions the `compact` serializer uses.
 *
 * @remarks
 * The published `lz-string` package ships its own types, but we declare this minimal surface
 * inline so the package typechecks even in environments where `pnpm install` hasn't run. After
 * install the real types take precedence because they're more specific.
 *
 * If the consumer reaches for more of the `lz-string` API (e.g., `compressToBase64` for a
 * different encoding) they import `lz-string` directly; this declaration only covers the
 * URL-state-router's narrow usage.
 */

declare module 'lz-string' {
	/**
	 * Compress a string into a URL-safe encoded form. Output uses an alphabet that fits
	 * directly into a URL component without further percent-encoding.
	 */
	export function compressToEncodedURIComponent(input: string): string;

	/**
	 * Inverse of `compressToEncodedURIComponent`. Returns the empty string on malformed
	 * input (NOT throwing), so the calling serializer wraps with its own validation.
	 */
	export function decompressFromEncodedURIComponent(input: string): string | null;
}

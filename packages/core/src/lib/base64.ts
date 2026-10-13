/**
 * `base64` — a runtime-neutral, isomorphic base64 codec over `Uint8Array`.
 *
 * @remarks
 * Used by `BloomFilter` serialization. Neither `btoa`/`atob` (browser-only globals — banned in
 * the isomorphic core by `no-browser-api-in-core`) nor `Buffer` (Node-only) is used, so this works
 * unchanged in browsers, Node, Deno, Cloudflare Workers, and edge runtimes. It is `core`'s single
 * base64 helper — the shared home for any code that needs to round-trip binary through a JSON-safe
 * string.
 *
 * Standard base64 with `=` padding (RFC 4648 §4). `bytesToBase64` always emits canonical,
 * fully-padded output; `base64ToBytes` requires that canonical shape (length a multiple of 4).
 *
 * @packageDocumentation
 */

/** The 64-character standard base64 alphabet (RFC 4648 §4). Index → output character. */
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 padding character, appended so the encoded length is always a multiple of 4. */
const PADDING_CHARACTER = '=';

/**
 * Map a single base64 character back to its 6-bit value.
 *
 * @param character - One character from the encoded input
 * @returns The character's index in the base64 alphabet (`0`–`63`)
 * @throws Error if the character is not part of the base64 alphabet
 */
function base64CharacterToSextet(character: string): number {
	const sextet = BASE64_ALPHABET.indexOf(character);

	if (sextet === -1) {
		throw new Error(`base64: invalid character '${character}' in encoded input`);
	}

	return sextet;
}

/**
 * Encode a byte array as a canonical, `=`-padded base64 string.
 *
 * @param bytes - The bytes to encode
 * @returns The base64 encoding (empty string for an empty input)
 */
export function bytesToBase64(bytes: Uint8Array): string {
	const byteLength = bytes.length;
	let result = '';
	let index = 0;

	// Consume full 3-byte groups → 4 base64 characters each.
	for (; index + 2 < byteLength; index += 3) {
		/* v8 ignore next -- defensive: noUncheckedIndexedAccess fallbacks; index+2 < byteLength holds in this loop */
		const chunk = ((bytes[index] ?? 0) << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);

		result +=
			BASE64_ALPHABET.charAt((chunk >> 18) & 0x3f) +
			BASE64_ALPHABET.charAt((chunk >> 12) & 0x3f) +
			BASE64_ALPHABET.charAt((chunk >> 6) & 0x3f) +
			BASE64_ALPHABET.charAt(chunk & 0x3f);
	}

	// Handle the trailing 1 or 2 bytes with `=` padding to a 4-character group.
	const remainingBytes = byteLength - index;

	if (remainingBytes === 1) {
		/* v8 ignore next -- defensive: noUncheckedIndexedAccess fallback; remainingBytes === 1 means index < byteLength */
		const chunk = (bytes[index] ?? 0) << 16;

		result += BASE64_ALPHABET.charAt((chunk >> 18) & 0x3f) + BASE64_ALPHABET.charAt((chunk >> 12) & 0x3f);
		result += PADDING_CHARACTER + PADDING_CHARACTER;
	} else if (remainingBytes === 2) {
		/* v8 ignore next -- defensive: noUncheckedIndexedAccess fallbacks; remainingBytes === 2 means index+1 < byteLength */
		const chunk = ((bytes[index] ?? 0) << 16) | ((bytes[index + 1] ?? 0) << 8);

		result +=
			BASE64_ALPHABET.charAt((chunk >> 18) & 0x3f) +
			BASE64_ALPHABET.charAt((chunk >> 12) & 0x3f) +
			BASE64_ALPHABET.charAt((chunk >> 6) & 0x3f);
		result += PADDING_CHARACTER;
	}

	return result;
}

/**
 * Decode a canonical, `=`-padded base64 string back into its bytes.
 *
 * @param base64 - The base64 string to decode (length must be a multiple of 4)
 * @returns The decoded bytes (empty array for an empty input)
 * @throws Error if the input length is not a multiple of 4, or contains a non-alphabet character
 */
export function base64ToBytes(base64: string): Uint8Array {
	if (base64.length === 0) {
		return new Uint8Array(0);
	}

	if (base64.length % 4 !== 0) {
		throw new Error(`base64: encoded input length must be a multiple of 4, got ${base64.length}`);
	}

	// Trailing `=` characters (0, 1, or 2) mark how many bytes the final group omits.
	let paddingCount = 0;

	if (base64.charAt(base64.length - 1) === PADDING_CHARACTER) {
		paddingCount++;
	}

	if (base64.charAt(base64.length - 2) === PADDING_CHARACTER) {
		paddingCount++;
	}

	const byteLength = (base64.length / 4) * 3 - paddingCount;
	const bytes = new Uint8Array(byteLength);
	let byteIndex = 0;

	for (let i = 0; i < base64.length; i += 4) {
		const sextet0 = base64CharacterToSextet(base64.charAt(i));
		const sextet1 = base64CharacterToSextet(base64.charAt(i + 1));
		const character2 = base64.charAt(i + 2);
		const character3 = base64.charAt(i + 3);
		const sextet2 = character2 === PADDING_CHARACTER ? 0 : base64CharacterToSextet(character2);
		const sextet3 = character3 === PADDING_CHARACTER ? 0 : base64CharacterToSextet(character3);
		const chunk = (sextet0 << 18) | (sextet1 << 12) | (sextet2 << 6) | sextet3;

		bytes[byteIndex++] = (chunk >> 16) & 0xff;

		if (character2 !== PADDING_CHARACTER) {
			bytes[byteIndex++] = (chunk >> 8) & 0xff;
		}

		if (character3 !== PADDING_CHARACTER) {
			bytes[byteIndex++] = chunk & 0xff;
		}
	}

	return bytes;
}

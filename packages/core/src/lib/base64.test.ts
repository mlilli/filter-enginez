/**
 * Tests for the isomorphic `base64` codec — `bytesToBase64` + `base64ToBytes`.
 *
 * @remarks
 * Covers the canonical RFC 4648 known-vectors (`f` / `fo` / `foo` → the three padding shapes),
 * a full round-trip across every `length % 3` residue plus the empty input, byte-value fidelity
 * across the whole `0x00`–`0xff` range, and the two decode guards (non-multiple-of-4 length and a
 * non-alphabet character). Together these exercise every branch in both functions.
 */

import { describe, expect, it } from 'vitest';

import { base64ToBytes, bytesToBase64 } from './base64.js';

describe('bytesToBase64', () => {
	it('encodes the canonical RFC 4648 known-vectors with correct padding', () => {
		// 'foo' → no padding, 'fo' → one '=', 'f' → two '='.
		expect(bytesToBase64(new Uint8Array([102, 111, 111]))).toBe('Zm9v');
		expect(bytesToBase64(new Uint8Array([102, 111]))).toBe('Zm8=');
		expect(bytesToBase64(new Uint8Array([102]))).toBe('Zg==');
	});

	it('encodes the empty array as the empty string', () => {
		expect(bytesToBase64(new Uint8Array(0))).toBe('');
	});
});

describe('base64ToBytes', () => {
	it('decodes the canonical RFC 4648 known-vectors across all padding shapes', () => {
		expect([...base64ToBytes('Zm9v')]).toEqual([102, 111, 111]);
		expect([...base64ToBytes('Zm8=')]).toEqual([102, 111]);
		expect([...base64ToBytes('Zg==')]).toEqual([102]);
	});

	it('decodes the empty string to the empty array', () => {
		expect(base64ToBytes('')).toEqual(new Uint8Array(0));
	});

	it('throws on an input length that is not a multiple of 4', () => {
		expect(() => base64ToBytes('Zm9')).toThrow(/multiple of 4/u);
	});

	it('throws on a non-alphabet character', () => {
		expect(() => base64ToBytes('Zm9*')).toThrow(/invalid character/u);
	});
});

describe('base64 round-trip', () => {
	it('round-trips every length-mod-3 residue and the empty input', () => {
		// Lengths 0..5 cover the empty input plus every remainder class (0, 1, 2) at least twice.
		for (let length = 0; length <= 5; length++) {
			const bytes = new Uint8Array(length);

			for (let i = 0; i < length; i++) {
				bytes[i] = (i * 37 + length * 13) & 0xff;
			}

			expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
		}
	});

	it('preserves every byte value across the full 0x00–0xff range', () => {
		const allByteValues = new Uint8Array(256);

		for (let i = 0; i < 256; i++) {
			allByteValues[i] = i;
		}

		expect([...base64ToBytes(bytesToBase64(allByteValues))]).toEqual([...allByteValues]);
	});
});

/**
 * Unit tests for `computeFuzzyTrigramBound` + `maxFuseErrors` — the pure bound math (the adversarial
 * soundness check against real Fuse lives in `fuzzyTrigramBound.pinned.test.ts`).
 *
 * @remarks
 * Covers each bypass regime (too-short, too-long, no-reduction), the applicable `'none'` case, the
 * exact `D − 3e` arithmetic, and `maxFuseErrors` — both that it agrees with `floor(t·m)` on realistic
 * thresholds AND that it returns the correctly-larger (safer) count at a pathological `k/m` threshold
 * where `floor` underflows in floating point.
 */

import { describe, expect, it } from 'vitest';

import { computeFuzzyTrigramBound, maxFuseErrors } from './fuzzyTrigramBound.js';

describe('maxFuseErrors', () => {
	it('agrees with floor(t*m) on realistic thresholds', () => {
		expect(maxFuseErrors(8, 0.1)).toBe(0); // 1/8 = 0.125 > 0.1
		expect(maxFuseErrors(8, 0.4)).toBe(3); // 3/8 = 0.375 <= 0.4 < 4/8
		expect(maxFuseErrors(10, 0.2)).toBe(2); // 2/10 = 0.2 <= 0.2 < 3/10
	});

	it('returns the safe (larger) count at a pathological k/m threshold where floor underflows', () => {
		// t = 15/22: (15/22)*22 rounds below 15 in float64, so floor(t*m) = 14 — one too FEW, which
		// would be unsound. maxFuseErrors evaluates Fuse's exact fl(k/m) <= fl(t) gate and returns 15.
		const threshold = 15 / 22;

		expect(Math.floor(threshold * 22)).toBe(14); // the unsafe proxy
		expect(maxFuseErrors(22, threshold)).toBe(15); // the sound acceptance count
	});
});

describe('computeFuzzyTrigramBound', () => {
	it('applies with a positive minimum at a strict threshold', () => {
		// 'cabernet' (m=8): distinct trigrams cab,abe,ber,ern,rne,net -> D=6.
		// t=0.1 -> maxFuseErrors=0 -> minShared = 6 - 3*0 = 6.
		const bound = computeFuzzyTrigramBound('cabernet', 0.1);

		expect(bound.distinctTrigramCount).toBe(6);
		expect(bound.maxAcceptedErrors).toBe(0);
		expect(bound.minSharedTrigrams).toBe(6);
		expect(bound.shouldBypass).toBe(false);
		expect(bound.bypassReason).toBe('none');
	});

	it('recovers real pruning at t = 0.2 (the tightened bound, no +1 margin)', () => {
		// 'blackberry' (m=10): distinct trigrams bla,lac,ack,ckb,kbe,ber,err,rry = 8.
		// t=0.2 -> maxFuseErrors=2 -> minShared = 8 - 3*2 = 2 > 0 -> applies (would have bypassed under +1).
		const bound = computeFuzzyTrigramBound('blackberry', 0.2);

		expect(bound.distinctTrigramCount).toBe(8);
		expect(bound.maxAcceptedErrors).toBe(2);
		expect(bound.minSharedTrigrams).toBe(2);
		expect(bound.shouldBypass).toBe(false);
		expect(bound.bypassReason).toBe('none');
	});

	it('bypasses (no reduction) at Fuse\'s default threshold 0.4', () => {
		// t=0.4, m=8 -> maxFuseErrors=3 -> minShared = 6 - 9 = -3 <= 0.
		const bound = computeFuzzyTrigramBound('cabernet', 0.4);

		expect(bound.maxAcceptedErrors).toBe(3);
		expect(bound.minSharedTrigrams).toBeLessThanOrEqual(0);
		expect(bound.shouldBypass).toBe(true);
		expect(bound.bypassReason).toBe('no-reduction');
	});

	it('bypasses patterns shorter than a trigram', () => {
		const bound = computeFuzzyTrigramBound('ab', 0.1);

		expect(bound.shouldBypass).toBe(true);
		expect(bound.bypassReason).toBe('pattern-too-short');
	});

	it('bypasses patterns longer than Fuse\'s 32-char Bitap window', () => {
		const bound = computeFuzzyTrigramBound('a'.repeat(40), 0.1);

		expect(bound.shouldBypass).toBe(true);
		expect(bound.bypassReason).toBe('pattern-too-long');
	});
});

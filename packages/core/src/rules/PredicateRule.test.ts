/**
 * Tests for `PredicateRule` — the arbitrary-predicate escape hatch whose `serialize()` always
 * throws.
 *
 * @remarks
 * Covers the `action` delegating to the consumer predicate (both TRUE and FALSE paths, with the
 * predicate receiving the item and the rule itself), and both branches of the overridden
 * `serialize()` throw: the field-hint variant when `field` is a string, and the no-hint variant
 * when `field` is a non-string extractor (function / undefined).
 */

import { describe, expect, it } from 'vitest';

import { PredicateRule } from './PredicateRule.js';

interface Scored {
	readonly score: number;
}

describe('PredicateRule', () => {
	it('passes items for which the predicate returns true', () => {
		const rule = new PredicateRule<Scored>('score', (item) => item.score > 10);

		expect(rule.action({ score: 42 }, rule)).toBe(true);
	});

	it('fails items for which the predicate returns false', () => {
		const rule = new PredicateRule<Scored>('score', (item) => item.score > 10);

		expect(rule.action({ score: 3 }, rule)).toBe(false);
	});

	it('passes the item and the rule itself to the predicate', () => {
		let receivedRule: PredicateRule<Scored> | undefined;
		const rule = new PredicateRule<Scored>('score', (_item, self) => {
			receivedRule = self;

			return true;
		});

		rule.action({ score: 1 }, rule);

		expect(receivedRule).toBe(rule);
	});

	describe('serialize', () => {
		it('throws with a field hint when the field is a string', () => {
			const rule = new PredicateRule<Scored>('score', (item) => item.score > 10);

			expect(() => rule.serialize()).toThrow(
				/^PredicateRule \(field 'score'\) cannot be serialized/,
			);
		});

		it('throws without a field hint when the field is a function', () => {
			const rule = new PredicateRule<Scored>(
				(item) => (item as Scored).score,
				(item) => item.score > 10,
			);

			expect(() => rule.serialize()).toThrow(/^PredicateRule cannot be serialized/);
		});

		it('throws without a field hint when the field is undefined', () => {
			const rule = new PredicateRule<Scored>(undefined, (item) => item.score > 10);

			expect(() => rule.serialize()).toThrow(/^PredicateRule cannot be serialized/);
		});
	});
});

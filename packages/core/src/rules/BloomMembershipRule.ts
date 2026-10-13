/**
 * `BloomMembershipRule` — probabilistic set membership via a serialized Bloom bitset.
 *
 * @remarks
 * The 15th rule in the catalog (per `docs/architecture.md` §8a). It answers _"is this item's field
 * value possibly in set S?"_ against a **prebuilt {@link BloomFilter}** — the intended use is a
 * membership set too large to ship inline (a multi-million-element allow/deny list), where shipping
 * a compact serialized bitset beats shipping the raw set. The bitset **is** the rule's config, so it
 * rides the existing JSON-config / URL-state / worker-bridge / devtools-snapshot round-trip like any
 * other serializable rule.
 *
 * ## It is a PRE-SCREEN — false positives are possible
 *
 * A Bloom filter has **no false negatives** (a value that was added always tests `true`) but a
 * **tunable false-positive rate** (an un-added value may collide on all `k` bits and test `true`
 * anyway). So `action` returning `true` means _"possibly in the set"_, not _"definitely."_ Where a
 * false positive would be incorrect, pair this rule with an exact check downstream (e.g. compose it
 * — via `and(...)` — with an authoritative `InSetRule` / server confirmation), or accept the
 * documented rate as a coarse pre-filter that cheaply prunes the obvious non-members. A `false`
 * result, by contrast, is certain: the value was definitely never added.
 *
 * ## Key coercion contract — READ THIS BEFORE BUILDING THE FILTER
 *
 * {@link BloomFilter} keys on **strings** (`add(value: string)` / `test(value: string)`). This rule
 * therefore coerces every extracted field value with **`String(value)`** before probing the filter.
 * The consumer is responsible for building the filter with the **same** stringified keys — i.e. if
 * your items carry a numeric `id`, populate the filter with `filter.add(String(id))`, because at
 * query time the rule will probe `filter.test(String(item.id))`. A mismatch here (filter built from
 * raw numbers via some other codec, vs. `String(...)` at query time) produces silent all-`false`
 * results — the filter simply never sees a key it recognizes. This is the single most common way to
 * misuse the rule, hence the loud documentation.
 *
 * Coercion specifics: `null` / `undefined` field values short-circuit to `false` (treated as
 * "absent" — never probed). **Non-primitive** values (objects, arrays, functions, symbols) are
 * likewise treated as absent → `false`, since they have no meaningful single string key. Every
 * remaining **primitive** goes through `String(value)`, so `42 → '42'` and `true → 'true'`. If you
 * need to match on something derived from an object/array field, project it to a string first with a
 * function `FieldExtractor` (e.g. `(item) => item.tags.join(',')`) and key the filter identically.
 *
 * ## Prebuilt filters only — the trade-off
 *
 * The constructor and the `bloomMembership` factory accept an **already-constructed**
 * {@link BloomFilter}; there is deliberately **no** "build from a raw item list" convenience.
 * The rule's entire reason to exist is the too-large-to-ship set, which is built once offline (or on
 * a server) and handed to the rule as a compact bitset — an inline-list convenience would invert
 * that premise and widen the API surface for the atypical small-set case (which `InSetRule` already
 * serves better, with exact membership and no false positives). The trade-off: consumers with a
 * modest in-memory set must do the two-step `BloomFilter.forCapacity(n, p)` + `add(...)` themselves.
 *
 * @packageDocumentation
 */

import type { FieldExtractor, FilterRuleAction, SerializedRule } from '../types.js';

import { FilterEngineRuleError } from '../errors/index.js';
import { BloomFilter, type SerializedBloomFilter } from '../lib/BloomFilter.js';
import { isNil } from '../lib/internal.js';
import { FilterRule } from './FilterRule.js';

/**
 * Configuration for `BloomMembershipRule`.
 */
export interface BloomMembershipRuleConfig {
	/**
	 * The prebuilt Bloom filter that answers membership. Its serialized bitset **is** the rule's
	 * serialized config (see {@link BloomMembershipRule.serialize}). Build it with `String(...)`
	 * keys that match what the rule will probe at query time (see the class docs' coercion contract).
	 */
	readonly filter: BloomFilter;
}

/**
 * Filter items by probabilistic membership against a prebuilt Bloom bitset.
 *
 * @example
 *   // Build the filter once (offline / on a server) from the too-large-to-ship id set:
 *   const denyList = BloomFilter.forCapacity(2_000_000, 0.001);
 *   for (const id of bannedAccountIds) {
 *     denyList.add(String(id)); // SAME String(...) keying the rule uses at query time
 *   }
 *
 *   // Then filter with it — a PRE-SCREEN; pair with an exact check where a false positive is unsafe:
 *   engine.addRule('accountId', new BloomMembershipRule('accountId', denyList));
 */
export class BloomMembershipRule extends FilterRule {
	/**
	 * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
	 * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
	 */
	static override readonly ruleTypeName = 'BloomMembershipRule';

	override action: FilterRuleAction = (item, rule): boolean => {
		const value = this.getFieldValue(item);

		// null / undefined are "absent" — never probed. (A Bloom filter has no false negatives, so
		// a genuine absence is certain; this short-circuit just avoids stringifying nullish values.)
		if (isNil(value)) {
			return false;
		}

		// Only primitive field values have a meaningful string key. Anything else (objects, arrays,
		// functions, symbols) can't be sensibly keyed into a string-keyed Bloom filter, so it's
		// treated as absent → false. The explicit primitive allowlist also narrows `value` to a
		// primitive type that `String()` converts safely (no `[object Object]` default).
		if (
			typeof value !== 'string'
			&& typeof value !== 'number'
			&& typeof value !== 'boolean'
			&& typeof value !== 'bigint'
		) {
			return false;
		}

		// KEY COERCION (see class docs): stringify the primitive with String(value) because
		// BloomFilter keys on strings. The consumer MUST have populated the filter with the same
		// String(...) keys, or this silently returns false for everything. A `true` here is
		// "possibly present" (false positives are possible); a `false` is certain.
		return (rule as BloomMembershipRule).config.filter.test(String(value));
	};

	config: BloomMembershipRuleConfig;

	/**
	 * @param field - How to pull the value-to-test from each item
	 * @param filter - A prebuilt {@link BloomFilter} (see the class docs on why v1 takes a prebuilt
	 *   filter rather than a raw item list, and on the `String(...)` keying contract)
	 */
	constructor(field: FieldExtractor, filter: BloomFilter) {
		super(field);
		this.config = { filter };
	}

	/**
	 * Serialize the rule to its JSON-safe shape. The Bloom filter's own
	 * {@link BloomFilter.serialize} (a base64 bitset + `(m, k)` + `itemCount`) becomes the rule's
	 * `config` — the bitset IS the config. The companion {@link BloomMembershipRule.deserialize}
	 * rebuilds the filter via {@link BloomFilter.deserialize}.
	 */
	override serialize(): SerializedRule {
		return {
			config: this.config.filter.serialize(),
			field: typeof this.field === 'function' ? '<function>' : this.field,
			type: BloomMembershipRule.ruleTypeName,
		};
	}

	/**
	 * Reconstruct a `BloomMembershipRule` from its serialized form. Called by
	 * `ruleRegistry.deserialize` when it detects this static hook — the generic deserialize path
	 * can't rebuild a live `BloomFilter` from a base64 bitset (the `BloomFilter.deserialize` runtime
	 * call is required).
	 *
	 * @param json - The serialized rule (its `config` must be a {@link SerializedBloomFilter} shape)
	 * @returns A reconstituted `BloomMembershipRule` whose filter tests identically to the original
	 * @throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` if `json.config`
	 *   doesn't carry the `{ bits, hashCount, sizeBits }` load-bearing fields, or if
	 *   `BloomFilter.deserialize` rejects the payload (its `FilterEngineConfigError` is the `cause`)
	 */
	static deserialize(json: SerializedRule): BloomMembershipRule {
		const serializedConfig: unknown = json.config;

		if (
			serializedConfig === null
			|| typeof serializedConfig !== 'object'
			|| typeof (serializedConfig as { bits?: unknown }).bits !== 'string'
			|| typeof (serializedConfig as { hashCount?: unknown }).hashCount !== 'number'
			|| typeof (serializedConfig as { sizeBits?: unknown }).sizeBits !== 'number'
		) {
			throw new FilterEngineRuleError(
				'RULE_INVALID_SERIALIZED_CONFIG',
				`BloomMembershipRule.deserialize: expected config of shape { bits, hashCount, itemCount, sizeBits }, `
				+ `got ${JSON.stringify(json.config)}`,
			);
		}
		let filter: BloomFilter;

		try {
			filter = BloomFilter.deserialize(serializedConfig as SerializedBloomFilter);
		} catch (cause) {
			throw new FilterEngineRuleError(
				'RULE_INVALID_SERIALIZED_CONFIG',
				'BloomMembershipRule.deserialize: the serialized Bloom filter is corrupt — see `cause`.',
				{ cause },
			);
		}
		const field = json.field === '<function>' ? undefined : json.field;

		return new BloomMembershipRule(field, filter);
	}
}

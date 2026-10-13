/**
 * `RegexRule` — passes items whose extracted string field matches a configured regex.
 *
 * @remarks
 * Power-user filter for IDs, codes, filenames, structured strings. Non-string field values
 * always fail. The regex is consumer-supplied; the rule doesn't try to interpret or sanitize
 * it. Each item is matched from the start of its value: a global (`g`) or sticky (`y`) pattern
 * carries `lastIndex` between `test()` calls, so the rule resets it before every match — the
 * answer for an item never depends on the item evaluated before it.
 *
 * Overrides `serialize()` because RegExp instances aren't JSON-safe — serializes to
 * `{ source, flags }` and reconstructs via `new RegExp(source, flags)` in a custom
 * deserialize.
 *
 * @packageDocumentation
 */

import type { FieldExtractor, FilterRuleAction, SerializedRule } from '../types.js';

import { FilterEngineRuleError } from '../errors/index.js';
import { FilterRule } from './FilterRule.js';

// #region docs:regex-rule
/**
 * Configuration for `RegexRule`.
 */
export interface RegexRuleConfig {
	readonly pattern: RegExp;
}

/**
 * Serialized form of a regex pattern (for JSON round-trip).
 */
export interface RegexRuleSerializedConfig {
	readonly flags: string;
	readonly source: string;
}

/**
 * Filter items by regex match against a string field.
 *
 * @example
 *   // Items whose SKU starts with 'CV1F':
 *   engine.addRule('sku', new RegexRule('sku', { pattern: /^CV1F/ }));
 */
export class RegexRule extends FilterRule {
	/**
	 * Minifier-proof wire name — see {@link FilterRule.ruleTypeName}. Declared as a literal so
	 * `ruleRegistry.register` can reject a key that disagrees with it at compile time.
	 */
	static override readonly ruleTypeName = 'RegexRule';

	override action: FilterRuleAction = (item, rule): boolean => {
		const value = this.getFieldValue(item);

		if (typeof value !== 'string') {
			return false;
		}

		const { pattern } = (rule as RegexRule).config;

		pattern.lastIndex = 0;

		return pattern.test(value);
	};

	config: RegexRuleConfig;

	constructor(field: FieldExtractor, config: RegexRuleConfig) {
		super(field);
		this.config = config;
	}
	// #endregion docs:regex-rule

	/**
	 * Serialize the regex to its `{ source, flags }` JSON-safe form. The companion
	 * `RegexRule.deserialize` (below) reconstructs via `new RegExp(source, flags)`.
	 */
	override serialize(): SerializedRule {
		return {
			config: {
				flags: this.config.pattern.flags,
				source: this.config.pattern.source,
			} satisfies RegexRuleSerializedConfig,
			field: typeof this.field === 'function' ? '<function>' : this.field,
			type: RegexRule.ruleTypeName,
		};
	}

	/**
	 * Reconstruct a `RegexRule` from its serialized form. Called by `ruleRegistry.deserialize`
	 * when it detects this static hook on the rule class — the generic deserialize path can't
	 * rebuild a `RegExp` from `{ source, flags }` since the runtime `RegExp` constructor call
	 * is required.
	 *
	 * @param json - The serialized rule (must be a `RegexRule` shape; consumer is responsible
	 *   for not passing a different rule type's serialization)
	 * @returns A reconstituted `RegexRule` instance
	 * @throws `FilterEngineRuleError` with code `RULE_INVALID_SERIALIZED_CONFIG` if `json.config`
	 *   doesn't carry a valid `{ source, flags }` shape, or if the regex source or flags are
	 *   malformed (the `RegExp` constructor's `SyntaxError` rides along as `cause`)
	 */
	static deserialize(json: SerializedRule): RegexRule {
		const serializedConfig: unknown = json.config;

		if (
			serializedConfig === null
			|| typeof serializedConfig !== 'object'
			|| typeof (serializedConfig as { source?: unknown }).source !== 'string'
		) {
			throw new FilterEngineRuleError(
				'RULE_INVALID_SERIALIZED_CONFIG',
				`RegexRule.deserialize: expected config of shape { source, flags }, got `
				+ `${JSON.stringify(json.config)}`,
			);
		}
		const { flags, source } = serializedConfig as { flags?: unknown; source: string };
		let pattern: RegExp;

		try {
			pattern = new RegExp(source, typeof flags === 'string' ? flags : '');
		} catch (cause) {
			throw new FilterEngineRuleError(
				'RULE_INVALID_SERIALIZED_CONFIG',
				`RegexRule.deserialize: /${source}/ with flags ${JSON.stringify(flags)} is not a valid regular `
				+ `expression in this runtime.`,
				{ cause },
			);
		}
		const field = json.field === '<function>' ? undefined : (json.field);

		return new RegexRule(field, { pattern });
	}
}

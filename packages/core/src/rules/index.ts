/**
 * Barrel export for the rule catalog — all 15 concrete rules + the abstract base + the
 * `CompositeRule` + the `RuleRegistry` + the ergonomic factory functions.
 *
 * @packageDocumentation
 */

// ─── Abstract base ──────────────────────────────────────────────────────────
export { FilterRule } from './FilterRule.js';
export { getRuleTypeName } from './ruleTypeName.js';

// ─── 15 concrete rule classes ──────────────────────────────────────────────
export { ValueRule } from './ValueRule.js';
export { BooleanRule } from './BooleanRule.js';
export { RangeRule, type RangeRuleConfig } from './RangeRule.js';
export {
	type NumericComparisonOp,
	NumericComparisonRule,
	type NumericComparisonRuleConfig,
} from './NumericComparisonRule.js';
export { type ArrayMatch, type ArrayMatchOptions } from './arrayMatch.js';
export { InSetRule, type InSetRuleConfig } from './InSetRule.js';
export { InSetofSetsRule, type InSetofSetsRuleConfig } from './InSetofSetsRule.js';
export { BloomMembershipRule, type BloomMembershipRuleConfig } from './BloomMembershipRule.js';
export {
	type TextSearchMode,
	TextSearchRule,
	type TextSearchRuleConfig,
} from './TextSearchRule.js';
export { FuzzySearchRule, type FuzzySearchRuleConfig } from './FuzzySearchRule.js';
export {
	RegexRule,
	type RegexRuleConfig,
	type RegexRuleSerializedConfig,
} from './RegexRule.js';
export {
	type DateRangePreset,
	DateRangeRule,
	type DateRangeRuleConfig,
	resolvePreset,
} from './DateRangeRule.js';
export {
	HierarchicalRule,
	type HierarchicalRuleConfig,
	type TreeNode,
} from './HierarchicalRule.js';
export {
	type GeoCoords,
	GeoProximityRule,
	type GeoProximityRuleConfig,
	haversineKm,
} from './GeoProximityRule.js';
export { ExistsRule } from './ExistsRule.js';
export { PredicateRule, type PredicateRuleConfig } from './PredicateRule.js';

// ─── Composite (Boolean composition of other rules) ────────────────────────
export {
	CompositeRule,
	type CompositeRuleConfig,
	type CompositionOp,
} from './CompositeRule.js';

// ─── Registry ───────────────────────────────────────────────────────────────
export {
	type RuleClass,
	ruleRegistry,
	RuleRegistry,
	RuleRegistryError,
	type RuleRegistryErrorCode,
} from './ruleRegistry.js';

// ─── Factory functions (ergonomic constructors) ────────────────────────────
export {
	bloomMembership,
	bool,
	dateRange,
	exists,
	fuzzy,
	geo,
	hierarchical,
	inSet,
	inSetofSets,
	numCompare,
	predicate,
	range,
	regex,
	text,
	value,
} from './factories.js';

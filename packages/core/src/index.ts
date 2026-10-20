/**
 * @filter-enginez/core
 *
 * The Filter EngineZ engine — rules, composition, devtools, internal store, action log,
 * four named CS algorithms (Roaring Bitmaps, R-tree, Bayesian co-occurrence, MinHash + LSH).
 * Isomorphic — runs in browsers, Node, Cloudflare Workers, Deno, edge runtimes.
 *
 * @remarks
 * This entry point exports the full rule catalog (15 concrete rules + abstract base +
 * `CompositeRule` + registry + ergonomic factories), composition primitives (`and/or/not`,
 * `FilterGroup` type, expression evaluator, simplifier), storage layer (interface +
 * `MemoryStorageAdapter`; browser adapters via sub-export), internal store + dispatcher +
 * snapshots + action log, devtools coordinator (action log, time-travel, replay, diff, Redux
 * DevTools bridge, persistence), acceleration internals (Roaring bitmap intersection, exclusion
 * graph, simulation cache, R-tree spatial index, inverted text index), JSON config layer, and the
 * main `FilterEngine` class + `createFilterEngine` factory.
 *
 * **Two subsystems ship from subpaths, not from here** — similarity (MinHash + LSH) via
 * `@filter-enginez/core/similarity`, and suggestions (session tracker + Bayesian co-occurrence
 * model + orchestrator) via `@filter-enginez/core/suggestions`. Both are opt-in so that consumers
 * who never call them stop paying for them; see the comment beside the config exports below.
 *
 * See `docs/architecture.md` §2 for the full public API surface and module structure.
 *
 * @packageDocumentation
 */

// #region docs:public-surface
// ─── Rule catalog (15 rules + composite + registry + factories) ────────────
export {
	type ArrayMatch,
	type ArrayMatchOptions,
	bloomMembership,
	BloomMembershipRule,
	type BloomMembershipRuleConfig,
	bool,

	BooleanRule,
	// Composite + composition operators
	CompositeRule,
	type CompositeRuleConfig,
	type CompositionOp,
	dateRange,
	type DateRangePreset,
	DateRangeRule,
	type DateRangeRuleConfig,
	exists,
	ExistsRule,
	// Abstract base
	FilterRule,
	fuzzy,
	FuzzySearchRule,
	type FuzzySearchRuleConfig,
	geo,
	type GeoCoords,
	GeoProximityRule,
	type GeoProximityRuleConfig,
	getRuleTypeName,
	haversineKm,
	hierarchical,
	HierarchicalRule,
	type HierarchicalRuleConfig,
	inSet,
	inSetofSets,
	InSetofSetsRule,
	type InSetofSetsRuleConfig,
	InSetRule,
	type InSetRuleConfig,
	numCompare,
	type NumericComparisonOp,
	NumericComparisonRule,
	type NumericComparisonRuleConfig,
	predicate,

	PredicateRule,
	type PredicateRuleConfig,
	range,

	RangeRule,
	type RangeRuleConfig,
	regex,
	RegexRule,

	type RegexRuleConfig,
	type RegexRuleSerializedConfig,
	resolvePreset,
	type RuleClass,
	// Registry
	ruleRegistry,
	RuleRegistry,
	RuleRegistryError,
	type RuleRegistryErrorCode,
	text,
	type TextSearchMode,
	TextSearchRule,
	type TextSearchRuleConfig,
	type TreeNode,
	// Factory functions (ergonomic constructors)
	value,
	// Concrete rule classes
	ValueRule,
} from './rules/index.js';

// ─── Composition (filter groups + and/or/not + evaluator + simplify) ──────
export {
	and,
	applyExpression,
	evaluateExpression,
	type FilterGroup,
	type FilterGroupCompositionMode,
	type FilterGroupInput,
	not,
	or,
	simplify,
} from './composition/index.js';

// ─── Storage (interface + memory adapter; browser adapters via sub-export) ─
export { MemoryStorageAdapter, type StorageAdapter } from './storage/index.js';

// ─── Internal store (types are public surface; classes exposed for adapters) ─
export {
	type Action,
	type ActionType,
	captureSnapshot,
	Dispatcher,
	type EngineMode,
	type EngineSnapshot,
	InternalStore,
	restoreSnapshot,
} from './store/index.js';

// ─── Devtools (action log, time-travel, diff, replay, Redux DevTools bridge) ─
export {
	ActionLog,
	type ActionLogEntry,
	type ActionLogEntryMeta,
	Devtools,
	type DevtoolsConfig,
	DevtoolsPersistence,
	type DevtoolsPersistenceConfig,
	diff,
	ReduxDevtoolsBridge,
	Replay,
	type ReplayOptions,
	type StateDiffEntry,
	TimeTravel,
} from './devtools/index.js';

// ─── Acceleration internals (BitmapIndex, ExclusionGraph, SimulationCache, R-tree) ─
export {
	type AccelerationMode,
	AUTO_BITMAP_THRESHOLD,
	BitmapIndex,
	ExclusionGraph,
	initializeBitmapAcceleration,
	isBitmapAccelerationReady,
	SimulationCache,
	SpatialIndex,
	type SpatialIndexMode,
	TEXT_INDEX_AUTO_THRESHOLD,
	type TextIndexMode,
	TextInvertedIndex,
} from './internals/index.js';

// ─── Shared types ───────────────────────────────────────────────────────────
export type {
	ChangeEvent,
	ChangeListener,
	FieldExtractor,
	FilterRuleAction,
	RuleId,
	SerializedRule,
	SimulationModification,
	SimulationResult,
	Unsubscribe,
} from './types.js';

// ─── Optional subsystems — NOT here, and deliberately ──────────────────────
//
//   similarity   → '@filter-enginez/core/similarity'   (attachSimilarity)   −1,764 B measured
//   suggestions  → '@filter-enginez/core/suggestions'  (attachSuggestions)  −657 B measured
//
// The caller constructs both (via the attach functions), so `FilterEngine` never imports them and
// consumers who never call them don't ship MinHash, LSH, a session tracker or a Bayesian model.
// Re-exporting either from this file would put those bytes back in every bundle while every other
// test stayed green. `index.test.ts` asserts their ABSENCE for that reason — if you are here to
// "restore a missing export", the export is not missing.

// ─── JSON-driven config (load / export / migrate) ──────────────────────────
export {
	type ConfigMigrationStep,
	ConfigMigrator,
	CURRENT_CONFIG_VERSION,
	defaultMigrator,
	exportConfig,
	type ExportConfigEngineSource,
	type ExportConfigOptions,
	type FilterEngineConfig,
	loadConfig,
	type LoadConfigEngineTarget,
	type LoadConfigOptions,
	resolveConfig,
	type ResolvedConfig,
	type SerializedExpressionNode,
	type SerializedFilterGroup,
} from './config/index.js';

// ─── Errors (one base class, four categories, a machine-readable `code`) ──
export {
	FilterEngineConfigError,
	type FilterEngineConfigErrorCode,
	FilterEngineDestroyedError,
	type FilterEngineDestroyedErrorCode,
	FilterEngineError,
	type FilterEngineErrorCode,
	FilterEngineModeError,
	type FilterEngineModeErrorCode,
	FilterEngineRuleError,
	type FilterEngineRuleErrorCode,
	type FilterEngineRuntimeErrorCode,
} from './errors/index.js';

// ─── Main engine class + factory ───────────────────────────────────────────
export { type AccelerationOptions, FilterEngine, type FilterEngineOptions } from './FilterEngine.js';
export { createFilterEngine } from './createFilterEngine.js';

// ─── Single-round-trip query bundle ─────────────────────────────────────────
export type {
	FilterBundle,
	FilterBundleChipCandidateMeta,
	FilterBundleChipGroupMeta,
	FilterBundleChipGroupQuery,
	FilterBundleFieldMeta,
	FilterBundleFieldQuery,
	FilterBundleQuery,
} from './queryBundle.js';

// ─── Lib helpers ────────────────────────────────────────────────────────────
export { BloomFilter, type BloomFilterOptions, type SerializedBloomFilter } from './lib/BloomFilter.js';
export { LRUCache, LRUCacheNode } from './lib/LRUCache.js';
export { differenceSet, intersectionSet, unionSet } from './lib/setOps.js';
export { getPath, parsePath } from './lib/getPath.js';
// #endregion docs:public-surface

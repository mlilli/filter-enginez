/**
 * @remarks
 * Every place core raises an error, asserted by class, `code`, message and (where one is wrapped)
 * `cause`. The hierarchy's own properties live in `./errors.test.ts`; this file answers "does each
 * failure a consumer can hit arrive as the class and code the architecture doc promises?".
 *
 * Sites asserted elsewhere, beside the code they exercise: the devtools cursor (`ActionLog` /
 * `TimeTravel` tests), WASM init (`roaringInit.test.ts`, which needs a fresh module graph), and
 * IndexedDB (`IndexedDBAdapter.test.ts`, which needs its fake). The destroyed-engine guard has its
 * own suite in `../internals/rejectCallsAfterDestroy.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { and } from '../composition/factories.js';
import { ConfigMigrator } from '../config/ConfigMigrator.js';
import { CURRENT_CONFIG_VERSION } from '../config/FilterEngineConfig.js';
import { loadConfig, resolveConfig } from '../config/loadConfig.js';
import { createFilterEngine } from '../createFilterEngine.js';
import { deserializeSnapshot, serializeSnapshot } from '../devtools/snapshotCodec.js';
import { BloomFilter } from '../lib/BloomFilter.js';
import { BloomMembershipRule } from '../rules/BloomMembershipRule.js';
import { inSet, predicate, value } from '../rules/factories.js';
import { FilterRule } from '../rules/FilterRule.js';
import { RegexRule } from '../rules/RegexRule.js';
import { ruleRegistry, RuleRegistryError } from '../rules/ruleRegistry.js';
import { LSH } from '../similarity/LSH.js';
import { MinHash } from '../similarity/MinHash.js';
import { SimilaritySearch } from '../similarity/SimilaritySearch.js';
import {
	FilterEngineConfigError,
	FilterEngineError,
	FilterEngineModeError,
	FilterEngineRuleError,
} from './index.js';

interface Item {
	readonly color: string;
}

const ITEMS: readonly Item[] = [{ color: 'red' }, { color: 'blue' }];

/**
 * Run `act`, assert it threw, and return the error for further assertions.
 *
 * @param act - The call expected to throw
 * @returns What it threw
 */
function caught(act: () => unknown): unknown {
	try {
		act();
	} catch (error) {
		return error;
	}
	throw new Error('Expected the call to throw, but it returned normally.');
}

/** A rule class that forgot `static readonly ruleTypeName`. */
class NamelessRule extends FilterRule {
	config: unknown = undefined;
}

describe('configuration errors (FilterEngineConfigError)', () => {
	it('loadConfig: an expression leaf naming an undefined rule id → CONFIG_UNKNOWN_RULE_ID', () => {
		const error = caught(() => resolveConfig({
			expression: { ruleId: 'ghost', type: 'rule' },
			rules: [],
			version: CURRENT_CONFIG_VERSION,
		}));

		expect(error).toBeInstanceOf(FilterEngineConfigError);
		expect(error).toMatchObject({ code: 'CONFIG_UNKNOWN_RULE_ID', name: 'FilterEngineConfigError' });
		expect((error as Error).message).toContain("unknown ruleId 'ghost'");
	});

	it('ConfigMigrator: a document newer than the engine → CONFIG_VERSION_UNSUPPORTED', () => {
		const error = caught(() => new ConfigMigrator().migrate({ rules: [], version: CURRENT_CONFIG_VERSION + 1 }));

		expect(error).toBeInstanceOf(FilterEngineConfigError);
		expect(error).toMatchObject({ code: 'CONFIG_VERSION_UNSUPPORTED' });
		expect((error as Error).message).toContain('Upgrade @filter-enginez/core');
	});

	it('ConfigMigrator: a gap in the migration chain → CONFIG_MIGRATION_MISSING', () => {
		const error = caught(() => new ConfigMigrator().migrate({ rules: [], version: 0 }));

		expect(error).toBeInstanceOf(FilterEngineConfigError);
		expect(error).toMatchObject({ code: 'CONFIG_MIGRATION_MISSING' });
		expect((error as Error).message).toContain('missing migration step for version 0 -> 1');
	});

	it.each([
		['sizeBits', (): unknown => new BloomFilter({ hashCount: 1, sizeBits: 0 }), /sizeBits must be a positive integer/],
		['hashCount', (): unknown => new BloomFilter({ hashCount: 0, sizeBits: 8 }), /hashCount must be an integer >= 1/],
		['expectedItemCount', (): unknown => BloomFilter.forCapacity(0, 0.01), /expectedItemCount must be a positive integer/],
		['targetFalsePositiveRate', (): unknown => BloomFilter.forCapacity(10, 1), /targetFalsePositiveRate must be in \(0, 1\)/],
	])('BloomFilter: an invalid %s → BLOOM_FILTER_INVALID_OPTIONS', (_option, act, message) => {
		const error = caught(act);

		expect(error).toBeInstanceOf(FilterEngineConfigError);
		expect(error).toMatchObject({ code: 'BLOOM_FILTER_INVALID_OPTIONS' });
		expect((error as Error).message).toMatch(message);
	});

	it('BloomFilter.deserialize: non-base64 bits → BLOOM_FILTER_INVALID_PAYLOAD, decoder error as cause', () => {
		const error = caught(() => BloomFilter.deserialize({ bits: '!!!!', hashCount: 1, itemCount: 0, sizeBits: 8 }));

		expect(error).toBeInstanceOf(FilterEngineConfigError);
		expect(error).toMatchObject({ code: 'BLOOM_FILTER_INVALID_PAYLOAD' });
		expect((error as Error).cause).toBeInstanceOf(Error);
		expect(((error as Error).cause as Error).message).toContain("invalid character '!'");
	});

	it('BloomFilter.deserialize: a bitset of the wrong length → BLOOM_FILTER_INVALID_PAYLOAD', () => {
		const error = caught(() => BloomFilter.deserialize({ bits: 'AAAA', hashCount: 1, itemCount: 0, sizeBits: 64 }));

		expect(error).toMatchObject({ code: 'BLOOM_FILTER_INVALID_PAYLOAD' });
		expect((error as Error).message).toContain('sizeBits 64 needs 8');
	});

	it.each([
		['MinHash numHashes', (): unknown => new MinHash(0)],
		['LSH numHashes', (): unknown => new LSH(0)],
		['LSH bandSize', (): unknown => new LSH(8, 0)],
		['LSH divisibility', (): unknown => new LSH(10, 3)],
	])('%s out of range → SIMILARITY_INVALID_OPTIONS', (_option, act) => {
		const error = caught(act);

		expect(error).toBeInstanceOf(FilterEngineConfigError);
		expect(error).toMatchObject({ code: 'SIMILARITY_INVALID_OPTIONS' });
	});

	it.each([
		['MinHash.jaccardEstimate', (): unknown => MinHash.jaccardEstimate(new Uint32Array(2), new Uint32Array(3))],
		['LSH.insert', (): unknown => new LSH(4, 2).insert(0, new Uint32Array(3))],
		['LSH.queryCandidates', (): unknown => new LSH(4, 2).queryCandidates(new Uint32Array(3))],
	])('%s with a signature of the wrong length → SIMILARITY_SIGNATURE_MISMATCH', (_site, act) => {
		const error = caught(act);

		expect(error).toBeInstanceOf(FilterEngineConfigError);
		expect(error).toMatchObject({ code: 'SIMILARITY_SIGNATURE_MISMATCH' });
	});

	it('SimilaritySearch: no configuration, or no data accessors → SIMILARITY_NOT_CONFIGURED', () => {
		const unconfigured = new SimilaritySearch<Item>({ getSourceData: () => ITEMS, getSourceDataVersion: () => 1 });
		const withoutAccessors = new SimilaritySearch<Item>({ attributes: ['color']});

		expect(caught(() => unconfigured.findSimilar({ color: 'red' }))).toMatchObject({ code: 'SIMILARITY_NOT_CONFIGURED' });
		expect(caught(() => withoutAccessors.findSimilar({ color: 'red' }))).toMatchObject({ code: 'SIMILARITY_NOT_CONFIGURED' });
	});

	it('SimilaritySearch: a config with neither attributes nor signatureFn → SIMILARITY_INVALID_OPTIONS', () => {
		const search = new SimilaritySearch<Item>({
			config: { threshold: 0.5 },
			getSourceData: () => ITEMS,
			getSourceDataVersion: () => 1,
		});
		const error = caught(() => search.findSimilar({ color: 'red' }));

		expect(error).toBeInstanceOf(FilterEngineConfigError);
		expect(error).toMatchObject({ code: 'SIMILARITY_INVALID_OPTIONS' });
	});
});

describe('rule errors (FilterEngineRuleError)', () => {
	it('ruleRegistry: an unknown type → RuleRegistryError REGISTRY_UNKNOWN_TYPE, a FilterEngineRuleError', () => {
		const error = caught(() => ruleRegistry.deserialize({ config: null, field: 'x', type: 'NoSuchRule' }));

		expect(error).toBeInstanceOf(RuleRegistryError);
		expect(error).toBeInstanceOf(FilterEngineRuleError);
		expect(error).toBeInstanceOf(FilterEngineError);
		expect(error).toMatchObject({ code: 'REGISTRY_UNKNOWN_TYPE', name: 'RuleRegistryError' });
	});

	it('FilterRule.serialize: a class without ruleTypeName → RULE_TYPE_NAME_MISSING', () => {
		const error = caught(() => new NamelessRule('color').serialize());

		expect(error).toBeInstanceOf(FilterEngineRuleError);
		expect(error).toMatchObject({ code: 'RULE_TYPE_NAME_MISSING' });
		expect((error as Error).message).toContain('NamelessRule cannot be serialized');
	});

	it('PredicateRule.serialize → RULE_NOT_SERIALIZABLE', () => {
		const error = caught(() => predicate<Item>('color', (item) => item.color === 'red').serialize());

		expect(error).toBeInstanceOf(FilterEngineRuleError);
		expect(error).toMatchObject({ code: 'RULE_NOT_SERIALIZABLE' });
		expect((error as Error).message).toContain("PredicateRule (field 'color') cannot be serialized");
	});

	it('RegexRule.deserialize: a config without a string source → RULE_INVALID_SERIALIZED_CONFIG', () => {
		const error = caught(() => RegexRule.deserialize({ config: { flags: 'i' }, field: 'color', type: 'RegexRule' }));

		expect(error).toBeInstanceOf(FilterEngineRuleError);
		expect(error).toMatchObject({ code: 'RULE_INVALID_SERIALIZED_CONFIG' });
		expect('cause' in (error as Error)).toBe(false);
	});

	it('RegexRule.deserialize: a malformed pattern → RULE_INVALID_SERIALIZED_CONFIG, SyntaxError as cause', () => {
		const error = caught(() => RegexRule.deserialize({ config: { flags: 'i', source: '(' }, field: 'color', type: 'RegexRule' }));

		expect(error).toBeInstanceOf(FilterEngineRuleError);
		expect(error).toMatchObject({ code: 'RULE_INVALID_SERIALIZED_CONFIG' });
		expect((error as Error).message).toContain('/(/ with flags "i" is not a valid regular expression');
		expect((error as Error).cause).toBeInstanceOf(SyntaxError);
	});

	it('RegexRule.deserialize: invalid flags are refused too, flags omitted or not', () => {
		const badFlags = caught(() => RegexRule.deserialize({ config: { flags: 'zz', source: 'a' }, field: 'color', type: 'RegexRule' }));

		expect(badFlags).toMatchObject({ code: 'RULE_INVALID_SERIALIZED_CONFIG' });
		expect(RegexRule.deserialize({ config: { source: 'a' }, field: 'color', type: 'RegexRule' })).toBeInstanceOf(RegexRule);
	});

	it('BloomMembershipRule.deserialize: a config of the wrong shape → RULE_INVALID_SERIALIZED_CONFIG', () => {
		const error = caught(() => BloomMembershipRule.deserialize({ config: { bits: 1 }, field: 'color', type: 'BloomMembershipRule' }));

		expect(error).toBeInstanceOf(FilterEngineRuleError);
		expect(error).toMatchObject({ code: 'RULE_INVALID_SERIALIZED_CONFIG' });
	});

	it('BloomMembershipRule.deserialize: a corrupt bitset → RULE_INVALID_SERIALIZED_CONFIG, the Bloom error as cause', () => {
		const error = caught(() => BloomMembershipRule.deserialize({
			config: { bits: 'AAAA', hashCount: 1, itemCount: 0, sizeBits: 64 },
			field: 'color',
			type: 'BloomMembershipRule',
		}));

		expect(error).toBeInstanceOf(FilterEngineRuleError);
		expect(error).toMatchObject({ code: 'RULE_INVALID_SERIALIZED_CONFIG' });
		expect((error as Error).cause).toBeInstanceOf(FilterEngineConfigError);
		expect((error as Error).cause).toMatchObject({ code: 'BLOOM_FILTER_INVALID_PAYLOAD' });
	});

	it('snapshotCodec: a persisted expression that revives as a leaf → RULE_INVALID_SERIALIZED_CONFIG', () => {
		const engine = createFilterEngine<Item>({ sourceData: ITEMS });
		const encoded = { ...serializeSnapshot(engine.snapshot()), expression: value('color', 'red').serialize() };
		const error = caught(() => deserializeSnapshot(encoded));

		expect(error).toBeInstanceOf(FilterEngineRuleError);
		expect(error).toMatchObject({ code: 'RULE_INVALID_SERIALIZED_CONFIG' });
		expect((error as Error).message).toContain("must revive as a CompositeRule, got 'ValueRule'");
	});

	it('BitmapIndex.getBitmap: a rule id with no rule → RULE_NOT_FOUND', () => {
		const engine = createFilterEngine<Item>({ sourceData: ITEMS });
		const error = caught(() => engine.bitmapIndex.getBitmap('ghost'));

		expect(error).toBeInstanceOf(FilterEngineRuleError);
		expect(error).toMatchObject({ code: 'RULE_NOT_FOUND' });
		expect((error as Error).message).toContain("rule 'ghost' is not registered");
	});
});

describe('mode errors (FilterEngineModeError)', () => {
	it('addRule while an expression is set → MODE_EXPRESSION_ACTIVE, and the rule is not added', () => {
		const engine = createFilterEngine<Item>({ sourceData: ITEMS });

		engine.setExpression(and(value('color', 'red')));
		const error = caught(() => engine.addRule('color', value('color', 'blue')));

		expect(error).toBeInstanceOf(FilterEngineModeError);
		expect(error).toMatchObject({ code: 'MODE_EXPRESSION_ACTIVE', name: 'FilterEngineModeError' });
		expect((error as Error).message).toContain("FilterEngine.addRule('color') was called in expression mode");
		expect(engine.getRule('color')).toBeUndefined();

		// Leaving expression mode makes the same call valid again.
		engine.setExpression(null);
		engine.addRule('color', value('color', 'blue'));
		expect(engine.getResultCount()).toBe(1);
	});

	it('removeRule and clearRules stay valid in expression mode (cleanup must always work)', () => {
		const engine = createFilterEngine<Item>({ sourceData: ITEMS });

		engine.addRule('color', value('color', 'red'));
		engine.setExpression(and(value('color', 'blue')));
		engine.removeRule('color');
		expect(engine.getRule('color')).toBeUndefined();
		engine.clearRules();

		expect(engine.getExpression()).toBeNull();
	});

	it('loadConfig with clearExisting: false drops an active expression before adding the document rules', () => {
		const source = createFilterEngine<Item>({ sourceData: ITEMS });

		source.addRule('color', inSet('color', ['red']));
		source.setExpression(and(source.getRule('color') as FilterRule));
		const document = source.exportConfig();
		const target = createFilterEngine<Item>({ sourceData: ITEMS });

		target.setExpression(and(value('color', 'blue')));
		loadConfig(target, document, { clearExisting: false });

		expect(target.getExpression()).not.toBeNull();
		expect(target.getResults()).toEqual([{ color: 'red' }]);
	});

	it('loadConfig with clearExisting: false and no document expression refuses rules it would ignore', () => {
		const target = createFilterEngine<Item>({ sourceData: ITEMS });

		target.setExpression(and(value('color', 'blue')));
		const error = caught(() => loadConfig(target, {
			rules: [{ id: 'color', rule: inSet('color', ['red']).serialize() }],
			version: CURRENT_CONFIG_VERSION,
		}, { clearExisting: false }));

		expect(error).toBeInstanceOf(FilterEngineModeError);
		expect(error).toMatchObject({ code: 'MODE_EXPRESSION_ACTIVE' });
	});
});

/**
 * Tests for the engine-state ↔ URL-string serializers — `resolveSerializer` dispatch, the three
 * built-in formats' round-trips (including non-ASCII through the base64url path), and the decode
 * error branches.
 */

import { createFilterEngine, type FilterEngineConfig, range, value } from '@filter-enginez/core';
import { compressToEncodedURIComponent } from 'lz-string';
import { describe, expect, it } from 'vitest';

import {
	type BuiltInSerializerName,
	compactSerializer,
	createTaggedSerializer,
	type EngineStateSerializer,
	humanReadableSerializer,
	jsonBase64Serializer,
	resolveSerializer,
} from './serializers.js';

/** Build a realistic, schema-valid config via a real engine's `exportConfig()`. */
function buildSampleConfig(): FilterEngineConfig {
	const engine = createFilterEngine<{ note: string; price: number }>({
		sourceData: [{ note: 'x', price: 10 }],
	});

	engine.addRule('price', range('price', { max: 100, min: 0 }));
	// Non-ASCII in the config exercises the UTF-8 → base64url path (TextEncoder + char swaps).
	engine.addRule('note', value('note', 'café ☕'));
	const config = engine.exportConfig();

	void engine.destroy();

	return config;
}

const sampleConfig = buildSampleConfig();
const builtIns: readonly EngineStateSerializer[] = [
	jsonBase64Serializer,
	humanReadableSerializer,
	compactSerializer,
];

describe('serializer round-trips', () => {
	for (const serializer of builtIns) {
		it(`${serializer.name} preserves the config through encode → decode`, () => {
			expect(serializer.decode(serializer.encode(sampleConfig))).toEqual(sampleConfig);
		});
	}
});

describe('createTaggedSerializer', () => {
	const formats: readonly BuiltInSerializerName[] = ['compact', 'human-readable', 'json-base64'];

	for (const format of formats) {
		it(`round-trips through the ${format} tag`, () => {
			const tagged = createTaggedSerializer(format);

			expect(tagged.decode(tagged.encode(sampleConfig))).toEqual(sampleConfig);
		});
	}

	it('decode auto-detects the format from the tag, regardless of the instance format', () => {
		// Encoded with human-readable; decoded by a compact-configured instance — the `h~` tag wins,
		// so a link shared in one format still decodes for a reader whose toggle is set to another.
		const written = createTaggedSerializer('human-readable').encode(sampleConfig);

		expect(createTaggedSerializer('compact').decode(written)).toEqual(sampleConfig);
	});

	it('throws when the value has no recognizable format tag', () => {
		expect(() => createTaggedSerializer('compact').decode('nope')).toThrow(expect.objectContaining({
			code: 'URL_STATE_MALFORMED',
			message: expect.stringMatching(/format tag/) as unknown,
			name: 'FilterEngineConfigError',
		}));
	});
});

describe('resolveSerializer', () => {
	it('resolves each built-in name to its serializer instance', () => {
		expect(resolveSerializer('json-base64')).toBe(jsonBase64Serializer);
		expect(resolveSerializer('human-readable')).toBe(humanReadableSerializer);
		expect(resolveSerializer('compact')).toBe(compactSerializer);
	});

	it('passes a custom serializer instance through unchanged', () => {
		const custom: EngineStateSerializer = {
			decode: (serialized): FilterEngineConfig => JSON.parse(serialized) as FilterEngineConfig,
			encode: (config): string => JSON.stringify(config),
			name: 'custom',
		};

		expect(resolveSerializer(custom)).toBe(custom);
	});

	it('throws on an unknown built-in name', () => {
		// `string` widens to the union via a downcast, so this reaches the runtime guard without a
		// double cast (the union alone would make the branch unreachable to TypeScript).
		const bad = 'nope';

		expect(() => resolveSerializer(bad as BuiltInSerializerName)).toThrow(expect.objectContaining({
			code: 'URL_STATE_UNKNOWN_SERIALIZER',
			message: expect.stringMatching(/unknown built-in serializer/) as unknown,
			name: 'FilterEngineConfigError',
		}));
	});
});

describe('decode error branches', () => {
	it('json-base64 throws when the decoded bytes are not valid JSON', () => {
		// base64url of 'x' decodes cleanly, but JSON.parse('x') throws.
		expect(() => jsonBase64Serializer.decode('eA')).toThrow(expect.objectContaining({
			code: 'URL_STATE_MALFORMED',
			message: expect.stringMatching(/failed to decode/) as unknown,
			name: 'FilterEngineConfigError',
		}));
		// The parser's own SyntaxError rides along as the standard `cause`.
		expect(() => jsonBase64Serializer.decode('eA')).toThrow(
			expect.objectContaining({ cause: expect.any(SyntaxError) as unknown }),
		);
	});

	it('human-readable throws when the input is not valid JSON', () => {
		expect(() => humanReadableSerializer.decode('not json {')).toThrow(expect.objectContaining({
			code: 'URL_STATE_MALFORMED',
			message: expect.stringMatching(/failed to parse/) as unknown,
			name: 'FilterEngineConfigError',
		}));
		expect(() => humanReadableSerializer.decode('not json {')).toThrow(
			expect.objectContaining({ cause: expect.any(SyntaxError) as unknown }),
		);
	});

	it('compact throws when decompression fails', () => {
		expect(() => compactSerializer.decode('@@@ not lz @@@')).toThrow(expect.objectContaining({
			code: 'URL_STATE_MALFORMED',
			message: expect.stringMatching(/failed to decompress/) as unknown,
			name: 'FilterEngineConfigError',
		}));
	});

	it('compact throws when the decompressed payload is not JSON', () => {
		const notJson = compressToEncodedURIComponent('not json {');

		expect(() => compactSerializer.decode(notJson)).toThrow(expect.objectContaining({
			code: 'URL_STATE_MALFORMED',
			message: expect.stringMatching(/JSON\.parse failed/) as unknown,
			name: 'FilterEngineConfigError',
		}));
		expect(() => compactSerializer.decode(notJson)).toThrow(
			expect.objectContaining({ cause: expect.any(SyntaxError) as unknown }),
		);
	});
});

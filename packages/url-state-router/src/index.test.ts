/**
 * Tests for the package barrel — the sync component + the serializer surface are re-exported.
 */

import { describe, expect, it } from 'vitest';

import * as urlStateRouter from './index.js';

describe('@filter-enginez/url-state-router barrel', () => {
	it('re-exports the component, the serializers, and the resolver', () => {
		const expectedExports = [
			'FilterEngineUrlSync',
			'compactSerializer',
			'humanReadableSerializer',
			'jsonBase64Serializer',
			'resolveSerializer',
		];

		for (const name of expectedExports) {
			expect(urlStateRouter).toHaveProperty(name);
		}
	});
});

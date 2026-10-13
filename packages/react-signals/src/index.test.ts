/**
 * Tests for the package barrel — every public hook, the provider, and the context are re-exported.
 */

import { describe, expect, it } from 'vitest';

import * as reactSignals from './index.js';

describe('@filter-enginez/react-signals barrel', () => {
	it('re-exports the provider, context, and every public hook', () => {
		const expectedExports = [
			'FilterEngineContext',
			'FilterEngineProvider',
			'useActiveRules',
			'useEngineBusy',
			'useExclusion',
			'useExpression',
			'useFilterEngine',
			'useLastChange',
			'useMode',
			'useResultCount',
			'useResults',
			'useRule',
			'useSimilar',
			'useSimulation',
			'useSuggestedFilters',
			'useUndoRedo',
		];

		for (const name of expectedExports) {
			expect(reactSignals).toHaveProperty(name);
		}
	});
});

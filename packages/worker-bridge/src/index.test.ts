/**
 * Barrel test — asserts the package entry point re-exports its public runtime surface: the two
 * worker-wiring functions, the auto-engagement helper + its default threshold, and the Comlink
 * `proxy` / `transfer` helpers re-exported for the reactive-adapter consumers.
 */

import { describe, expect, it } from 'vitest';

import * as workerBridge from './index.js';

describe('@filter-enginez/worker-bridge barrel', () => {
	it('re-exports the public runtime surface', () => {
		expect(typeof workerBridge.wrapInWorker).toBe('function');
		expect(typeof workerBridge.exposeFilterEngineWorker).toBe('function');
		expect(typeof workerBridge.shouldEngageWorker).toBe('function');
		expect(typeof workerBridge.DEFAULT_AUTO_THRESHOLD).toBe('number');
		expect(typeof workerBridge.proxy).toBe('function');
		expect(typeof workerBridge.transfer).toBe('function');
	});
});

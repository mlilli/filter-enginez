/**
 * @remarks
 * Barrel live-binding test for `devtools/index.ts` — asserts every re-exported runtime symbol is
 * present and points at the real implementation.
 */

import { describe, expect, it } from 'vitest';

import {
	ActionLog,
	Devtools,
	DevtoolsPersistence,
	diff,
	ReduxDevtoolsBridge,
	Replay,
	TimeTravel,
} from './index.js';

describe('devtools barrel', () => {
	it('re-exports all runtime symbols', () => {
		expect(typeof Devtools).toBe('function');
		expect(typeof ActionLog).toBe('function');
		expect(typeof TimeTravel).toBe('function');
		expect(typeof diff).toBe('function');
		expect(typeof Replay).toBe('function');
		expect(typeof ReduxDevtoolsBridge).toBe('function');
		expect(typeof DevtoolsPersistence).toBe('function');
	});
});

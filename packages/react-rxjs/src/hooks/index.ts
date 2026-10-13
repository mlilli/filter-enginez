/**
 * Barrel export for all `react-rxjs` hooks.
 *
 * @packageDocumentation
 */

// Core engine access + state-readout hooks
export { useFilterEngine } from './useFilterEngine.js';
export { useResults } from './useResults.js';
export { useResultCount } from './useResultCount.js';
export { useActiveRules } from './useActiveRules.js';
export { useRule } from './useRule.js';
export { useExpression } from './useExpression.js';
export { useMode } from './useMode.js';
export { type LastChange, useLastChange } from './useLastChange.js';
export { useEngineBusy } from './useEngineBusy.js';

// Advanced acceleration / devtools-driven hooks
export { useSimulation } from './useSimulation.js';
export { type UndoRedoControls, useUndoRedo } from './useUndoRedo.js';
export { type ExclusionMap, useExclusion } from './useExclusion.js';
export { useSuggestedFilters } from './useSuggestedFilters.js';
export { useSimilar } from './useSimilar.js';

// Internal observable helper — exported for advanced consumers writing custom hooks against
// engine streams not covered by the curated set. NOT for everyday use.
export { observableToStoreTuple, useObservable } from './useObservable.js';

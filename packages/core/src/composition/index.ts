/**
 * Barrel export for the composition layer — `FilterGroup` type + `and/or/not` factory
 * functions + the recursive `ExpressionEvaluator` + algebraic `simplify`.
 *
 * @packageDocumentation
 */

export type { FilterGroup, FilterGroupCompositionMode, FilterGroupInput } from './FilterGroup.js';
export { and, not, or } from './factories.js';
export { applyExpression, evaluateExpression } from './ExpressionEvaluator.js';
export { simplify } from './simplify.js';

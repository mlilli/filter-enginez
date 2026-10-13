/**
 * This adapter's wire rehydration — a thin binding over the shared implementation.
 *
 * @remarks
 * The logic lives in `@filter-enginez/worker-bridge`'s `createWireRehydrator`, shared with
 * `reactive-signals`, so both adapters behave identically: on a rehydration failure they warn and
 * fall back to the raw expression.
 *
 * **Why the raw expression, not `null`.** `null` is the flat-map sentinel — it would tell every
 * consumer that no expression is active while the engine is filtering by one, and nothing
 * downstream can detect that, because `null` is a legitimate value. The raw wire object reads
 * correctly for property access, which is what every consumer but `serialize()` actually does.
 *
 * This module is a **named binding** so the adapter's call sites keep their intent-revealing names,
 * and so the adapter name reaches the warning from one place rather than four.
 *
 * @packageDocumentation
 */

import { createWireRehydrator } from '@filter-enginez/worker-bridge';

/**
 * The rehydration pair for this adapter.
 *
 * @remarks
 * Module-scoped rather than per-engine, which is a deliberate trade. The rehydrator dedupes its
 * per-rule warning by id, so one instance here means a rule that fails in engine A stays quiet in
 * engine B within the same process. That is the right call for an app — the warning is about a
 * CONFIG being unserializable, not about a particular engine — and it is why
 * `createWireRehydrator` is a factory rather than a module singleton: a consumer that needs
 * per-instance reporting can build its own.
 */
const rehydrator = createWireRehydrator('createRxJsEngineFromAsync');

/**
 * Rebuild live `FilterRule` instances from the worker's serialized map.
 *
 * @param raw - The rule map as it came off the worker (values are wire-shaped, not instances).
 * @returns The same map with every revivable rule replaced by a live instance.
 */
export const deserializeWireRules = rehydrator.rules;

/**
 * Rebuild a live `CompositeRule` from the worker's serialized expression.
 *
 * @remarks
 * **Why the expression must be rehydrated, not passed through in wire form.** A plain
 * `{ type, config }` object satisfies `CompositeRule` structurally for every read a consumer is
 * likely to make, so the gap is invisible from inside this package. What it does NOT have is
 * `serialize()` — so any consumer that identifies an expression by its serialized shape silently
 * sees nothing.
 *
 * Smart-filter presets are a typical such consumer: matching the committed expression against a
 * preset registry by structural key calls `.serialize()`, often inside a `try`. On a wire-form
 * expression the call throws, the `catch` returns a sentinel, and the derivation yields an empty
 * selection every time — a preset that visibly narrows the results and never lights its own chip.
 * `createSignalsEngineFromAsync` rehydrates through the same shared rehydrator, so both adapters
 * behave identically.
 *
 * @param raw - The expression as it came off the worker, or `null`.
 * @returns A live `CompositeRule`, the raw value if it could not be rebuilt, or `null`.
 */
export const deserializeWireExpression = rehydrator.expression;

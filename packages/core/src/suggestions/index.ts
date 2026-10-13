/**
 * Barrel export for the Bayesian co-occurrence suggestions layer.
 *
 * @remarks
 * Reached as `@filter-enginez/core/suggestions`, NOT from the root barrel. The subpath is the
 * opt-in: a consumer who never asks "what filter should I offer next?" stops shipping the session
 * tracker, the co-occurrence model and the orchestrator — 657 B gzipped, measured. See
 * {@link attachSuggestions} for why the engine does not own these as properties.
 *
 * @packageDocumentation
 */

export { type AttachedSuggestions, attachSuggestions } from './attachSuggestions.js';
export { type SessionRecord, SessionTracker } from './SessionTracker.js';
export { BayesianModel } from './BayesianModel.js';
export { SuggestionEngine, type SuggestionResult } from './SuggestionEngine.js';

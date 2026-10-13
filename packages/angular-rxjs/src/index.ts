/**
 * @filter-enginez/angular-rxjs
 *
 * Angular dependency-injection bindings over `@filter-enginez/reactive-rxjs`.
 *
 * @remarks
 * **The smallest binding package in the monorepo, by design.** `vue-signals`, `svelte-signals`, and
 * `react-signals` each exist to bridge a framework's own reactivity primitive to
 * `@preact/signals-core`. Angular needs no such bridge: `reactive-rxjs` publishes `Observable`s, which
 * Angular consumes natively via the `async` pipe (or `toSignal`, at the app's discretion). So the only
 * genuine gap is *getting the engine into components* — dependency injection — and that is all this
 * package does.
 *
 * Two consequences worth knowing:
 *
 *   - There is no wrapper type. Components hold an `RxJsEngine<T>` directly and read its `$` streams,
 *     so everything documented for `reactive-rxjs` applies verbatim — including the replay contract
 *     (every stream is a seeded `BehaviorSubject`, so `| async` renders on the first tick and
 *     `toSignal(…, { requireSync: true })` is legal).
 *   - The write path is the plain engine: `engine.core.addRule(…)`. Identical to every other framework binding.
 *
 * @packageDocumentation
 */

export { ENGINE_BUSY, injectEngineBusy, provideEngineBusy } from './provideEngineBusy.js';
export {
	FILTER_ENGINE,
	injectFilterEngine,
	provideFilterEngine,
	provideFilterEngineFactory,
} from './provideFilterEngine.js';

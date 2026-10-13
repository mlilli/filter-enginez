/**
 * @filter-enginez/redux-bridge
 *
 * Optional Redux mirror slice + middleware + attach-orchestrator. One-way sync — engine is
 * source of truth, Redux is a read-only mirror. Two valid write paths: directly via the
 * engine reference, OR dispatch through the optional forwarding middleware. The mirror is
 * never mutated outside the bridge (enforced statically by
 * `@filter-enginez/eslint-plugin/no-direct-mirror-mutation`). Isomorphic.
 *
 * @remarks
 * Exports the slice factory (`createSlice` body with the single `stateUpdated` reducer), the
 * forwarding middleware (the method-dispatch switch routing forwarded actions to the engine), and
 * the attach orchestrator (`fullSnapshot` + per-event `partialFor` + the subscribe-to-dispatch
 * loop).
 *
 * See `docs/architecture.md` §13.
 *
 * @packageDocumentation
 */

export {
	type FilterEngineMirrorState,
	type FilterEngineMirrorStateUpdate,
	INITIAL_MIRROR_STATE,
} from './MirrorState.js';

export {
	createFilterEngineSlice,
	type CreateFilterEngineSliceOptions,
	type FilterEngineSlice,
	type FilterEngineSliceActions,
} from './createFilterEngineSlice.js';

export {
	createFilterEngineMiddleware,
	type CreateFilterEngineMiddlewareOptions,
	type FilterEngineForwardEnvelope,
	FORWARD_ACTION_PREFIX_DEFAULT,
	type ForwardableMethod,
	type ForwardAction,
	type ForwardPayload,
	forwardToEngine,
	type Middleware,
} from './createFilterEngineMiddleware.js';

export {
	attachEngineToStore,
	type AttachEngineToStoreOptions,
	type ReduxStoreShape,
} from './attachEngineToStore.js';

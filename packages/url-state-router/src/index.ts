/**
 * @filter-enginez/url-state-router
 *
 * `react-router`-based URL serialization for filter state. Bidirectional sync (engine →
 * URL, URL → engine) with origin-tracking to prevent infinite loops. `replace` history mode
 * for filter changes, `push` for route changes. Browser-only.
 *
 * @remarks
 * Exports the `<FilterEngineUrlSync>` component and the serializer surface (three built-ins
 * + the extension contract). See `docs/architecture.md` §14.
 *
 * @packageDocumentation
 */

export {
	FilterEngineUrlSync,
	type FilterEngineUrlSyncProps,
} from './FilterEngineUrlSync.js';

export {
	type BuiltInSerializerName,
	compactSerializer,
	createTaggedSerializer,
	type EngineStateSerializer,
	humanReadableSerializer,
	jsonBase64Serializer,
	resolveSerializer,
} from './serializers.js';

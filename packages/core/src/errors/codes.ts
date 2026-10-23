/**
 * The machine-readable `code` unions of the engine's error hierarchy, one per category.
 *
 * @remarks
 * Kept apart from the classes so a consumer can import the unions for an exhaustive `switch`
 * without a runtime dependency, and so `RuleRegistryErrorCode` can be derived from
 * {@link FilterEngineRuleErrorCode} rather than restated.
 *
 * @packageDocumentation
 */

/**
 * Codes carried by `FilterEngineConfigError` — a configuration value, document or option
 * object the engine was handed is invalid, or the code that consumes the engine was wired wrong.
 */
export type FilterEngineConfigErrorCode =
	| 'BINDING_ENGINE_NOT_PROVIDED'
	| 'BLOOM_FILTER_INVALID_OPTIONS'
	| 'BLOOM_FILTER_INVALID_PAYLOAD'
	| 'CONFIG_MIGRATION_MISSING'
	| 'CONFIG_UNKNOWN_RULE_ID'
	| 'CONFIG_VERSION_UNSUPPORTED'
	| 'SIMILARITY_INVALID_OPTIONS'
	| 'SIMILARITY_NOT_CONFIGURED'
	| 'SIMILARITY_SIGNATURE_MISMATCH'
	| 'URL_STATE_MALFORMED'
	| 'URL_STATE_UNKNOWN_SERIALIZER'
	| 'WORKER_FACTORY_NOT_FOUND';

/**
 * Codes carried by `FilterEngineRuleError` — a rule class or a rule's serialized form is
 * unusable. The `REGISTRY_*` codes are the subset `RuleRegistryError` carries.
 */
export type FilterEngineRuleErrorCode =
	| 'REGISTRY_DUPLICATE'
	| 'REGISTRY_TYPE_NAME_MISMATCH'
	| 'REGISTRY_UNKNOWN_TYPE'
	| 'RULE_INVALID_SERIALIZED_CONFIG'
	| 'RULE_NOT_FOUND'
	| 'RULE_NOT_SERIALIZABLE'
	| 'RULE_TYPE_NAME_MISSING';

/**
 * Codes carried by `FilterEngineModeError` — the call is valid in general but not in the
 * engine's current mode: expression mode, a worker-backed engine, a worker host whose engine
 * does not exist yet (or already does), or a bitmap requested before the Roaring library loaded.
 */
export type FilterEngineModeErrorCode =
	| 'MODE_ACCELERATION_NOT_READY'
	| 'MODE_EXPRESSION_ACTIVE'
	| 'MODE_WORKER_ALREADY_INITIALIZED'
	| 'MODE_WORKER_NOT_INITIALIZED'
	| 'MODE_WORKER_UNSUPPORTED';

/** Codes carried by `FilterEngineDestroyedError` — a method was called after `destroy()`. */
export type FilterEngineDestroyedErrorCode = 'ENGINE_DESTROYED';

/**
 * Codes raised as a bare `FilterEngineError` — runtime failures that are not caused by how the
 * engine was configured or called: the environment refused an operation (storage, the Redux
 * DevTools extension, a worker that did not load, the WASM module), or a devtools cursor pointed
 * outside the action log.
 */
export type FilterEngineRuntimeErrorCode =
	| 'ACCELERATION_INIT_FAILED'
	| 'DEVTOOLS_EXTENSION_FAILED'
	| 'DEVTOOLS_INDEX_OUT_OF_RANGE'
	| 'DEVTOOLS_PERSISTENCE_FAILED'
	| 'STORAGE_OPERATION_FAILED'
	| 'STORAGE_UNAVAILABLE'
	| 'WORKER_LOAD_FAILED';

/** Every code any `FilterEngineError` can carry. Switch on it for exhaustive handling. */
export type FilterEngineErrorCode =
	| FilterEngineConfigErrorCode
	| FilterEngineDestroyedErrorCode
	| FilterEngineModeErrorCode
	| FilterEngineRuleErrorCode
	| FilterEngineRuntimeErrorCode;

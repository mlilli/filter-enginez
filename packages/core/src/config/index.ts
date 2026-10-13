/**
 * Barrel export for the JSON-driven config layer.
 *
 * @remarks
 * Backs `engine.loadConfig(...)` and `engine.exportConfig(...)` — the third engine mode
 * (alongside flat-map and expression modes per `docs/architecture.md` §9), primary integration
 * path for backend-driven filter UX.
 *
 * @packageDocumentation
 */

export {
	CURRENT_CONFIG_VERSION,
	type FilterEngineConfig,
	type SerializedExpressionNode,
	type SerializedFilterGroup,
} from './FilterEngineConfig.js';

export {
	loadConfig,
	type LoadConfigEngineTarget,
	type LoadConfigOptions,
	resolveConfig,
	type ResolvedConfig,
} from './loadConfig.js';

export {
	exportConfig,
	type ExportConfigEngineSource,
	type ExportConfigOptions,
} from './exportConfig.js';

export {
	type ConfigMigrationStep,
	ConfigMigrator,
	defaultMigrator,
} from './ConfigMigrator.js';

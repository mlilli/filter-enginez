/**
 * Generic MSW handler factory — produces the standard CRUD + pagination + full-tier-lazy-
 * load + slow/fail simulator handlers for a dataset, parameterized over the dataset's URL
 * path, type, default records, full-tier loader, and filter config.
 *
 * @remarks
 * Per-dataset handlers with copy-pasted CRUD code would be three datasets × six handlers ×
 * near-identical bodies — 18 functions with the same shape. This factory captures the shape once;
 * each dataset supplies its identity fields.
 *
 * @packageDocumentation
 */

import type { FilterEngineConfig } from '@filter-enginez/core';

import { delay, http, type HttpHandler, HttpResponse } from 'msw';

import type { BaseRecord, DatasetMissingError, PagedResponse } from './shared.js';

/**
 * Minimal structural shape for an MSW `RequestHandler`. We re-export `HttpHandler` from MSW
 * under this name so downstream consumers can build their own handler arrays without taking
 * a direct MSW type dependency (handy when their own type layout is unusual).
 */
export type MswHandlerLike = HttpHandler;

/**
 * Configuration for `createDatasetHandlers`.
 */
export interface DatasetHandlerOptions<T extends BaseRecord> {
	/**
	 * URL path prefix — `/api/wine` produces `/api/wine`, `/api/wine/:id`,
	 * `/api/wine/filter-config`, `/api/wine-slow`, `/api/wine-fail`.
	 */
	readonly basePath: string;

	/**
	 * Lazy-loader for the default-tier records (the ~10k). A function (not an eager array) so that
	 * importing a dataset's handlers doesn't force its corpus to be materialized at module load —
	 * the load happens on the first request and is then memoized. Keeps MSW setup cheap and, for
	 * wine, avoids dragging the ~9 MB default JSON into the main-thread transform graph. May return
	 * the records synchronously (datasets whose default tier is a cheap in-memory generation) or a
	 * promise (wine's dynamic-import loader) — the factory normalizes both.
	 */
	readonly loadDefaultRecords: () => Promise<readonly T[]> | readonly T[];

	/**
	 * Lazy-loader for the full-tier corpus. Returns `null` if not available (not generated locally,
	 * or — like wine over MSW — deliberately not served in this environment); the handler then 404s
	 * with a `DatasetMissingError` body. Sync or async; the factory normalizes both.
	 */
	readonly loadFullRecords: () => Promise<null | readonly T[]> | null | readonly T[];

	/**
	 * Lazy-loader for the dataset's `FilterEngineConfig` — served by the `/filter-config` handler.
	 * Lazy (and memoized) for the same import-safety reason as `loadDefaultRecords`: a config derived
	 * from the corpus must not force the corpus to load at handler-import time. Sync or async; the
	 * factory normalizes both.
	 */
	readonly loadFilterConfig: () => FilterEngineConfig | Promise<FilterEngineConfig>;

	/** Simulated network delay (ms) for the `${basePath}-slow` handler. Default 2000. */
	readonly slowDelayMs?: number;

	/**
	 * Per-page artificial delay (ms) applied to the main list endpoint, so a paginated consumer
	 * loop reads as realistic incremental streaming rather than an instant local response. Default
	 * `0` (no delay — existing consumers + tests are unaffected). The `-slow` variant is unaffected;
	 * it keeps its own `slowDelayMs`.
	 */
	readonly pageDelayMs?: number;
}

/**
 * Resolve `?limit=` and `?offset=` query params with sensible defaults + bounds.
 *
 * @internal
 */
function parsePaginationParams(url: URL): { readonly limit: number; readonly offset: number } {
	const limitRaw = url.searchParams.get('limit');
	const offsetRaw = url.searchParams.get('offset');
	// Defaults: 50 items per page, starting at offset 0. Cap limit at 500 so a single
	// request can't ask for an unreasonable slice (prevents accidental performance footguns
	// in consumer code).
	const limit = Math.min(500, Math.max(1, Number.parseInt(limitRaw ?? '50', 10) || 50));
	const offset = Math.max(0, Number.parseInt(offsetRaw ?? '0', 10) || 0);

	return { limit, offset };
}

/**
 * Resolve `?tier=` query param to the canonical tier the consumer asked for.
 *
 * @internal
 */
function parseTierParam(url: URL): 'default' | 'full' {
	return url.searchParams.get('tier') === 'full' ? 'full' : 'default';
}

/**
 * Build the standard handler array for a dataset.
 *
 * Handlers produced (path-order matters — more specific paths come first so MSW's match
 * algorithm picks them before the generic `:id` parameter handler):
 *
 *   - `GET ${basePath}/filter-config` — the `FilterEngineConfig` JSON
 *   - `GET ${basePath}-slow` — list with simulated delay (resilience testing)
 *   - `GET ${basePath}-fail` — always returns 503 (error-state testing)
 *   - `GET ${basePath}/:id` — single record by id (404 with descriptive body when not found)
 *   - `GET ${basePath}` — list (paginated via `?limit=&offset=`, full-tier via `?tier=full`)
 *
 * @typeParam T - The dataset record type
 * @param options - Dataset-specific configuration
 * @returns Array of MSW request handlers ready to pass to `setupWorker` or `setupServer`
 */
export function createDatasetHandlers<T extends BaseRecord>(
	options: DatasetHandlerOptions<T>,
): readonly MswHandlerLike[] {
	const {
		basePath,
		loadDefaultRecords,
		loadFilterConfig,
		loadFullRecords,
		pageDelayMs = 0,
		slowDelayMs = 2000,
	} = options;

	// Memoize the lazy loaders so repeated requests pay the load exactly once. `Promise.resolve`
	// normalizes the sync-or-async return of each loader into a single cached promise.
	let defaultRecordsPromise: Promise<readonly T[]> | null = null;
	const getDefaultRecords = async (): Promise<readonly T[]> => {
		defaultRecordsPromise ??= Promise.resolve(loadDefaultRecords());

		return defaultRecordsPromise;
	};
	let filterConfigPromise: Promise<FilterEngineConfig> | null = null;
	const getFilterConfig = async (): Promise<FilterEngineConfig> => {
		filterConfigPromise ??= Promise.resolve(loadFilterConfig());

		return filterConfigPromise;
	};

	/**
	 * Lazily resolve the records for the requested tier. Default tier resolves the memoized default
	 * loader; full tier calls the consumer-supplied loader, which may return `null` when the full
	 * corpus hasn't been generated locally — in which case we return a descriptive 404 body so the
	 * consumer's error UI can tell the user how to recover.
	 */
	async function getRecordsForTier(
		tier: 'default' | 'full',
	): Promise<{ readonly error: DatasetMissingError } | { readonly records: readonly T[] }> {
		if (tier === 'default') {
			return { records: await getDefaultRecords() };
		}
		const full = await loadFullRecords();

		if (full !== null) {
			return { records: full };
		}

		return {
			error: {
				code: 'DATASET_NOT_GENERATED',
				hint: 'Run `pnpm regen:mock-data --full` to materialize the full corpus, then retry the request.',
				message: `The full-tier dataset for ${basePath} hasn't been generated locally.`,
			},
		};
	}

	/**
	 * Build the standard list response for the given `?tier`, `?limit`, `?offset`. Shared
	 * between the list endpoint and the slow-variant endpoint — only the surrounding `delay`
	 * differs.
	 */
	async function buildListResponse(url: URL): Promise<Response> {
		const tier = parseTierParam(url);
		const result = await getRecordsForTier(tier);

		if ('error' in result) {
			return HttpResponse.json(result.error, { status: 404 });
		}
		// Per-page streaming latency (opt-in; default 0). Lets a paginated consumer loop render
		// incremental progress instead of an instant local response.
		if (pageDelayMs > 0) {
			await delay(pageDelayMs);
		}
		const { limit, offset } = parsePaginationParams(url);
		const pageItems = result.records.slice(offset, offset + limit);
		const body: PagedResponse<T> = {
			items: pageItems,
			limit,
			offset,
			total: result.records.length,
		};

		return HttpResponse.json(body);
	}

	return [
		// ─── /filter-config ────────────────────────────────────────────────
		// Must come BEFORE the `/:id` route so MSW doesn't try to interpret `filter-config`
		// as an id and 404 it.
		http.get(`${basePath}/filter-config`, async () => HttpResponse.json<FilterEngineConfig>(await getFilterConfig())),

		// ─── -slow variant ─────────────────────────────────────────────────
		// Same shape as the list endpoint but with a built-in delay — drive consumer loading
		// states + retry policy testing. The slow path is a sibling of basePath, not a child,
		// so the route is `${basePath}-slow` (e.g., `/api/wine-slow`).
		http.get(`${basePath}-slow`, async ({ request }) => {
			await delay(slowDelayMs);

			return buildListResponse(new URL(request.url));
		}),

		// ─── -fail variant ─────────────────────────────────────────────────
		// Always 503, useful for "service unavailable" UI testing. JSON body so consumer
		// error handlers can show a structured message.
		http.get(`${basePath}-fail`, () =>
			HttpResponse.json(
				{ code: 'SERVICE_UNAVAILABLE', message: 'Simulated 503 — this is the -fail handler.' },
				{ status: 503 },
			),
		),

		// ─── /:id (single record) ──────────────────────────────────────────
		// Looks up the record in the default tier; for full-tier lookup the consumer should
		// fetch the list with `?tier=full` and resolve locally. (Single-record handlers don't
		// usually need full-tier semantics; the cost of loading the full corpus to look up one
		// record would dwarf the benefit.)
		http.get(`${basePath}/:id`, async ({ params }) => {
			const id = String(params['id']);
			const record = (await getDefaultRecords()).find((r) => r.id === id);

			if (record === undefined) {
				return HttpResponse.json(
					{ code: 'NOT_FOUND', message: `No record with id '${id}' in ${basePath}.` },
					{ status: 404 },
				);
			}

			return HttpResponse.json(record);
		}),

		// ─── List (default; supports ?tier=full, ?limit, ?offset) ─────────
		http.get(basePath, async ({ request }) => buildListResponse(new URL(request.url))),
	];
}

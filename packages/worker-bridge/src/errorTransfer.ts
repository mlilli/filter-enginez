/**
 * `installErrorTransferHandler` — keep a thrown `FilterEngineError` intact across the worker
 * boundary: same class, same `name`, `code`, `message` and `cause`.
 *
 * @remarks
 * **The problem.** Comlink ships a rejection to the other side through its built-in `'throw'`
 * transfer handler, which serializes an `Error` as `{ message, name, stack }` and rebuilds it as a
 * plain `Error`. So by default an engine error raised inside the worker reaches the main thread
 * with its `name` but without its class or `code`, and `instanceof FilterEngineError` or a
 * `switch` on `error.code` silently stops matching for every worker-backed engine.
 *
 * **The handler.** This module replaces the `'throw'` entry with a superset of Comlink's own handler.
 * Serializing, it also writes `code` (when the error has a string one) and `cause` (Error causes
 * recursively, primitive causes as-is; anything else is not structured-clone safe and is dropped).
 * Deserializing, it rebuilds the matching class from `@filter-enginez/core`, keyed on the `name`
 * literal each class pins (see core's `defineErrorName`), and restores the worker-side stack. A
 * thrown non-`Error` value, and the wire shape of any error without a known class, keep Comlink's
 * own behavior.
 *
 * **Why it is global, and why that is safe.** `transferHandlers` is Comlink's module-level registry,
 * so both `exposeFilterEngineWorker` (worker side) and `wrapInWorker` (main thread) install the
 * handler before they talk. Every other Comlink user in the same bundle keeps Comlink's semantics,
 * plus `code` and `cause` on errors that carry them — nothing they relied on changes.
 *
 * @packageDocumentation
 */

import {
	FilterEngineConfigError,
	FilterEngineDestroyedError,
	FilterEngineError,
	type FilterEngineErrorCode,
	FilterEngineModeError,
	FilterEngineRuleError,
	RuleRegistryError,
} from '@filter-enginez/core';
import { type TransferHandler, transferHandlers } from 'comlink';

/** What Comlink hands the `'throw'` handler: the thrown value, wrapped. */
interface ThrownValue {
	readonly value: unknown;
}

/** What crosses `postMessage` — Comlink's own serialized-throw shape. */
interface SerializedThrow {
	readonly isError: boolean;
	readonly value: unknown;
}

/** The structured-clone-safe projection of an `Error`. */
interface WireError {
	readonly cause?: unknown;
	readonly code?: string;
	readonly message: string;
	readonly name: string;
	readonly stack?: string;
}

/** The one constructor shape every class in core's error hierarchy shares. */
type FilterEngineErrorClass = new (
	code: FilterEngineErrorCode,
	message: string,
	options?: ErrorOptions,
) => FilterEngineError;

/**
 * The classes a wire error can be rebuilt as, keyed by the `name` literal each one pins. Spelled out
 * as string literals rather than read from `Class.name`, which a minifier rewrites.
 */
const ERROR_CLASSES_BY_NAME: ReadonlyMap<string, FilterEngineErrorClass> = new Map<string, FilterEngineErrorClass>([
	['FilterEngineConfigError', FilterEngineConfigError],
	['FilterEngineDestroyedError', FilterEngineDestroyedError],
	['FilterEngineError', FilterEngineError],
	['FilterEngineModeError', FilterEngineModeError],
	['FilterEngineRuleError', FilterEngineRuleError],
	['RuleRegistryError', RuleRegistryError],
]);

/** How many `cause` links are followed — a bound, so a cyclic cause chain cannot recurse forever. */
const MAX_CAUSE_DEPTH = 8;

/**
 * Comlink's own `'throw'` handler, captured before this module replaces it. Comlink registers it
 * while its module evaluates, so it is always present by the time this line runs; the cast states
 * that guarantee rather than inventing a fallback no runtime can reach.
 */
const comlinkThrowHandler = transferHandlers.get('throw') as TransferHandler<ThrownValue, SerializedThrow>;

/**
 * Project a `cause` onto something `postMessage` can clone.
 *
 * @param cause - Whatever the error carried as `cause`
 * @param depth - How many links deep this cause sits
 * @returns A wire error, the primitive itself, or `undefined` when neither is safe
 */
function toWireCause(cause: unknown, depth: number): unknown {
	if (cause instanceof Error) {
		return depth < MAX_CAUSE_DEPTH ? toWireError(cause, depth + 1) : { message: cause.message, name: cause.name };
	}
	if (cause === null || (typeof cause !== 'object' && typeof cause !== 'function' && typeof cause !== 'symbol')) {
		return cause;
	}

	return undefined;
}

/**
 * Project an `Error` onto its structured-clone-safe wire shape.
 *
 * @param error - The error to project
 * @param depth - How many `cause` links deep this error sits
 * @returns The wire shape, with `code` and `cause` only when the error has them
 */
function toWireError(error: Error, depth: number): WireError {
	const code: unknown = (error as { code?: unknown }).code;

	return {
		message: error.message,
		name: error.name,
		...(error.stack === undefined ? {} : { stack: error.stack }),
		...(typeof code === 'string' ? { code } : {}),
		...('cause' in error ? { cause: toWireCause(error.cause, depth) } : {}),
	};
}

/**
 * Whether a deserialized value has the wire-error shape.
 *
 * @param value - A value read off the wire
 * @returns `true` for an object carrying string `message` and `name`
 */
function isWireError(value: unknown): value is WireError {
	return typeof value === 'object'
		&& value !== null
		&& typeof (value as { message?: unknown }).message === 'string'
		&& typeof (value as { name?: unknown }).name === 'string';
}

/**
 * Rebuild an `Error` from its wire shape — the matching core class when `name` and `code` identify
 * one, a plain `Error` carrying the same fields otherwise.
 *
 * @param wire - The wire shape produced by {@link toWireError}
 * @returns The rebuilt error, with the worker-side stack restored
 */
function fromWireError(wire: WireError): Error {
	const options = 'cause' in wire ? { cause: isWireError(wire.cause) ? fromWireError(wire.cause) : wire.cause } : undefined;
	const ErrorClass = wire.code === undefined ? undefined : ERROR_CLASSES_BY_NAME.get(wire.name);
	let error: Error;

	if (ErrorClass === undefined) {
		error = Object.assign(new Error(wire.message, options), { name: wire.name }, wire.code === undefined ? {} : { code: wire.code });
	} else {
		error = new ErrorClass(wire.code as FilterEngineErrorCode, wire.message, options);
	}
	if (wire.stack !== undefined) {
		error.stack = wire.stack;
	}

	return error;
}

/** Comlink's `'throw'` handler, extended to carry `code`, `cause` and the error class. */
const errorTransferHandler: TransferHandler<ThrownValue, SerializedThrow> = {
	canHandle: (value: unknown): value is ThrownValue => comlinkThrowHandler.canHandle(value),
	deserialize(serialized: SerializedThrow): ThrownValue {
		if (serialized.isError && isWireError(serialized.value)) {
			throw fromWireError(serialized.value);
		}

		return comlinkThrowHandler.deserialize(serialized);
	},
	serialize(thrown: ThrownValue): [SerializedThrow, Transferable[]] {
		if (thrown.value instanceof Error) {
			return [{ isError: true, value: toWireError(thrown.value, 0) }, []];
		}

		return comlinkThrowHandler.serialize(thrown);
	},
};

/**
 * Register the error-preserving `'throw'` handler with Comlink. Idempotent: every call registers the
 * same handler object.
 *
 * @remarks
 * Both ends must run it — the worker so `code` and `cause` are written, the main thread so the class
 * is rebuilt. `exposeFilterEngineWorker` and `wrapInWorker` each call it, so consumers of this
 * package never need to.
 */
export function installErrorTransferHandler(): void {
	transferHandlers.set('throw', errorTransferHandler);
}

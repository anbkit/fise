import { FiseError } from "./errors.js";

const MIN_SAFE_INTEGER = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

/** One deterministic half-open Unix-millisecond time window. */
export interface FiseTimeWindow {
	/** Integer window ID suitable for `EncryptOptions.timestamp`. */
	readonly timestamp: number;
	/** Inclusive Unix-millisecond boundary. */
	readonly startMs: number;
	/** Exclusive Unix-millisecond boundary. */
	readonly endExclusiveMs: number;
}

/** Deterministic Unix-millisecond time-window parameters. */
export interface FiseTimeWindowOptions {
	/** Positive window duration in milliseconds. */
	readonly durationMs: number;
	/** Unix-millisecond alignment origin. Defaults to the Unix epoch. */
	readonly originMs?: number;
}

/**
 * Resolve an explicit Unix-millisecond instant to a deterministic time window.
 *
 * This helper performs no clock read, serialization, adjacent-window fallback,
 * expiry check, or replay prevention. Producer and consumer must coordinate the
 * returned `timestamp` as external FISE context.
 */
export function resolveFiseTimeWindow(
	timeMs: number,
	options: FiseTimeWindowOptions
): FiseTimeWindow {
	const normalizedOptions = snapshotOptions(options);
	const time = requireSafeInteger(timeMs, "timeMs");
	const duration = requireSafeInteger(normalizedOptions.durationMs, "durationMs");
	const origin = requireSafeInteger(normalizedOptions.originMs ?? 0, "originMs");
	if (duration <= 0n) {
		throw new FiseError(
			"INVALID_INPUT",
			"FISE: time-window durationMs must be a positive safe integer."
		);
	}

	const relativeTime = time - origin;
	let timestamp = relativeTime / duration;
	if (relativeTime < 0n && relativeTime % duration !== 0n) timestamp -= 1n;

	const startMs = origin + timestamp * duration;
	const endExclusiveMs = startMs + duration;
	return Object.freeze({
		timestamp: toSafeInteger(timestamp),
		startMs: toSafeInteger(startMs),
		endExclusiveMs: toSafeInteger(endExclusiveMs)
	});
}

function snapshotOptions(value: unknown): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new FiseError("INVALID_INPUT", "FISE: time-window options must be an object.");
	}
	try {
		const prototype = Object.getPrototypeOf(value);
		if (
			(prototype !== Object.prototype && prototype !== null) ||
			Object.getOwnPropertySymbols(value).length > 0
		) {
			throw new FiseError(
				"INVALID_INPUT",
				"FISE: time-window options must be a plain object with string keys."
			);
		}
		const snapshot = Object.create(null) as Record<string, unknown>;
		for (const key of Object.getOwnPropertyNames(value)) {
			if (key !== "durationMs" && key !== "originMs") {
				throw new FiseError(
					"INVALID_INPUT",
					`FISE: time-window options contain unknown field '${key}'.`
				);
			}
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
				throw new FiseError(
					"INVALID_INPUT",
					`FISE: time-window options.${key} must be an enumerable data property.`
				);
			}
			snapshot[key] = descriptor.value;
		}
		return Object.freeze(snapshot);
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError("INVALID_INPUT", "FISE: unable to inspect time-window options.", error);
	}
}

function requireSafeInteger(value: unknown, name: string): bigint {
	if (typeof value !== "number" || !Number.isSafeInteger(value)) {
		throw new FiseError(
			"INVALID_INPUT",
			`FISE: time-window ${name} must be a safe integer.`
		);
	}
	return BigInt(value);
}

function toSafeInteger(value: bigint): number {
	if (value < MIN_SAFE_INTEGER || value > MAX_SAFE_INTEGER) {
		throw new FiseError(
			"INVALID_INPUT",
			"FISE: resolved time window exceeds the safe-integer range."
		);
	}
	return Number(value);
}

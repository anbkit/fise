import { FiseError } from "../errors.js";
import {
	ownBinaryEnvelope,
	ownBinaryEnvelopeAsync,
	restoreBinaryRange,
	restoreBinaryRangeAsync
} from "./envelope.js";
import { snapshotOwnDataProperties } from "./options.js";
import {
	runProfileKernel,
	type Profile,
	type ProfileAsyncKernelRunner,
	type ProfileKernelRunner
} from "./profile.js";
import type {
	FiseContext,
	FiseProgressiveOptions,
	FiseRange
} from "./types.js";
import { systemFiseClock, type FiseClock } from "./temporal.js";

const DEFAULT_CHUNK_SIZE = 256 * 1024;
const MAX_UINT32 = 0xffff_ffff;
const abortSignalAborted = typeof AbortSignal === "function"
	? Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get
	: undefined;

export function decryptBinaryRange(
	envelope: Uint8Array,
	profile: Profile,
	range: FiseRange,
	context: unknown,
	run: ProfileKernelRunner = runProfileKernel,
	clock: FiseClock = systemFiseClock
): Uint8Array {
	const normalizedRange = normalizeRange(range);
	const owned = ownBinaryEnvelope(envelope, profile, context, run, clock, "synchronous");
	assertRangeWithinPayload(normalizedRange, owned.contentLength);
	return restoreBinaryRange(owned, normalizedRange.start, normalizedRange.endExclusive);
}

export async function decryptBinaryRangeAsync(
	envelope: Uint8Array,
	profile: Profile,
	range: FiseRange,
	context: unknown,
	run: ProfileAsyncKernelRunner,
	clock: FiseClock = systemFiseClock
): Promise<Uint8Array> {
	const normalizedRange = normalizeRange(range);
	const owned = await ownBinaryEnvelopeAsync(envelope, profile, context, run, clock);
	assertRangeWithinPayload(normalizedRange, owned.contentLength);
	return restoreBinaryRangeAsync(
		owned,
		normalizedRange.start,
		normalizedRange.endExclusive,
		run
	);
}

export function decryptBinaryProgressive(
	envelope: Uint8Array,
	profile: Profile,
	context: unknown,
	options: FiseProgressiveOptions = {},
	run: ProfileKernelRunner = runProfileKernel,
	clock: FiseClock = systemFiseClock
): AsyncGenerator<Uint8Array, void, void> {
	const normalized = normalizeProgressiveOptions(options);
	const owned = ownBinaryEnvelope(envelope, profile, context, run, clock);
	return progressiveChunks(owned, normalized.chunkSize, normalized.signal);
}

export function decryptBinaryProgressiveAsync(
	envelope: Uint8Array,
	profile: Profile,
	context: unknown,
	options: FiseProgressiveOptions,
	run: ProfileAsyncKernelRunner,
	clock: FiseClock = systemFiseClock
): AsyncGenerator<Uint8Array, void, void> {
	const normalized = normalizeProgressiveOptions(options);
	const owned = ownBinaryEnvelope(envelope, profile, context, runProfileKernel, clock);
	return progressiveChunksAsync(owned, normalized.chunkSize, normalized.signal, run);
}

async function* progressiveChunks(
	owned: ReturnType<typeof ownBinaryEnvelope>,
	chunkSize: number,
	signal: AbortSignal | undefined
): AsyncGenerator<Uint8Array, void, void> {
	let start = 0;
	while (true) {
		throwIfAborted(signal);
		if (start >= owned.contentLength) return;
		yield restoreBinaryRange(
			owned,
			start,
			Math.min(start + chunkSize, owned.contentLength)
		);
		start += chunkSize;
	}
}

async function* progressiveChunksAsync(
	owned: ReturnType<typeof ownBinaryEnvelope>,
	chunkSize: number,
	signal: AbortSignal | undefined,
	run: ProfileAsyncKernelRunner
): AsyncGenerator<Uint8Array, void, void> {
	let start = 0;
	while (true) {
		throwIfAborted(signal);
		if (start >= owned.contentLength) return;
		yield await restoreBinaryRangeAsync(
			owned,
			start,
			Math.min(start + chunkSize, owned.contentLength),
			run
		);
		start += chunkSize;
	}
}

function normalizeRange(range: FiseRange): FiseRange {
	const properties = snapshotOwnDataProperties(
		range,
		["start", "endExclusive"],
		"INVALID_RANGE",
		"range"
	);
	for (const key of ["start", "endExclusive"] as const) {
		if (!properties.has(key)) {
			throw new FiseError("INVALID_RANGE", `FISE: range.${key} must be an own data property.`);
		}
	}
	const start = properties.get("start");
	const endExclusive = properties.get("endExclusive");
	if (
		typeof start !== "number" ||
		typeof endExclusive !== "number" ||
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(endExclusive) ||
		start < 0 ||
		endExclusive < start
	) {
		throw new FiseError("INVALID_RANGE", "FISE: range must be a valid half-open byte interval.");
	}
	return Object.freeze({ start, endExclusive });
}

function assertRangeWithinPayload(range: FiseRange, contentLength: number): void {
	if (range.endExclusive > contentLength) {
		throw new FiseError("INVALID_RANGE", "FISE: range exceeds binary plaintext length.");
	}
}

function normalizeProgressiveOptions(options: FiseProgressiveOptions): Readonly<{
	chunkSize: number;
	signal: AbortSignal | undefined;
}> {
	const properties = snapshotOwnDataProperties(
		options,
		["chunkSize", "signal"],
		"INVALID_INPUT",
		"progressive options"
	);
	const chunkSize = properties.get("chunkSize") ?? DEFAULT_CHUNK_SIZE;
	if (
		typeof chunkSize !== "number" ||
		!Number.isInteger(chunkSize) ||
		chunkSize < 1 ||
		chunkSize > MAX_UINT32
	) {
		throw new FiseError("INVALID_INPUT", "FISE: chunkSize must be a positive uint32.");
	}
	const signal = properties.get("signal");
	if (signal !== undefined && readAbortState(signal) === undefined) {
		throw new FiseError("INVALID_INPUT", "FISE: progressive signal must be an AbortSignal.");
	}
	return Object.freeze({ chunkSize, signal: signal as AbortSignal | undefined });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal === undefined) return;
	const aborted = readAbortState(signal);
	if (aborted === undefined) {
		throw new FiseError("INVALID_INPUT", "FISE: progressive signal must remain an AbortSignal.");
	}
	if (aborted) {
		throw new FiseError("OPERATION_ABORTED", "FISE: progressive restoration was aborted.");
	}
}

function readAbortState(signal: unknown): boolean | undefined {
	try {
		if (!signal || typeof signal !== "object" || abortSignalAborted === undefined) {
			return undefined;
		}
		const aborted = Reflect.apply(abortSignalAborted, signal, []) as unknown;
		return typeof aborted === "boolean" ? aborted : undefined;
	} catch (error) {
		throw new FiseError("INVALID_INPUT", "FISE: unable to inspect progressive signal.", error);
	}
}

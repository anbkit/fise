import {
	fiseBinaryDecryptAsyncNormalized,
	fiseBinaryEncryptAsyncNormalizedWithSalt,
	resolveAsyncBinaryBackend,
	snapshotAsyncBinaryOptions
} from "./asyncBinary.js";
import {
	NormalizedBinaryProfile,
	normalizeBinaryProfile,
	validateProfileId
} from "./core/profileValidation.js";
import {
	snapshotOperationOptions,
	throwIfAborted
} from "./core/operationOptions.js";
import { randomIntegerInclusive, randomSaltBinary } from "./core/utils.js";
import { assertUint8ArrayValue } from "./core/valueValidation.js";
import { FiseError } from "./errors.js";
import { fiseBinaryEncryptNormalizedWithSalt } from "./fiseBinaryEncrypt.js";
import {
	EncryptOptions,
	FiseAsyncBinaryCipher,
	FiseAsyncBinaryDecryptOptions,
	FiseAsyncBinaryEncryptOptions,
	FiseBinaryProfile
} from "./types.js";

const FRAMED_MAGIC = Uint8Array.from([0x46, 0x49, 0x53, 0x46]);
const FRAMED_FIXED_HEADER_LENGTH = 24;
const FRAMED_INDEX_ENTRY_LENGTH = 8;
const DEFAULT_FRAME_SIZE = 256 * 1024;
const DEFAULT_MAX_FRAME_COUNT = 65_536;
const MAX_CONCURRENCY = 64;
const MAX_UINT32 = 0xffff_ffff;

const ENCRYPT_OPTION_KEYS = new Set([
	"frameSize",
	"concurrency",
	"maxContainerLength",
	"maxFrameCount"
]);
const DECRYPT_OPTION_KEYS = new Set([
	"concurrency",
	"maxContainerLength",
	"maxFrameCount"
]);
const PROGRESSIVE_OPTION_KEYS = new Set([
	"maxContainerLength",
	"maxFrameCount"
]);
const CONFORMANCE_OPTION_KEYS = new Set([
	"timestamp",
	"metadata",
	"frameSize",
	"maxContainerLength",
	"maxFrameCount"
]);

export const FISE_FRAMED_BINARY_VERSION = Object.freeze({
	major: 1,
	minor: 0
} as const);

export interface FiseFramedBinaryEncryptOptions
	extends FiseAsyncBinaryEncryptOptions {
	/** Plaintext bytes per independent inner envelope. Default: 256 KiB. */
	readonly frameSize?: number;
	/** Maximum frame operations in flight. Default: 1; maximum: 64. */
	readonly concurrency?: number;
	/** Optional bound for the complete framed container. */
	readonly maxContainerLength?: number;
	/** Maximum number of frames accepted or created. Default: 65,536. */
	readonly maxFrameCount?: number;
}

export interface FiseFramedBinaryDecryptOptions
	extends FiseAsyncBinaryDecryptOptions {
	/** Maximum frame operations in flight. Default: 1; maximum: 64. */
	readonly concurrency?: number;
	/** Optional pre-parse bound for the complete framed container. */
	readonly maxContainerLength?: number;
	/** Maximum number of indexed frames accepted. Default: 65,536. */
	readonly maxFrameCount?: number;
}

export interface FiseFramedBinaryProgressiveOptions
	extends FiseAsyncBinaryDecryptOptions {
	/** Optional pre-parse bound for the complete framed container. */
	readonly maxContainerLength?: number;
	/** Maximum number of indexed frames accepted. Default: 65,536. */
	readonly maxFrameCount?: number;
}

export interface FiseBinaryRange {
	readonly start: number;
	readonly endExclusive: number;
}

export interface FiseFramedBinaryConformanceOptions extends EncryptOptions {
	readonly frameSize: number;
	readonly maxContainerLength?: number;
	readonly maxFrameCount?: number;
}

interface OwnedFramedOptions {
	readonly normalized: NormalizedBinaryProfile;
	readonly backend?: FiseAsyncBinaryCipher;
	readonly signal?: AbortSignal;
	readonly concurrency: number;
	readonly maxContainerLength?: number;
	readonly maxFrameCount: number;
	readonly frameSize?: number;
}

interface ParsedFramedContainer {
	readonly profileId: string;
	readonly frameSize: number;
	readonly plaintextLength: number;
	readonly frames: readonly FramedIndexEntry[];
}

interface FramedIndexEntry {
	readonly offset: number;
	readonly length: number;
}

/**
 * Encodes bytes as indexed independent FISE 1.1 envelopes. The outer `FISF`
 * container is opt-in and does not change the ordinary 1.1 envelope grammar.
 */
export async function fiseFramedBinaryEncrypt(
	input: Uint8Array,
	profile: FiseBinaryProfile,
	options: FiseFramedBinaryEncryptOptions = {}
): Promise<Uint8Array> {
	const ownedInput = snapshotBytes(input, "framed binary input", "INVALID_INPUT");
	if (ownedInput.length > MAX_UINT32) {
		throw new FiseError(
			"FRAME_LIMIT",
			"FISE: framed plaintext length must fit an unsigned 32-bit field."
		);
	}
	const owned = normalizeFramedOptions(profile, options, "encrypt");
	throwIfAborted(owned.signal);
	const frameSize = owned.frameSize!;
	const frameCount = calculateFrameCount(ownedInput.length, frameSize);
	assertFrameCount(frameCount, owned.maxFrameCount);
	assertMinimumContainerBound(
		ownedInput.length,
		owned.normalized.id.length,
		frameCount,
		owned.maxContainerLength
	);

	const frames = await mapConcurrent(
		frameCount,
		owned.concurrency,
		owned.signal,
		async frameIndex => {
			const start = frameIndex * frameSize;
			const frameInput = ownedInput.slice(
				start,
				Math.min(start + frameSize, ownedInput.length)
			);
			const saltLength = randomIntegerInclusive(
				owned.normalized.saltRange.min,
				owned.normalized.saltRange.max
			);
			return fiseBinaryEncryptAsyncNormalizedWithSalt(
				frameInput,
				randomSaltBinary(saltLength),
				owned.normalized,
				owned.backend,
				owned.signal
			);
		}
	);
	throwIfAborted(owned.signal);
	return assembleFramedContainer(
		frames,
		owned.normalized.id,
		frameSize,
		ownedInput.length,
		owned.maxContainerLength
	);
}

/** @internal Deterministic framed encoding used by `fise/conformance`. */
export function fiseFramedBinaryEncryptWithSalts(
	input: Uint8Array,
	salts: readonly Uint8Array[],
	profile: FiseBinaryProfile,
	options: FiseFramedBinaryConformanceOptions
): Uint8Array {
	const ownedInput = snapshotBytes(input, "framed binary input", "INVALID_INPUT");
	if (ownedInput.length > MAX_UINT32) {
		throw new FiseError(
			"FRAME_LIMIT",
			"FISE: framed plaintext length must fit an unsigned 32-bit field."
		);
	}
	const source = snapshotOperationOptions(
		options,
		CONFORMANCE_OPTION_KEYS,
		"framed conformance options"
	);
	if (!Object.prototype.hasOwnProperty.call(source, "frameSize")) {
		throw new FiseError(
			"INVALID_INPUT",
			"FISE: framed conformance options.frameSize is required."
		);
	}
	const frameSize = positiveInteger(
		source.frameSize,
		DEFAULT_FRAME_SIZE,
		MAX_UINT32,
		"frameSize"
	);
	const maxContainerLength = optionalNonNegativeSafeInteger(
		source.maxContainerLength,
		"maxContainerLength"
	);
	const maxFrameCount = nonNegativeInteger(
		source.maxFrameCount,
		DEFAULT_MAX_FRAME_COUNT,
		MAX_UINT32,
		"maxFrameCount"
	);
	const runtimeOptions = Object.create(null) as Record<string, unknown>;
	for (const key of ["timestamp", "metadata"] as const) {
		if (Object.prototype.hasOwnProperty.call(source, key)) {
			runtimeOptions[key] = source[key];
		}
	}
	const normalized = normalizeBinaryProfile(
		profile,
		Object.freeze(runtimeOptions) as EncryptOptions
	);
	const frameCount = calculateFrameCount(ownedInput.length, frameSize);
	assertFrameCount(frameCount, maxFrameCount);
	const ownedSalts = snapshotFrameSalts(salts, frameCount);
	const frames = ownedSalts.map((salt, frameIndex) => {
		const start = frameIndex * frameSize;
		return fiseBinaryEncryptNormalizedWithSalt(
			ownedInput.slice(start, Math.min(start + frameSize, ownedInput.length)),
			salt,
			normalized
		);
	});
	return assembleFramedContainer(
		frames,
		normalized.id,
		frameSize,
		ownedInput.length,
		maxContainerLength
	);
}

/** Restores every indexed frame and returns one owned byte array. */
export async function fiseFramedBinaryDecrypt(
	container: Uint8Array,
	profile: FiseBinaryProfile,
	options: FiseFramedBinaryDecryptOptions = {}
): Promise<Uint8Array> {
	const ownedContainer = snapshotBytes(
		container,
		"framed binary container",
		"INVALID_ENVELOPE"
	);
	const owned = normalizeFramedOptions(profile, options, "decrypt");
	const parsed = parseFramedContainer(ownedContainer, owned);
	const restoredFrames = await restoreFrameRange(
		ownedContainer,
		parsed,
		owned,
		0,
		parsed.frames.length
	);
	const output = allocateBytes(parsed.plaintextLength, "restored framed payload");
	let offset = 0;
	for (const restored of restoredFrames) {
		output.set(restored, offset);
		offset += restored.length;
	}
	return output;
}

/**
 * Restores only frames intersecting `[start, endExclusive)` and then slices
 * their boundary bytes. Unselected inner envelopes are not transformed.
 */
export async function fiseFramedBinaryDecryptRange(
	container: Uint8Array,
	profile: FiseBinaryProfile,
	range: FiseBinaryRange,
	options: FiseFramedBinaryDecryptOptions = {}
): Promise<Uint8Array> {
	const ownedContainer = snapshotBytes(
		container,
		"framed binary container",
		"INVALID_ENVELOPE"
	);
	const ownedRange = normalizeRange(range);
	const owned = normalizeFramedOptions(profile, options, "decrypt");
	const parsed = parseFramedContainer(ownedContainer, owned);
	assertRangeWithinPayload(ownedRange, parsed.plaintextLength);
	if (ownedRange.start === ownedRange.endExclusive) return new Uint8Array();

	const firstFrame = Math.floor(ownedRange.start / parsed.frameSize);
	const endFrameExclusive = Math.ceil(
		ownedRange.endExclusive / parsed.frameSize
	);
	const restoredFrames = await restoreFrameRange(
		ownedContainer,
		parsed,
		owned,
		firstFrame,
		endFrameExclusive
	);
	const output = allocateBytes(
		ownedRange.endExclusive - ownedRange.start,
		"restored range"
	);
	for (let index = 0; index < restoredFrames.length; index++) {
		const absoluteFrameIndex = firstFrame + index;
		const frameStart = absoluteFrameIndex * parsed.frameSize;
		const copyStart = Math.max(ownedRange.start, frameStart);
		const copyEnd = Math.min(
			ownedRange.endExclusive,
			frameStart + restoredFrames[index].length
		);
		output.set(
			restoredFrames[index].subarray(
				copyStart - frameStart,
				copyEnd - frameStart
			),
			copyStart - ownedRange.start
		);
	}
	return output;
}

/**
 * Returns one restored plaintext frame per consumer pull. This provides byte
 * backpressure; it does not incrementally parse JSON or fetch a remote range.
 */
export function fiseFramedBinaryDecryptProgressive(
	container: Uint8Array,
	profile: FiseBinaryProfile,
	options: FiseFramedBinaryProgressiveOptions = {}
): AsyncGenerator<Uint8Array, void, void> {
	const ownedContainer = snapshotBytes(
		container,
		"framed binary container",
		"INVALID_ENVELOPE"
	);
	const owned = normalizeFramedOptions(profile, options, "progressive");
	const parsed = parseFramedContainer(ownedContainer, owned);
	return progressiveFrames(ownedContainer, parsed, owned);
}

async function* progressiveFrames(
	container: Uint8Array,
	parsed: ParsedFramedContainer,
	owned: OwnedFramedOptions
): AsyncGenerator<Uint8Array, void, void> {
	for (let frameIndex = 0; frameIndex < parsed.frames.length; frameIndex++) {
		throwIfAborted(owned.signal);
		yield await restoreFrame(container, parsed, owned, frameIndex);
	}
}

async function restoreFrameRange(
	container: Uint8Array,
	parsed: ParsedFramedContainer,
	owned: OwnedFramedOptions,
	startFrame: number,
	endFrameExclusive: number
): Promise<Uint8Array[]> {
	return mapConcurrent(
		endFrameExclusive - startFrame,
		owned.concurrency,
		owned.signal,
		index => restoreFrame(container, parsed, owned, startFrame + index)
	);
}

async function restoreFrame(
	container: Uint8Array,
	parsed: ParsedFramedContainer,
	owned: OwnedFramedOptions,
	frameIndex: number
): Promise<Uint8Array> {
	const entry = parsed.frames[frameIndex];
	const frameEnvelope = container.subarray(
		entry.offset,
		entry.offset + entry.length
	);
	const restored = await fiseBinaryDecryptAsyncNormalized(
		frameEnvelope,
		owned.normalized,
		owned.backend,
		owned.signal
	);
	const expectedLength = expectedFramePlaintextLength(parsed, frameIndex);
	if (restored.length !== expectedLength) {
		throw new FiseError(
			"LENGTH_MISMATCH",
			`FISE: restored frame ${frameIndex} length ${restored.length} does not match expected length ${expectedLength}.`
		);
	}
	return restored;
}

function parseFramedContainer(
	container: Uint8Array,
	owned: OwnedFramedOptions
): ParsedFramedContainer {
	throwIfAborted(owned.signal);
	if (
		owned.maxContainerLength !== undefined &&
		container.length > owned.maxContainerLength
	) {
		throw new FiseError(
			"ENVELOPE_LIMIT",
			`FISE: framed container length ${container.length} exceeds configured maximum ${owned.maxContainerLength}.`
		);
	}
	if (container.length < FRAMED_FIXED_HEADER_LENGTH) {
		throw invalidFramed("container is shorter than the framed header");
	}
	for (let index = 0; index < FRAMED_MAGIC.length; index++) {
		if (container[index] !== FRAMED_MAGIC[index]) {
			throw invalidFramed("missing FISF framed-container magic");
		}
	}
	if (
		container[4] !== FISE_FRAMED_BINARY_VERSION.major ||
		container[5] !== FISE_FRAMED_BINARY_VERSION.minor
	) {
		throw new FiseError(
			"UNSUPPORTED_VERSION",
			`FISE: unsupported framed binary version ${container[4]}.${container[5]}; expected ${FISE_FRAMED_BINARY_VERSION.major}.${FISE_FRAMED_BINARY_VERSION.minor}.`
		);
	}
	if (container[6] !== 0) throw invalidFramed("framed flags must be zero");
	const profileLength = container[7];
	if (profileLength < 1) throw invalidFramed("framed profile ID is empty");
	const view = new DataView(
		container.buffer,
		container.byteOffset,
		container.byteLength
	);
	const frameSize = view.getUint32(8, false);
	const plaintextLength = view.getUint32(12, false);
	const frameCount = view.getUint32(16, false);
	const indexEntryLength = view.getUint16(20, false);
	const reserved = view.getUint16(22, false);
	if (frameSize < 1) throw invalidFramed("frame size must be positive");
	if (indexEntryLength !== FRAMED_INDEX_ENTRY_LENGTH) {
		throw invalidFramed("framed index entry width is unsupported");
	}
	if (reserved !== 0) throw invalidFramed("framed reserved field must be zero");
	assertFrameCount(frameCount, owned.maxFrameCount);
	if (frameCount !== calculateFrameCount(plaintextLength, frameSize)) {
		throw invalidFramed("frame count does not match plaintext length and frame size");
	}

	const profileStart = FRAMED_FIXED_HEADER_LENGTH;
	const indexStart = checkedAdd(profileStart, profileLength, "framed profile ID");
	const indexLength = checkedMultiply(
		frameCount,
		FRAMED_INDEX_ENTRY_LENGTH,
		"framed index"
	);
	const framesStart = checkedAdd(indexStart, indexLength, "framed index");
	if (framesStart > container.length) {
		throw invalidFramed("profile ID or frame index is truncated");
	}
	let profileId = "";
	for (let index = 0; index < profileLength; index++) {
		profileId += String.fromCharCode(container[profileStart + index]);
	}
	try {
		validateProfileId(profileId);
	} catch (error) {
		throw invalidFramed("profile identifier is malformed", error);
	}
	if (profileId !== owned.normalized.id) {
		throw new FiseError(
			"PROFILE_MISMATCH",
			`FISE: framed profile '${profileId}' does not match expected profile '${owned.normalized.id}'.`
		);
	}

	const frames: FramedIndexEntry[] = [];
	let expectedOffset = framesStart;
	for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
		const entryOffset = indexStart + frameIndex * FRAMED_INDEX_ENTRY_LENGTH;
		const offset = view.getUint32(entryOffset, false);
		const length = view.getUint32(entryOffset + 4, false);
		if (length < 1) throw invalidFramed(`frame ${frameIndex} length must be positive`);
		if (offset !== expectedOffset) {
			throw invalidFramed(`frame ${frameIndex} offset is not contiguous`);
		}
		expectedOffset = checkedAdd(offset, length, `frame ${frameIndex}`);
		if (expectedOffset > container.length) {
			throw invalidFramed(`frame ${frameIndex} is truncated`);
		}
		frames.push(Object.freeze({ offset, length }));
	}
	if (expectedOffset !== container.length) {
		throw invalidFramed("container has trailing bytes after the indexed frames");
	}
	return Object.freeze({
		profileId,
		frameSize,
		plaintextLength,
		frames: Object.freeze(frames)
	});
}

function assembleFramedContainer(
	frames: readonly Uint8Array[],
	profileId: string,
	frameSize: number,
	plaintextLength: number,
	maxContainerLength: number | undefined
): Uint8Array {
	let totalLength = checkedAdd(
		FRAMED_FIXED_HEADER_LENGTH + profileId.length,
		checkedMultiply(frames.length, FRAMED_INDEX_ENTRY_LENGTH, "framed index"),
		"framed header"
	);
	for (const frame of frames) {
		assertUint8ArrayValue(frame, "framed inner envelope", "INVALID_ENVELOPE");
		totalLength = checkedAdd(totalLength, frame.length, "framed container");
	}
	if (totalLength > MAX_UINT32) {
		throw new FiseError(
			"FRAME_LIMIT",
			"FISE: framed container length must fit unsigned 32-bit index offsets."
		);
	}
	if (maxContainerLength !== undefined && totalLength > maxContainerLength) {
		throw new FiseError(
			"ENVELOPE_LIMIT",
			`FISE: framed container length ${totalLength} exceeds configured maximum ${maxContainerLength}.`
		);
	}
	const container = allocateBytes(totalLength, "framed container");
	container.set(FRAMED_MAGIC, 0);
	container[4] = FISE_FRAMED_BINARY_VERSION.major;
	container[5] = FISE_FRAMED_BINARY_VERSION.minor;
	container[6] = 0;
	container[7] = profileId.length;
	const view = new DataView(container.buffer);
	view.setUint32(8, frameSize, false);
	view.setUint32(12, plaintextLength, false);
	view.setUint32(16, frames.length, false);
	view.setUint16(20, FRAMED_INDEX_ENTRY_LENGTH, false);
	view.setUint16(22, 0, false);
	for (let index = 0; index < profileId.length; index++) {
		container[FRAMED_FIXED_HEADER_LENGTH + index] = profileId.charCodeAt(index);
	}
	const indexStart = FRAMED_FIXED_HEADER_LENGTH + profileId.length;
	let frameOffset = indexStart + frames.length * FRAMED_INDEX_ENTRY_LENGTH;
	for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
		const entryOffset = indexStart + frameIndex * FRAMED_INDEX_ENTRY_LENGTH;
		view.setUint32(entryOffset, frameOffset, false);
		view.setUint32(entryOffset + 4, frames[frameIndex].length, false);
		container.set(frames[frameIndex], frameOffset);
		frameOffset += frames[frameIndex].length;
	}
	return container;
}

function normalizeFramedOptions(
	profile: FiseBinaryProfile,
	options: unknown,
	operation: "encrypt" | "decrypt" | "progressive"
): OwnedFramedOptions {
	const asyncOperation = operation === "encrypt" ? "encrypt" : "decrypt";
	const extraKeys = operation === "encrypt"
		? ENCRYPT_OPTION_KEYS
		: operation === "decrypt"
			? DECRYPT_OPTION_KEYS
			: PROGRESSIVE_OPTION_KEYS;
	const asyncOptions = snapshotAsyncBinaryOptions(
		options,
		asyncOperation,
		extraKeys
	);
	const normalized = normalizeBinaryProfile(
		profile,
		asyncOptions.runtimeOptions
	);
	const backend = resolveAsyncBinaryBackend(normalized, asyncOptions.backend);
	const source = asyncOptions.source;
	return Object.freeze({
		normalized,
		backend,
		signal: asyncOptions.signal,
		concurrency: operation === "progressive"
			? 1
			: positiveInteger(source.concurrency, 1, MAX_CONCURRENCY, "concurrency"),
		maxContainerLength: optionalNonNegativeSafeInteger(
			source.maxContainerLength,
			"maxContainerLength"
		),
		maxFrameCount: nonNegativeInteger(
			source.maxFrameCount,
			DEFAULT_MAX_FRAME_COUNT,
			MAX_UINT32,
			"maxFrameCount"
		),
		frameSize: operation === "encrypt"
			? positiveInteger(source.frameSize, DEFAULT_FRAME_SIZE, MAX_UINT32, "frameSize")
			: undefined
	});
}

async function mapConcurrent<T>(
	count: number,
	concurrency: number,
	signal: AbortSignal | undefined,
	mapper: (index: number) => Promise<T>
): Promise<T[]> {
	if (count === 0) return [];
	const results = new Array<T>(count);
	let cursor = 0;
	let failure: unknown;
	const worker = async () => {
		try {
			while (failure === undefined) {
				throwIfAborted(signal);
				const index = cursor++;
				if (index >= count) return;
				results[index] = await mapper(index);
			}
		} catch (error) {
			if (failure === undefined) {
				failure = error;
			}
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(concurrency, count) }, () => worker())
	);
	if (failure !== undefined) throw failure;
	throwIfAborted(signal);
	return results;
}

function normalizeRange(range: unknown): FiseBinaryRange {
	if (!range || typeof range !== "object" || Array.isArray(range)) {
		throw invalidRange("range must be an object");
	}
	try {
		const prototype = Object.getPrototypeOf(range);
		if (
			(prototype !== Object.prototype && prototype !== null) ||
			Object.getOwnPropertySymbols(range).length > 0
		) {
			throw invalidRange("range must be a plain object with string keys");
		}
		const source = Object.create(null) as Record<string, unknown>;
		for (const key of Object.getOwnPropertyNames(range)) {
			const descriptor = Object.getOwnPropertyDescriptor(range, key);
			if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
				throw invalidRange(`range.${key} must be an enumerable data property`);
			}
			if (key !== "start" && key !== "endExclusive") {
				throw invalidRange(`range contains unknown field '${key}'`);
			}
			source[key] = descriptor.value;
		}
		for (const key of ["start", "endExclusive"] as const) {
			if (!Object.prototype.hasOwnProperty.call(source, key)) {
				throw invalidRange(`range.${key} is required`);
			}
			if (!Number.isSafeInteger(source[key]) || (source[key] as number) < 0) {
				throw invalidRange(`range.${key} must be a non-negative safe integer`);
			}
		}
		const start = source.start as number;
		const endExclusive = source.endExclusive as number;
		if (start > endExclusive) {
			throw invalidRange("range.start must not exceed range.endExclusive");
		}
		return Object.freeze({ start, endExclusive });
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw invalidRange("unable to inspect range", error);
	}
}

function snapshotFrameSalts(
	value: unknown,
	expectedLength: number
): readonly Uint8Array[] {
	try {
		if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
			throw new FiseError(
				"INVALID_INPUT",
				"FISE: framed conformance salts must be an array."
			);
		}
		if (
			Object.getOwnPropertySymbols(value).length > 0 ||
			value.length !== expectedLength
		) {
			throw new FiseError(
				"INVALID_INPUT",
				`FISE: framed conformance requires exactly ${expectedLength} salts.`
			);
		}
		const salts: Uint8Array[] = [];
		for (let index = 0; index < expectedLength; index++) {
			const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
			if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
				throw new FiseError(
					"INVALID_INPUT",
					`FISE: framed conformance salt ${index} must be an enumerable data element.`
				);
			}
			assertUint8ArrayValue(
				descriptor.value,
				`framed conformance salt ${index}`,
				"INVALID_SALT"
			);
			const salt = new Uint8Array(descriptor.value.length);
			salt.set(descriptor.value);
			salts.push(salt);
		}
		for (const key of Object.getOwnPropertyNames(value)) {
			if (key === "length") continue;
			const index = Number(key);
			if (
				!Number.isInteger(index) ||
				index < 0 ||
				index >= expectedLength ||
				String(index) !== key
			) {
				throw new FiseError(
					"INVALID_INPUT",
					`FISE: framed conformance salts contain unknown field '${key}'.`
				);
			}
		}
		return Object.freeze(salts);
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError(
			"INVALID_INPUT",
			"FISE: unable to inspect framed conformance salts.",
			error
		);
	}
}

function assertRangeWithinPayload(
	range: FiseBinaryRange,
	plaintextLength: number
): void {
	if (range.endExclusive > plaintextLength) {
		throw invalidRange(
			`range end ${range.endExclusive} exceeds plaintext length ${plaintextLength}`
		);
	}
}

function expectedFramePlaintextLength(
	parsed: ParsedFramedContainer,
	frameIndex: number
): number {
	return Math.min(
		parsed.frameSize,
		parsed.plaintextLength - frameIndex * parsed.frameSize
	);
}

function calculateFrameCount(length: number, frameSize: number): number {
	return length === 0 ? 0 : Math.ceil(length / frameSize);
}

function assertFrameCount(actual: number, maximum: number): void {
	if (actual > maximum) {
		throw new FiseError(
			"FRAME_LIMIT",
			`FISE: frame count ${actual} exceeds configured maximum ${maximum}.`
		);
	}
}

function assertMinimumContainerBound(
	plaintextLength: number,
	profileLength: number,
	frameCount: number,
	maximum: number | undefined
): void {
	if (maximum === undefined) return;
	const minimum = checkedAdd(
		FRAMED_FIXED_HEADER_LENGTH + profileLength + plaintextLength,
		checkedMultiply(frameCount, FRAMED_INDEX_ENTRY_LENGTH, "framed index"),
		"minimum framed container"
	);
	if (minimum > maximum) {
		throw new FiseError(
			"ENVELOPE_LIMIT",
			`FISE: minimum framed container length ${minimum} exceeds configured maximum ${maximum}.`
		);
	}
}

function positiveInteger(
	value: unknown,
	fallback: number,
	maximum: number,
	label: string
): number {
	const resolved = value === undefined ? fallback : value;
	if (
		typeof resolved !== "number" ||
		!Number.isInteger(resolved) ||
		resolved < 1 ||
		resolved > maximum
	) {
		throw new FiseError(
			"INVALID_INPUT",
			`FISE: ${label} must be an integer from 1 through ${maximum}.`
		);
	}
	return resolved;
}

function nonNegativeInteger(
	value: unknown,
	fallback: number,
	maximum: number,
	label: string
): number {
	const resolved = value === undefined ? fallback : value;
	if (
		typeof resolved !== "number" ||
		!Number.isInteger(resolved) ||
		resolved < 0 ||
		resolved > maximum
	) {
		throw new FiseError(
			"INVALID_INPUT",
			`FISE: ${label} must be an integer from 0 through ${maximum}.`
		);
	}
	return resolved;
}

function optionalNonNegativeSafeInteger(
	value: unknown,
	label: string
): number | undefined {
	if (value === undefined) return undefined;
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < 0
	) {
		throw new FiseError(
			"INVALID_INPUT",
			`FISE: ${label} must be a non-negative safe integer.`
		);
	}
	return value;
}

function checkedMultiply(left: number, right: number, label: string): number {
	const value = left * right;
	if (!Number.isSafeInteger(value) || value > MAX_UINT32) {
		throw new FiseError(
			"FRAME_LIMIT",
			`FISE: ${label} length exceeds the framed unsigned 32-bit limit.`
		);
	}
	return value;
}

function checkedAdd(left: number, right: number, label: string): number {
	const value = left + right;
	if (!Number.isSafeInteger(value) || value > MAX_UINT32) {
		throw new FiseError(
			"FRAME_LIMIT",
			`FISE: ${label} length exceeds the framed unsigned 32-bit limit.`
		);
	}
	return value;
}

function allocateBytes(length: number, label: string): Uint8Array {
	try {
		return new Uint8Array(length);
	} catch (error) {
		throw new FiseError(
			"ENVELOPE_LIMIT",
			`FISE: unable to allocate ${label} of length ${length}.`,
			error
		);
	}
}

function snapshotBytes(
	value: Uint8Array,
	label: string,
	code: "INVALID_INPUT" | "INVALID_ENVELOPE"
): Uint8Array {
	assertUint8ArrayValue(value, label, code);
	try {
		const snapshot = new Uint8Array(value.length);
		snapshot.set(value);
		return snapshot;
	} catch (error) {
		throw new FiseError(
			"ENVELOPE_LIMIT",
			`FISE: unable to snapshot ${label} of length ${value.length}.`,
			error
		);
	}
}

function invalidFramed(message: string, cause?: unknown): FiseError {
	return new FiseError(
		"INVALID_ENVELOPE",
		`FISE: ${message}.`,
		cause
	);
}

function invalidRange(message: string, cause?: unknown): FiseError {
	return new FiseError(
		"INVALID_RANGE",
		`FISE: ${message}.`,
		cause
	);
}

import { FiseError } from "../errors.js";
import { bytesEqual, copyBytes, isBytes } from "./bytes.js";
import { decodeValue, encodeValue } from "./codec.js";
import {
	openPayloadOwnedAsync,
	openPayloadOwned,
	ownProfileOperation,
	sealPayloadOwnedAsync,
	sealPayloadOwned,
	type OwnedProfileOperation
} from "./envelope.js";
import {
	profileMarker,
	runProfileKernel,
	runtimeOf,
	type Profile,
	type ProfileAsyncKernelRunner,
	type ProfileKernelRunner
} from "./profile.js";
import type {
	FiseFramedOptions,
	FiseProgressiveOptions,
	FiseRange
} from "./types.js";

const MAGIC = Uint8Array.of(0x46, 0x49, 0x53, 0x46); // FISF
const HEADER_LENGTH = 40;
const INDEX_ENTRY_LENGTH = 8;
const DEFAULT_FRAME_SIZE = 256 * 1024;
const MAX_UINT32 = 0xffff_ffff;
const MAX_CONTAINER_LENGTH = 512 * 1024 * 1024;
const MAX_FRAME_COUNT = 65_536;

export const FISF_WIRE_VERSION = Object.freeze({ major: 2, minor: 0 });

interface FrameEntry {
	readonly offset: number;
	readonly length: number;
}

interface ParsedContainer {
	readonly frameSize: number;
	readonly plaintextLength: number;
	readonly contextMarker: number;
	readonly frames: readonly FrameEntry[];
}

export function encryptFramed(
	input: Uint8Array,
	profile: Profile,
	context: unknown,
	options: FiseFramedOptions = {},
	run: ProfileKernelRunner = runProfileKernel
): Uint8Array {
	if (!isBytes(input)) {
		throw new FiseError("INVALID_INPUT", "FISE: framed input must be a Uint8Array.");
	}
	const ownedInput = copyBytes(input);
	assertFramedInputLength(ownedInput.length);
	const operation = ownProfileOperation(profile, context, run);
	const frameSize = normalizeFrameSize(options);
	if (ownedInput.length > MAX_UINT32) {
		throw new FiseError("FRAME_LIMIT", "FISE: framed plaintext length must fit uint32.");
	}
	const frameCount = ownedInput.length === 0 ? 0 : Math.ceil(ownedInput.length / frameSize);
	assertFrameCount(frameCount);
	const frames: Uint8Array[] = [];
	for (let index = 0; index < frameCount; index++) {
		const start = index * frameSize;
		frames.push(
			sealPayloadOwned(
				encodeValue(ownedInput.slice(start, Math.min(start + frameSize, ownedInput.length))),
				operation
			)
		);
	}
	return assembleContainer(frames, operation, frameSize, ownedInput.length);
}

export function decryptFramed(
	container: Uint8Array,
	profile: Profile,
	context: unknown,
	run: ProfileKernelRunner = runProfileKernel
): Uint8Array {
	const owned = ownAndParse(container, profile);
	const operation = ownProfileOperation(profile, context, run);
	assertContainerMarker(owned.parsed, operation);
	const output = allocate(owned.parsed.plaintextLength, "framed plaintext");
	for (let index = 0; index < owned.parsed.frames.length; index++) {
		const frame = restoreFrame(owned.container, owned.parsed, index, operation);
		output.set(frame, index * owned.parsed.frameSize);
	}
	return output;
}

export function decryptRange(
	container: Uint8Array,
	profile: Profile,
	range: FiseRange,
	context: unknown,
	run: ProfileKernelRunner = runProfileKernel
): Uint8Array {
	const ownedRange = normalizeRange(range);
	const owned = ownAndParse(container, profile);
	const operation = ownProfileOperation(profile, context, run);
	assertContainerMarker(owned.parsed, operation);
	if (ownedRange.endExclusive > owned.parsed.plaintextLength) {
		throw new FiseError("INVALID_RANGE", "FISE: range exceeds framed plaintext length.");
	}
	const outputLength = ownedRange.endExclusive - ownedRange.start;
	if (outputLength === 0) return new Uint8Array();
	const output = allocate(outputLength, "framed range");
	const firstFrame = Math.floor(ownedRange.start / owned.parsed.frameSize);
	const lastFrameExclusive = Math.ceil(ownedRange.endExclusive / owned.parsed.frameSize);
	for (let frameIndex = firstFrame; frameIndex < lastFrameExclusive; frameIndex++) {
		const frame = restoreFrame(owned.container, owned.parsed, frameIndex, operation);
		const frameStart = frameIndex * owned.parsed.frameSize;
		const copyStart = Math.max(ownedRange.start, frameStart);
		const copyEnd = Math.min(ownedRange.endExclusive, frameStart + frame.length);
		output.set(
			frame.subarray(copyStart - frameStart, copyEnd - frameStart),
			copyStart - ownedRange.start
		);
	}
	return output;
}

export function decryptProgressive(
	container: Uint8Array,
	profile: Profile,
	context: unknown,
	options: FiseProgressiveOptions = {},
	run: ProfileKernelRunner = runProfileKernel
): AsyncGenerator<Uint8Array, void, void> {
	const signal = normalizeSignal(options);
	const owned = ownAndParse(container, profile);
	const operation = ownProfileOperation(profile, context, run);
	assertContainerMarker(owned.parsed, operation);
	return progressiveFrames(owned.container, owned.parsed, operation, signal);
}

export async function encryptFramedAsync(
	input: Uint8Array,
	profile: Profile,
	context: unknown,
	options: FiseFramedOptions,
	run: ProfileAsyncKernelRunner
): Promise<Uint8Array> {
	if (!isBytes(input)) {
		throw new FiseError("INVALID_INPUT", "FISE: framed input must be a Uint8Array.");
	}
	const ownedInput = copyBytes(input);
	assertFramedInputLength(ownedInput.length);
	const operation = ownProfileOperation(profile, context);
	const frameSize = normalizeFrameSize(options);
	if (ownedInput.length > MAX_UINT32) {
		throw new FiseError("FRAME_LIMIT", "FISE: framed plaintext length must fit uint32.");
	}
	const frameCount = ownedInput.length === 0 ? 0 : Math.ceil(ownedInput.length / frameSize);
	assertFrameCount(frameCount);
	const frames: Uint8Array[] = [];
	for (let index = 0; index < frameCount; index++) {
		const start = index * frameSize;
		frames.push(await sealPayloadOwnedAsync(
			encodeValue(ownedInput.slice(start, Math.min(start + frameSize, ownedInput.length))),
			operation,
			run
		));
	}
	return assembleContainer(frames, operation, frameSize, ownedInput.length);
}

export async function decryptFramedAsync(
	container: Uint8Array,
	profile: Profile,
	context: unknown,
	run: ProfileAsyncKernelRunner
): Promise<Uint8Array> {
	const owned = ownAndParse(container, profile);
	const operation = ownProfileOperation(profile, context);
	assertContainerMarker(owned.parsed, operation);
	const output = allocate(owned.parsed.plaintextLength, "framed plaintext");
	for (let index = 0; index < owned.parsed.frames.length; index++) {
		const frame = await restoreFrameAsync(owned.container, owned.parsed, index, operation, run);
		output.set(frame, index * owned.parsed.frameSize);
	}
	return output;
}

export async function decryptRangeAsync(
	container: Uint8Array,
	profile: Profile,
	range: FiseRange,
	context: unknown,
	run: ProfileAsyncKernelRunner
): Promise<Uint8Array> {
	const ownedRange = normalizeRange(range);
	const owned = ownAndParse(container, profile);
	const operation = ownProfileOperation(profile, context);
	assertContainerMarker(owned.parsed, operation);
	if (ownedRange.endExclusive > owned.parsed.plaintextLength) {
		throw new FiseError("INVALID_RANGE", "FISE: range exceeds framed plaintext length.");
	}
	const outputLength = ownedRange.endExclusive - ownedRange.start;
	if (outputLength === 0) return new Uint8Array();
	const firstFrame = Math.floor(ownedRange.start / owned.parsed.frameSize);
	const lastFrameExclusive = Math.ceil(ownedRange.endExclusive / owned.parsed.frameSize);
	const output = allocate(outputLength, "framed range");
	for (let frameIndex = firstFrame; frameIndex < lastFrameExclusive; frameIndex++) {
		const frame = await restoreFrameAsync(
			owned.container,
			owned.parsed,
			frameIndex,
			operation,
			run
		);
		const frameStart = frameIndex * owned.parsed.frameSize;
		const copyStart = Math.max(ownedRange.start, frameStart);
		const copyEnd = Math.min(ownedRange.endExclusive, frameStart + frame.length);
		output.set(
			frame.subarray(copyStart - frameStart, copyEnd - frameStart),
			copyStart - ownedRange.start
		);
	}
	return output;
}

export function decryptProgressiveAsync(
	container: Uint8Array,
	profile: Profile,
	context: unknown,
	options: FiseProgressiveOptions,
	run: ProfileAsyncKernelRunner
): AsyncGenerator<Uint8Array, void, void> {
	const signal = normalizeSignal(options);
	const owned = ownAndParse(container, profile);
	const operation = ownProfileOperation(profile, context);
	assertContainerMarker(owned.parsed, operation);
	return progressiveFramesAsync(owned.container, owned.parsed, operation, signal, run);
}

async function* progressiveFrames(
	container: Uint8Array,
	parsed: ParsedContainer,
	operation: OwnedProfileOperation,
	signal: AbortSignal | undefined
): AsyncGenerator<Uint8Array, void, void> {
	for (let index = 0; index < parsed.frames.length; index++) {
		throwIfAborted(signal);
		yield restoreFrame(container, parsed, index, operation);
	}
}

async function* progressiveFramesAsync(
	container: Uint8Array,
	parsed: ParsedContainer,
	operation: OwnedProfileOperation,
	signal: AbortSignal | undefined,
	run: ProfileAsyncKernelRunner
): AsyncGenerator<Uint8Array, void, void> {
	for (let index = 0; index < parsed.frames.length; index++) {
		throwIfAborted(signal);
		yield await restoreFrameAsync(container, parsed, index, operation, run);
	}
}

function restoreFrame(
	container: Uint8Array,
	parsed: ParsedContainer,
	index: number,
	operation: OwnedProfileOperation
): Uint8Array {
	const entry = parsed.frames[index];
	const value = decodeValue(
		openPayloadOwned(container.subarray(entry.offset, entry.offset + entry.length), operation)
	);
	if (!isBytes(value)) {
		throw new FiseError("INVALID_PAYLOAD", `FISE: frame ${index} is not binary data.`);
	}
	const expectedLength = Math.min(
		parsed.frameSize,
		parsed.plaintextLength - index * parsed.frameSize
	);
	if (value.length !== expectedLength) {
		throw new FiseError(
			"LENGTH_MISMATCH",
			`FISE: frame ${index} restored ${value.length} bytes; expected ${expectedLength}.`
		);
	}
	return value;
}

async function restoreFrameAsync(
	container: Uint8Array,
	parsed: ParsedContainer,
	index: number,
	operation: OwnedProfileOperation,
	run: ProfileAsyncKernelRunner
): Promise<Uint8Array> {
	const entry = parsed.frames[index];
	const value = decodeValue(await openPayloadOwnedAsync(
		container.subarray(entry.offset, entry.offset + entry.length),
		operation,
		run
	));
	if (!isBytes(value)) {
		throw new FiseError("INVALID_PAYLOAD", `FISE: frame ${index} is not binary data.`);
	}
	const expectedLength = Math.min(
		parsed.frameSize,
		parsed.plaintextLength - index * parsed.frameSize
	);
	if (value.length !== expectedLength) {
		throw new FiseError(
			"LENGTH_MISMATCH",
			`FISE: frame ${index} restored ${value.length} bytes; expected ${expectedLength}.`
		);
	}
	return value;
}

function assembleContainer(
	frames: readonly Uint8Array[],
	operation: OwnedProfileOperation,
	frameSize: number,
	plaintextLength: number
): Uint8Array {
	const indexLength = checkedMultiply(frames.length, INDEX_ENTRY_LENGTH, "frame index");
	let totalLength = HEADER_LENGTH + indexLength;
	for (const frame of frames) totalLength = checkedAdd(totalLength, frame.length, "container");
	if (totalLength > MAX_CONTAINER_LENGTH || totalLength > MAX_UINT32) {
		throw new FiseError("FRAME_LIMIT", "FISE: framed container exceeds its limit.");
	}
	const output = allocate(totalLength, "framed container");
	output.set(MAGIC, 0);
	output[4] = FISF_WIRE_VERSION.major;
	output[5] = FISF_WIRE_VERSION.minor;
	const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
	view.setUint16(6, HEADER_LENGTH, false);
	output.set(operation.runtime.fingerprint, 8);
	view.setUint32(24, frameSize, false);
	view.setUint32(28, plaintextLength, false);
	view.setUint32(32, frames.length, false);
	view.setUint32(36, calculateContainerMarker(plaintextLength, operation), false);
	let position = HEADER_LENGTH + indexLength;
	for (let index = 0; index < frames.length; index++) {
		const entryPosition = HEADER_LENGTH + index * INDEX_ENTRY_LENGTH;
		view.setUint32(entryPosition, position, false);
		view.setUint32(entryPosition + 4, frames[index].length, false);
		output.set(frames[index], position);
		position += frames[index].length;
	}
	return output;
}

function ownAndParse(
	container: Uint8Array,
	profile: Profile
): Readonly<{ container: Uint8Array; parsed: ParsedContainer }> {
	if (!isBytes(container)) {
		throw new FiseError("INVALID_ENVELOPE", "FISE: framed container must be a Uint8Array.");
	}
	const owned = copyBytes(container);
	if (owned.length > MAX_CONTAINER_LENGTH) {
		throw new FiseError("FRAME_LIMIT", "FISE: framed container exceeds its limit.");
	}
	return Object.freeze({ container: owned, parsed: parseContainer(owned, profile) });
}

function parseContainer(container: Uint8Array, profile: Profile): ParsedContainer {
	if (container.length < HEADER_LENGTH) {
		throw new FiseError("INVALID_ENVELOPE", "FISE: framed container is shorter than its header.");
	}
	for (let index = 0; index < MAGIC.length; index++) {
		if (container[index] !== MAGIC[index]) {
			throw new FiseError("INVALID_ENVELOPE", "FISE: FISF magic is missing.");
		}
	}
	if (
		container[4] !== FISF_WIRE_VERSION.major ||
		container[5] !== FISF_WIRE_VERSION.minor
	) {
		throw new FiseError(
			"UNSUPPORTED_VERSION",
			`FISE: unsupported FISF version ${container[4]}.${container[5]}.`
		);
	}
	const view = new DataView(container.buffer, container.byteOffset, container.byteLength);
	if (view.getUint16(6, false) !== HEADER_LENGTH) {
		throw new FiseError("INVALID_ENVELOPE", "FISE: invalid FISF header fields.");
	}
	if (!bytesEqual(container.subarray(8, 24), runtimeOf(profile).fingerprint)) {
		throw new FiseError("PROFILE_MISMATCH", "FISE: FISF container belongs to another profile.");
	}
	const frameSize = view.getUint32(24, false);
	const plaintextLength = view.getUint32(28, false);
	const frameCount = view.getUint32(32, false);
	const contextMarker = view.getUint32(36, false);
	assertFramedInputLength(plaintextLength);
	if (frameSize < 1) throw new FiseError("INVALID_ENVELOPE", "FISE: frame size must be positive.");
	assertFrameCount(frameCount);
	const expectedFrameCount = plaintextLength === 0 ? 0 : Math.ceil(plaintextLength / frameSize);
	if (frameCount !== expectedFrameCount) {
		throw new FiseError("INVALID_ENVELOPE", "FISE: frame count does not match plaintext length.");
	}
	const indexLength = checkedMultiply(frameCount, INDEX_ENTRY_LENGTH, "frame index");
	let expectedOffset = checkedAdd(HEADER_LENGTH, indexLength, "frame index");
	if (expectedOffset > container.length) {
		throw new FiseError("INVALID_ENVELOPE", "FISE: frame index exceeds container length.");
	}
	const frames: FrameEntry[] = [];
	for (let index = 0; index < frameCount; index++) {
		const entryPosition = HEADER_LENGTH + index * INDEX_ENTRY_LENGTH;
		const offset = view.getUint32(entryPosition, false);
		const length = view.getUint32(entryPosition + 4, false);
		if (offset !== expectedOffset || length < 1) {
			throw new FiseError("INVALID_ENVELOPE", `FISE: invalid frame index entry ${index}.`);
		}
		expectedOffset = checkedAdd(offset, length, `frame ${index}`);
		if (expectedOffset > container.length) {
			throw new FiseError("INVALID_ENVELOPE", `FISE: frame ${index} exceeds container length.`);
		}
		frames.push(Object.freeze({ offset, length }));
	}
	if (expectedOffset !== container.length) {
		throw new FiseError("LENGTH_MISMATCH", "FISE: framed container has trailing or missing bytes.");
	}
	return Object.freeze({
		frameSize,
		plaintextLength,
		contextMarker,
		frames: Object.freeze(frames)
	});
}

function calculateContainerMarker(
	plaintextLength: number,
	operation: OwnedProfileOperation
): number {
	return profileMarker(
		operation.runtime,
		Object.freeze({
			transformedLength: plaintextLength,
			encodedContextLength: operation.encodedContextLength,
			contextSegmentLength: operation.contextSegment.length
		}),
		operation.contextState,
		operation.contextSegment,
		operation.context
	);
}

function assertContainerMarker(
	parsed: ParsedContainer,
	operation: OwnedProfileOperation
): void {
	if (parsed.contextMarker !== calculateContainerMarker(parsed.plaintextLength, operation)) {
		throw new FiseError(
			"MARKER_MISMATCH",
			"FISE: framed container marker does not match the selected profile and context."
		);
	}
}

function normalizeFrameSize(options: FiseFramedOptions): number {
	if (!options || typeof options !== "object" || Array.isArray(options)) {
		throw new FiseError("INVALID_INPUT", "FISE: framed options must be an object.");
	}
	for (const key of Reflect.ownKeys(options)) {
		if (typeof key === "symbol" || key !== "frameSize") {
			throw new FiseError("INVALID_INPUT", "FISE: framed options contain an unknown field.");
		}
		const descriptor = Object.getOwnPropertyDescriptor(options, key);
		if (!descriptor || !("value" in descriptor)) {
			throw new FiseError("INVALID_INPUT", "FISE: framed options must not contain accessors.");
		}
	}
	const descriptor = Object.getOwnPropertyDescriptor(options, "frameSize");
	const value = descriptor && "value" in descriptor
		? descriptor.value
		: DEFAULT_FRAME_SIZE;
	if (!Number.isInteger(value) || value < 1 || value > MAX_UINT32) {
		throw new FiseError("INVALID_INPUT", "FISE: frameSize must be a positive uint32.");
	}
	return value;
}

function normalizeRange(range: FiseRange): FiseRange {
	if (!range || typeof range !== "object" || Array.isArray(range)) {
		throw new FiseError("INVALID_RANGE", "FISE: range must be an object.");
	}
	const keys = Reflect.ownKeys(range);
	if (
		keys.some(key => typeof key === "symbol" || (key !== "start" && key !== "endExclusive"))
	) {
		throw new FiseError("INVALID_RANGE", "FISE: range contains an unknown field.");
	}
	for (const key of ["start", "endExclusive"] as const) {
		const descriptor = Object.getOwnPropertyDescriptor(range, key);
		if (!descriptor || !("value" in descriptor)) {
			throw new FiseError("INVALID_RANGE", `FISE: range.${key} must be an own data property.`);
		}
	}
	const startDescriptor = Object.getOwnPropertyDescriptor(range, "start")!;
	const endDescriptor = Object.getOwnPropertyDescriptor(range, "endExclusive")!;
	const start = startDescriptor.value;
	const endExclusive = endDescriptor.value;
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(endExclusive) ||
		start < 0 ||
		endExclusive < start
	) {
		throw new FiseError("INVALID_RANGE", "FISE: range must be a valid half-open byte interval.");
	}
	return Object.freeze({ start, endExclusive });
}

function normalizeSignal(options: FiseProgressiveOptions): AbortSignal | undefined {
	if (!options || typeof options !== "object" || Array.isArray(options)) {
		throw new FiseError("INVALID_INPUT", "FISE: progressive options must be an object.");
	}
	const keys = Reflect.ownKeys(options);
	if (keys.some(key => typeof key === "symbol" || key !== "signal")) {
		throw new FiseError("INVALID_INPUT", "FISE: progressive options contain an unknown field.");
	}
	if (!Object.prototype.hasOwnProperty.call(options, "signal")) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(options, "signal");
	if (!descriptor || !("value" in descriptor)) {
		throw new FiseError("INVALID_INPUT", "FISE: progressive signal must be an own data property.");
	}
	const signal = descriptor.value;
	if (
		signal !== undefined &&
		(!signal || typeof signal !== "object" || typeof signal.aborted !== "boolean")
	) {
		throw new FiseError("INVALID_INPUT", "FISE: progressive signal must be an AbortSignal.");
	}
	return signal as AbortSignal | undefined;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw new FiseError("OPERATION_ABORTED", "FISE: progressive restoration was aborted.");
	}
}

function checkedAdd(left: number, right: number, label: string): number {
	const value = left + right;
	if (!Number.isSafeInteger(value) || value > MAX_UINT32) {
		throw new FiseError("FRAME_LIMIT", `FISE: ${label} length exceeds uint32.`);
	}
	return value;
}

function assertFramedInputLength(length: number): void {
	if (!Number.isSafeInteger(length) || length < 0 || length > MAX_CONTAINER_LENGTH) {
		throw new FiseError(
			"FRAME_LIMIT",
			`FISE: framed plaintext must not exceed ${MAX_CONTAINER_LENGTH} bytes.`
		);
	}
}

function assertFrameCount(frameCount: number): void {
	if (!Number.isSafeInteger(frameCount) || frameCount < 0 || frameCount > MAX_FRAME_COUNT) {
		throw new FiseError(
			"FRAME_LIMIT",
			`FISE: frame count must not exceed ${MAX_FRAME_COUNT}.`
		);
	}
}

function checkedMultiply(left: number, right: number, label: string): number {
	const value = left * right;
	if (!Number.isSafeInteger(value) || value > MAX_UINT32) {
		throw new FiseError("FRAME_LIMIT", `FISE: ${label} length exceeds uint32.`);
	}
	return value;
}

function allocate(length: number, label: string): Uint8Array {
	try {
		return new Uint8Array(length);
	} catch (error) {
		throw new FiseError("FRAME_LIMIT", `FISE: unable to allocate ${label}.`, error);
	}
}

import { FiseError } from "../errors.js";
import { assertBytes, byteLengthOf, bytesEqual, copyBytes } from "./bytes.js";
import { prepareContext } from "./codec.js";
import {
	deriveProfileContextSegment,
	mixProfileContext,
	profileMarker,
	profileOffset,
	runProfileKernel,
	runtimeOf,
	type Profile,
	type ProfileAsyncKernelRunner,
	type ProfileContextState,
	type ProfileKernelRunner,
	type ProfileRuntime
} from "./profile.js";
import type { FiseContext } from "./types.js";

const MAGIC = Uint8Array.of(0x46, 0x49, 0x53, 0x45);
const HEADER_LENGTH = 32;
const MARKER_LENGTH = 4;
const MAX_UINT32 = 0xffff_ffff;
const MAX_ENVELOPE_LENGTH = 512 * 1024 * 1024;

export const FISE_WIRE_VERSION = Object.freeze({ major: 2, minor: 0 });

export interface OwnedProfileOperation {
	readonly runtime: ProfileRuntime;
	readonly context: FiseContext;
	readonly contextState: ProfileContextState;
	readonly contextSegment: Uint8Array;
	readonly encodedContextLength: number;
	readonly run: ProfileKernelRunner;
}

export function ownProfileOperation(
	profile: Profile,
	context: unknown,
	run: ProfileKernelRunner = runProfileKernel
): OwnedProfileOperation {
	const runtime = runtimeOf(profile);
	const prepared = prepareContext(context);
	return Object.freeze({
		runtime,
		context: prepared.value,
		contextState: mixProfileContext(runtime, prepared.encoded, prepared.value),
		contextSegment: deriveProfileContextSegment(runtime, prepared.encoded),
		encodedContextLength: prepared.encoded.length,
		run
	});
}

export function sealPayload(
	payload: Uint8Array,
	profile: Profile,
	context: unknown,
	run: ProfileKernelRunner = runProfileKernel
): Uint8Array {
	return sealPayloadOwned(payload, ownProfileOperation(profile, context, run));
}

export function sealPayloadOwned(
	payload: Uint8Array,
	owned: OwnedProfileOperation
): Uint8Array {
	assertPayloadLength(payload.length);
	checkedEnvelopeLength(payload.length);
	const transformed = owned.run(
		"forward",
		owned.runtime,
		payload,
		owned.contextSegment,
		owned.contextState,
		0,
		owned.context
	);
	return assembleTransformed(transformed, owned, payload.length);
}

export async function sealPayloadAsync(
	payload: Uint8Array,
	profile: Profile,
	context: unknown,
	run: ProfileAsyncKernelRunner
): Promise<Uint8Array> {
	return sealPayloadOwnedAsync(payload, ownProfileOperation(profile, context), run);
}

export async function sealPayloadOwnedAsync(
	payload: Uint8Array,
	owned: OwnedProfileOperation,
	run: ProfileAsyncKernelRunner
): Promise<Uint8Array> {
	assertPayloadLength(payload.length);
	checkedEnvelopeLength(payload.length);
	const transformed = await run(
		"forward",
		owned.runtime,
		copyBytes(payload),
		copyBytes(owned.contextSegment),
		owned.contextState,
		0,
		owned.context
	);
	return assembleTransformed(transformed, owned, payload.length);
}

function assembleTransformed(
	transformed: Uint8Array,
	owned: OwnedProfileOperation,
	expectedLength: number
): Uint8Array {
	assertBytes(transformed, "forward kernel output", "INVALID_PROFILE");
	if (transformed.length !== expectedLength) {
		throw new FiseError("INVALID_PROFILE", "FISE: forward kernel changed byte length.");
	}
	assertPayloadLength(transformed.length);
	const layout = layoutOf(transformed.length, owned);
	const offset = profileOffset(
		owned.runtime,
		layout,
		owned.contextState,
		owned.contextSegment,
		owned.context
	);
	const marker = profileMarker(
		owned.runtime,
		layout,
		owned.contextState,
		owned.contextSegment,
		owned.context
	);
	const output = allocate(checkedEnvelopeLength(transformed.length), "envelope");
	writeHeader(output, owned.runtime.fingerprint, transformed.length);
	let position = HEADER_LENGTH;
	output.set(transformed.subarray(0, offset), position);
	position += offset;
	new DataView(output.buffer, output.byteOffset, output.byteLength).setUint32(
		position,
		marker,
		false
	);
	position += MARKER_LENGTH;
	output.set(transformed.subarray(offset), position);
	return output;
}

export function openPayload(
	envelope: Uint8Array,
	profile: Profile,
	context: unknown,
	run: ProfileKernelRunner = runProfileKernel
): Uint8Array {
	const ownedEnvelope = ownEnvelopeForProfile(envelope, profile);
	return openPayloadOwned(ownedEnvelope, ownProfileOperation(profile, context, run));
}

export function openPayloadOwned(
	envelope: Uint8Array,
	owned: OwnedProfileOperation
): Uint8Array {
	const transformed = extractTransformed(envelope, owned);
	return owned.run(
		"reverse",
		owned.runtime,
		transformed,
		owned.contextSegment,
		owned.contextState,
		0,
		owned.context
	);
}

export async function openPayloadAsync(
	envelope: Uint8Array,
	profile: Profile,
	context: unknown,
	run: ProfileAsyncKernelRunner
): Promise<Uint8Array> {
	const ownedEnvelope = ownEnvelopeForProfile(envelope, profile);
	return openPayloadOwnedAsync(ownedEnvelope, ownProfileOperation(profile, context), run);
}

export async function openPayloadOwnedAsync(
	envelope: Uint8Array,
	owned: OwnedProfileOperation,
	run: ProfileAsyncKernelRunner
): Promise<Uint8Array> {
	const transformed = extractTransformed(envelope, owned);
	const output = await run(
		"reverse",
		owned.runtime,
		transformed,
		owned.contextSegment,
		owned.contextState,
		0,
		owned.context
	);
	assertBytes(output, "reverse kernel output", "INVALID_PROFILE");
	if (output.length !== transformed.length) {
		throw new FiseError("INVALID_PROFILE", "FISE: async reverse kernel changed byte length.");
	}
	return output;
}

function extractTransformed(
	envelope: Uint8Array,
	owned: OwnedProfileOperation
): Uint8Array {
	assertEnvelope(envelope);
	const header = parseHeader(envelope);
	if (!bytesEqual(header.fingerprint, owned.runtime.fingerprint)) {
		throw new FiseError("PROFILE_MISMATCH", "FISE: envelope belongs to a different profile.");
	}
	const expectedLength = checkedEnvelopeLength(header.transformedLength);
	if (envelope.length !== expectedLength) {
		throw new FiseError(
			"LENGTH_MISMATCH",
			`FISE: envelope length ${envelope.length} does not match declared length ${expectedLength}.`
		);
	}

	const layout = layoutOf(header.transformedLength, owned);
	const offset = profileOffset(
		owned.runtime,
		layout,
		owned.contextState,
		owned.contextSegment,
		owned.context
	);
	const markerPosition = HEADER_LENGTH + offset;
	const actualMarker = new DataView(
		envelope.buffer,
		envelope.byteOffset,
		envelope.byteLength
	).getUint32(markerPosition, false);
	const expectedMarker = profileMarker(
		owned.runtime,
		layout,
		owned.contextState,
		owned.contextSegment,
		owned.context
	);
	if (actualMarker !== expectedMarker) {
		throw new FiseError(
			"MARKER_MISMATCH",
			"FISE: envelope marker does not match the selected profile and context."
		);
	}

	const transformedEnd = HEADER_LENGTH + header.transformedLength + MARKER_LENGTH;
	const transformed = allocate(header.transformedLength, "transformed payload");
	transformed.set(envelope.subarray(HEADER_LENGTH, markerPosition), 0);
	transformed.set(envelope.subarray(markerPosition + MARKER_LENGTH, transformedEnd), offset);
	return transformed;
}

function layoutOf(
	transformedLength: number,
	owned: OwnedProfileOperation
) {
	return Object.freeze({
		transformedLength,
		encodedContextLength: owned.encodedContextLength,
		contextSegmentLength: owned.contextSegment.length
	});
}

interface ParsedHeader {
	readonly fingerprint: Uint8Array;
	readonly transformedLength: number;
}

function ownEnvelopeForProfile(envelope: Uint8Array, profile: Profile): Uint8Array {
	assertEnvelope(envelope);
	const ownedEnvelope = copyBytes(envelope);
	const header = parseHeader(ownedEnvelope);
	if (!bytesEqual(header.fingerprint, runtimeOf(profile).fingerprint)) {
		throw new FiseError("PROFILE_MISMATCH", "FISE: envelope belongs to a different profile.");
	}
	const expectedLength = checkedEnvelopeLength(header.transformedLength);
	if (ownedEnvelope.length !== expectedLength) {
		throw new FiseError(
			"LENGTH_MISMATCH",
			`FISE: envelope length ${ownedEnvelope.length} does not match declared length ${expectedLength}.`
		);
	}
	return ownedEnvelope;
}

function writeHeader(
	output: Uint8Array,
	fingerprint: Uint8Array,
	transformedLength: number
): void {
	output.set(MAGIC, 0);
	output[4] = FISE_WIRE_VERSION.major;
	output[5] = FISE_WIRE_VERSION.minor;
	output[6] = HEADER_LENGTH;
	output[7] = 0;
	output.set(fingerprint, 8);
	const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
	view.setUint32(24, transformedLength, false);
	view.setUint32(28, 0, false);
}

function parseHeader(envelope: Uint8Array): ParsedHeader {
	if (envelope.length < HEADER_LENGTH) {
		throw new FiseError("INVALID_ENVELOPE", "FISE: envelope is shorter than its header.");
	}
	for (let index = 0; index < MAGIC.length; index++) {
		if (envelope[index] !== MAGIC[index]) {
			throw new FiseError("INVALID_ENVELOPE", "FISE: envelope magic is missing.");
		}
	}
	if (
		envelope[4] !== FISE_WIRE_VERSION.major ||
		envelope[5] !== FISE_WIRE_VERSION.minor
	) {
		throw new FiseError(
			"UNSUPPORTED_VERSION",
			`FISE: unsupported wire version ${envelope[4]}.${envelope[5]}.`
		);
	}
	if (envelope[6] !== HEADER_LENGTH || envelope[7] !== 0) {
		throw new FiseError("INVALID_ENVELOPE", "FISE: invalid header length or flags.");
	}
	const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
	if (view.getUint32(28, false) !== 0) {
		throw new FiseError("INVALID_ENVELOPE", "FISE: reserved header bytes must be zero.");
	}
	return Object.freeze({
		fingerprint: copyBytes(envelope.subarray(8, 24)),
		transformedLength: view.getUint32(24, false)
	});
}

function assertEnvelope(envelope: Uint8Array): void {
	if (
		!(envelope instanceof Uint8Array) &&
		Object.prototype.toString.call(envelope) !== "[object Uint8Array]"
	) {
		throw new FiseError("INVALID_ENVELOPE", "FISE: envelope must be a Uint8Array.");
	}
	if (byteLengthOf(envelope) > MAX_ENVELOPE_LENGTH) {
		throw new FiseError("ENVELOPE_LIMIT", "FISE: envelope exceeds the runtime limit.");
	}
}

function assertPayloadLength(length: number): void {
	if (!Number.isSafeInteger(length) || length < 0 || length > MAX_UINT32) {
		throw new FiseError("ENVELOPE_LIMIT", "FISE: payload length must fit uint32.");
	}
}

function checkedEnvelopeLength(transformedLength: number): number {
	assertPayloadLength(transformedLength);
	const length = HEADER_LENGTH + transformedLength + MARKER_LENGTH;
	if (!Number.isSafeInteger(length) || length > MAX_ENVELOPE_LENGTH) {
		throw new FiseError("ENVELOPE_LIMIT", "FISE: envelope exceeds the runtime limit.");
	}
	return length;
}

function allocate(length: number, label: string): Uint8Array {
	try {
		return new Uint8Array(length);
	} catch (error) {
		throw new FiseError("ENVELOPE_LIMIT", `FISE: unable to allocate ${label}.`, error);
	}
}

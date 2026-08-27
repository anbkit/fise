import { FiseError } from "../errors.js";
import {
	assertBytes,
	bytesEqual,
	canBorrowBytesForSynchronousRead,
	checkedByteLength,
	copyByteRangeAtLength,
	copyBytes,
	snapshotByteRangeAtLength,
	snapshotBytePrefix,
	snapshotBytes,
	snapshotBytesAtLength
} from "./bytes.js";
import {
	assertBinaryPayloadMetadata,
	FISE_VALUE_METADATA_LENGTH,
	prepareContext
} from "./codec.js";
import {
	bindEnvelopeStateToEncodedContext,
	FULL_ENVELOPE_COVERAGE,
	type EnvelopeCoverage
} from "./coverage.js";
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
import {
	assertEnvelopeFresh,
	assertExpiresAtSeconds,
	NO_EXPIRY_SECONDS,
	systemFiseClock,
	type FiseClock
} from "./temporal.js";

const MAGIC = Uint8Array.of(0x46, 0x49, 0x53, 0x45);
const HEADER_LENGTH = 40;
const MARKER_LENGTH = 4;
const MAX_UINT32 = 0xffff_ffff;
const EDGE_COVERAGE_FLAG = 0x01;

export const FISE_MAX_ENVELOPE_LENGTH = 512 * 1024 * 1024;
export const FISE_WIRE_VERSION = Object.freeze({ major: 2, minor: 0 });
export const FISE_ENVELOPE_OVERHEAD = HEADER_LENGTH + MARKER_LENGTH;

export function assertBinaryContentEnvelopeCapacity(contentLength: number): void {
	if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
		throw new FiseError("INVALID_INPUT", "FISE: binary input length is invalid.");
	}
	checkedEnvelopeLength(FISE_VALUE_METADATA_LENGTH + contentLength);
}

export interface OwnedProfileOperation {
	readonly runtime: ProfileRuntime;
	readonly context: FiseContext;
	readonly contextState: ProfileContextState;
	readonly contextSegment: Uint8Array;
	readonly operationBindingLength: number;
	readonly run: ProfileKernelRunner;
}

export interface OwnedBinaryEnvelope {
	readonly envelope: Uint8Array;
	readonly operation: OwnedProfileOperation;
	readonly transformedLength: number;
	readonly markerOffset: number;
	readonly contentLength: number;
	readonly coverage: EnvelopeCoverage;
}

interface ParsedHeader {
	readonly fingerprint: Uint8Array;
	readonly transformedLength: number;
	readonly expiresAtSeconds: bigint;
	readonly coverage: EnvelopeCoverage;
}

interface OwnedEnvelope {
	readonly envelope: Uint8Array;
	readonly header: ParsedHeader;
}

type EnvelopeOwnership = "complete" | "synchronous";

interface ValidatedEnvelope {
	readonly envelope: Uint8Array;
	readonly operation: OwnedProfileOperation;
	readonly transformedLength: number;
	readonly markerOffset: number;
	readonly coverage: EnvelopeCoverage;
}

export function ownProfileOperation(
	profile: Profile,
	context: unknown,
	run: ProfileKernelRunner = runProfileKernel,
	expiresAtSeconds: bigint = NO_EXPIRY_SECONDS,
	coverage: EnvelopeCoverage = FULL_ENVELOPE_COVERAGE
): OwnedProfileOperation {
	const runtime = runtimeOf(profile);
	const prepared = prepareContext(context);
	const operationBinding = bindEnvelopeStateToEncodedContext(
		prepared.encoded,
		expiresAtSeconds,
		coverage
	);
	return Object.freeze({
		runtime,
		context: prepared.value,
		contextState: mixProfileContext(runtime, operationBinding, prepared.value),
		contextSegment: deriveProfileContextSegment(runtime, operationBinding),
		operationBindingLength: operationBinding.length,
		run
	});
}

export function sealPayload(
	payload: Uint8Array,
	profile: Profile,
	context: unknown,
	run: ProfileKernelRunner = runProfileKernel,
	expiresAtSeconds: bigint = NO_EXPIRY_SECONDS,
	coverage: EnvelopeCoverage = FULL_ENVELOPE_COVERAGE
): Uint8Array {
	const owned = ownProfileOperation(profile, context, run, expiresAtSeconds, coverage);
	assertPayloadLength(payload.length);
	checkedEnvelopeLength(payload.length);
	const transformed = runCoveredKernel("forward", payload, owned, coverage);
	return assembleTransformed(
		transformed,
		owned,
		payload.length,
		expiresAtSeconds,
		coverage
	);
}

export async function sealPayloadAsync(
	payload: Uint8Array,
	profile: Profile,
	context: unknown,
	run: ProfileAsyncKernelRunner,
	expiresAtSeconds: bigint = NO_EXPIRY_SECONDS,
	coverage: EnvelopeCoverage = FULL_ENVELOPE_COVERAGE
): Promise<Uint8Array> {
	const owned = ownProfileOperation(
		profile,
		context,
		runProfileKernel,
		expiresAtSeconds,
		coverage
	);
	assertPayloadLength(payload.length);
	checkedEnvelopeLength(payload.length);
	const transformed = await runCoveredKernelAsync("forward", payload, owned, coverage, run);
	return assembleTransformed(
		transformed,
		owned,
		payload.length,
		expiresAtSeconds,
		coverage
	);
}

export function openPayload(
	envelope: Uint8Array,
	profile: Profile,
	context: unknown,
	run: ProfileKernelRunner = runProfileKernel,
	clock: FiseClock = systemFiseClock
): Uint8Array {
	const owned = ownValidatedEnvelope(envelope, profile, context, run, clock, "synchronous");
	const restored = runCoveredKernel(
		"reverse",
		copyTransformedRange(owned, 0, owned.transformedLength),
		owned.operation,
		owned.coverage
	);
	assertCoveragePayload(restored, owned.coverage);
	return restored;
}

export async function openPayloadAsync(
	envelope: Uint8Array,
	profile: Profile,
	context: unknown,
	run: ProfileAsyncKernelRunner,
	clock: FiseClock = systemFiseClock
): Promise<Uint8Array> {
	const owned = ownValidatedEnvelope(
		envelope,
		profile,
		context,
		runProfileKernel,
		clock
	);
	const restored = await runCoveredKernelAsync(
		"reverse",
		copyTransformedRange(owned, 0, owned.transformedLength),
		owned.operation,
		owned.coverage,
		run
	);
	assertCoveragePayload(restored, owned.coverage);
	return restored;
}

export function ownBinaryEnvelope(
	envelope: Uint8Array,
	profile: Profile,
	context: unknown,
	run: ProfileKernelRunner = runProfileKernel,
	clock: FiseClock = systemFiseClock,
	ownership: EnvelopeOwnership = "complete"
): OwnedBinaryEnvelope {
	const owned = ownValidatedEnvelope(envelope, profile, context, run, clock, ownership);
	const metadata = owned.operation.run(
		"reverse",
		owned.operation.runtime,
		copyTransformedRange(owned, 0, Math.min(FISE_VALUE_METADATA_LENGTH, owned.transformedLength)),
		owned.operation.contextSegment,
		owned.operation.contextState,
		0,
		owned.operation.context
	);
	assertBinaryPayloadMetadata(metadata);
	return toOwnedBinaryEnvelope(owned);
}

export async function ownBinaryEnvelopeAsync(
	envelope: Uint8Array,
	profile: Profile,
	context: unknown,
	run: ProfileAsyncKernelRunner,
	clock: FiseClock = systemFiseClock
): Promise<OwnedBinaryEnvelope> {
	const owned = ownValidatedEnvelope(
		envelope,
		profile,
		context,
		runProfileKernel,
		clock
	);
	const metadataLength = Math.min(FISE_VALUE_METADATA_LENGTH, owned.transformedLength);
	const metadata = await runReverseAsync(
		copyTransformedRange(owned, 0, metadataLength),
		0,
		owned.operation,
		run
	);
	assertBinaryPayloadMetadata(metadata);
	return toOwnedBinaryEnvelope(owned);
}

export function restoreBinaryRange(
	owned: OwnedBinaryEnvelope,
	start: number,
	endExclusive: number
): Uint8Array {
	if (start === endExclusive) return new Uint8Array();
	const transformedStart = FISE_VALUE_METADATA_LENGTH + start;
	const transformedEnd = FISE_VALUE_METADATA_LENGTH + endExclusive;
	return restoreCoveredRange(
		copyTransformedRange(owned, transformedStart, transformedEnd),
		transformedStart,
		owned.transformedLength,
		owned.operation,
		owned.coverage
	);
}

export async function restoreBinaryRangeAsync(
	owned: OwnedBinaryEnvelope,
	start: number,
	endExclusive: number,
	run: ProfileAsyncKernelRunner
): Promise<Uint8Array> {
	if (start === endExclusive) return new Uint8Array();
	const transformedStart = FISE_VALUE_METADATA_LENGTH + start;
	const transformedEnd = FISE_VALUE_METADATA_LENGTH + endExclusive;
	return restoreCoveredRangeAsync(
		copyTransformedRange(owned, transformedStart, transformedEnd),
		transformedStart,
		owned.transformedLength,
		owned.operation,
		owned.coverage,
		run
	);
}

function toOwnedBinaryEnvelope(owned: ValidatedEnvelope): OwnedBinaryEnvelope {
	return Object.freeze({
		envelope: owned.envelope,
		operation: owned.operation,
		transformedLength: owned.transformedLength,
		markerOffset: owned.markerOffset,
		contentLength: owned.transformedLength - FISE_VALUE_METADATA_LENGTH,
		coverage: owned.coverage
	});
}

function ownValidatedEnvelope(
	envelope: Uint8Array,
	profile: Profile,
	context: unknown,
	run: ProfileKernelRunner,
	clock: FiseClock,
	ownership: EnvelopeOwnership = "complete"
): ValidatedEnvelope {
	const ownedEnvelope = ownEnvelopeForProfile(envelope, profile, ownership);
	const operation = ownProfileOperation(
		profile,
		context,
		run,
		ownedEnvelope.header.expiresAtSeconds,
		ownedEnvelope.header.coverage
	);
	const layout = layoutOf(ownedEnvelope.header.transformedLength, operation);
	const markerOffset = profileOffset(
		operation.runtime,
		layout,
		operation.contextState,
		operation.contextSegment,
		operation.context
	);
	const markerPosition = HEADER_LENGTH + markerOffset;
	const markerBytes = snapshotByteRangeAtLength(
		ownedEnvelope.envelope,
		checkedEnvelopeLength(ownedEnvelope.header.transformedLength),
		markerPosition,
		markerPosition + MARKER_LENGTH,
		"envelope",
		"INVALID_ENVELOPE"
	);
	const actualMarker = new DataView(markerBytes.buffer).getUint32(0, false);
	const expectedMarker = profileMarker(
		operation.runtime,
		layout,
		operation.contextState,
		operation.contextSegment,
		operation.context
	);
	if (actualMarker !== expectedMarker) {
		throw new FiseError(
			"MARKER_MISMATCH",
			"FISE: envelope marker does not match the selected profile and context."
		);
	}
	assertEnvelopeFresh(ownedEnvelope.header.expiresAtSeconds, clock);
	return Object.freeze({
		envelope: ownedEnvelope.envelope,
		operation,
		transformedLength: ownedEnvelope.header.transformedLength,
		markerOffset,
		coverage: ownedEnvelope.header.coverage
	});
}

function copyTransformedRange(
	owned: Pick<ValidatedEnvelope, "envelope" | "markerOffset" | "transformedLength">,
	start: number,
	endExclusive: number
): Uint8Array {
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(endExclusive) ||
		start < 0 ||
		endExclusive < start ||
		endExclusive > owned.transformedLength
	) {
		throw new FiseError("INVALID_RANGE", "FISE: transformed byte range is invalid.");
	}
	const output = allocate(endExclusive - start, "transformed range");
	const expectedEnvelopeLength = checkedEnvelopeLength(owned.transformedLength);
	if (endExclusive <= owned.markerOffset) {
		copyByteRangeAtLength(
			owned.envelope,
			expectedEnvelopeLength,
			HEADER_LENGTH + start,
			HEADER_LENGTH + endExclusive,
			output,
			0,
			"envelope",
			"INVALID_ENVELOPE"
		);
		return output;
	}
	if (start >= owned.markerOffset) {
		copyByteRangeAtLength(
			owned.envelope,
			expectedEnvelopeLength,
			HEADER_LENGTH + MARKER_LENGTH + start,
			HEADER_LENGTH + MARKER_LENGTH + endExclusive,
			output,
			0,
			"envelope",
			"INVALID_ENVELOPE"
		);
		return output;
	}
	const beforeLength = owned.markerOffset - start;
	copyByteRangeAtLength(
		owned.envelope,
		expectedEnvelopeLength,
		HEADER_LENGTH + start,
		HEADER_LENGTH + owned.markerOffset,
		output,
		0,
		"envelope",
		"INVALID_ENVELOPE"
	);
	copyByteRangeAtLength(
		owned.envelope,
		expectedEnvelopeLength,
		HEADER_LENGTH + MARKER_LENGTH + owned.markerOffset,
		HEADER_LENGTH + MARKER_LENGTH + endExclusive,
		output,
		beforeLength,
		"envelope",
		"INVALID_ENVELOPE"
	);
	return output;
}

function assembleTransformed(
	transformed: Uint8Array,
	owned: OwnedProfileOperation,
	expectedLength: number,
	expiresAtSeconds: bigint,
	coverage: EnvelopeCoverage
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
	writeHeader(
		output,
		owned.runtime.fingerprint,
		transformed.length,
		expiresAtSeconds,
		coverage
	);
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

function ownEnvelopeForProfile(
	envelope: Uint8Array,
	profile: Profile,
	ownership: EnvelopeOwnership
): OwnedEnvelope {
	const envelopeLength = checkedEnvelopeInputLength(envelope);
	const preflightHeader = parseHeader(snapshotBytePrefix(
		envelope,
		HEADER_LENGTH,
		"envelope",
		"INVALID_ENVELOPE"
	));
	assertHeaderForProfileAndLength(preflightHeader, profile, envelopeLength);
	const ownedEnvelope =
		ownership === "synchronous" && canBorrowBytesForSynchronousRead(envelope)
			? envelope
			: snapshotBytesAtLength(
				envelope,
				envelopeLength,
				"envelope",
				"INVALID_ENVELOPE"
			);
	const header = parseHeader(ownedEnvelope);
	assertHeaderForProfileAndLength(header, profile, ownedEnvelope.length);
	return Object.freeze({ envelope: ownedEnvelope, header });
}

function assertHeaderForProfileAndLength(
	header: ParsedHeader,
	profile: Profile,
	actualLength: number
): void {
	if (!bytesEqual(header.fingerprint, runtimeOf(profile).fingerprint)) {
		throw new FiseError("PROFILE_MISMATCH", "FISE: envelope belongs to a different profile.");
	}
	const expectedLength = checkedEnvelopeLength(header.transformedLength);
	if (actualLength !== expectedLength) {
		throw new FiseError(
			"LENGTH_MISMATCH",
			`FISE: envelope length ${actualLength} does not match declared length ${expectedLength}.`
		);
	}
}

function writeHeader(
	output: Uint8Array,
	fingerprint: Uint8Array,
	transformedLength: number,
	expiresAtSeconds: bigint,
	coverage: EnvelopeCoverage
): void {
	assertExpiresAtSeconds(expiresAtSeconds);
	output.set(MAGIC, 0);
	output[4] = FISE_WIRE_VERSION.major;
	output[5] = FISE_WIRE_VERSION.minor;
	output[6] = HEADER_LENGTH;
	output[7] = coverage.mode === "edges" ? EDGE_COVERAGE_FLAG : 0;
	output.set(fingerprint, 8);
	const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
	view.setUint32(24, transformedLength, false);
	view.setUint32(28, coverage.edgeBytes, false);
	view.setBigUint64(32, expiresAtSeconds, false);
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
	if (envelope[6] !== HEADER_LENGTH || (envelope[7] & ~EDGE_COVERAGE_FLAG) !== 0) {
		throw new FiseError("INVALID_ENVELOPE", "FISE: invalid header length or flags.");
	}
	const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
	const transformedLength = view.getUint32(24, false);
	const edgeBytes = view.getUint32(28, false);
	const coverage = parseCoverage(envelope[7], edgeBytes, transformedLength);
	return Object.freeze({
		fingerprint: copyBytes(envelope.subarray(8, 24)),
		transformedLength,
		expiresAtSeconds: view.getBigUint64(32, false),
		coverage
	});
}

function parseCoverage(
	flags: number,
	edgeBytes: number,
	transformedLength: number
): EnvelopeCoverage {
	if ((flags & EDGE_COVERAGE_FLAG) === 0) {
		if (edgeBytes !== 0) {
			throw new FiseError(
				"INVALID_ENVELOPE",
				"FISE: full-coverage envelopes must not advertise edge bytes."
			);
		}
		return FULL_ENVELOPE_COVERAGE;
	}
	const contentLength = transformedLength - FISE_VALUE_METADATA_LENGTH;
	if (edgeBytes < 1 || contentLength < 1 || edgeBytes * 2 >= contentLength) {
		throw new FiseError(
			"INVALID_ENVELOPE",
			"FISE: binary edge coverage is invalid or non-canonical."
		);
	}
	return Object.freeze({ mode: "edges", edgeBytes });
}

function runCoveredKernel(
	operation: "forward" | "reverse",
	input: Uint8Array,
	owned: OwnedProfileOperation,
	coverage: EnvelopeCoverage
): Uint8Array {
	return runCoveredRange(operation, input, 0, input.length, owned, coverage);
}

function restoreCoveredRange(
	input: Uint8Array,
	absoluteOffset: number,
	transformedLength: number,
	owned: OwnedProfileOperation,
	coverage: EnvelopeCoverage
): Uint8Array {
	return runCoveredRange(
		"reverse",
		input,
		absoluteOffset,
		transformedLength,
		owned,
		coverage
	);
}

function runCoveredRange(
	operation: "forward" | "reverse",
	input: Uint8Array,
	absoluteOffset: number,
	transformedLength: number,
	owned: OwnedProfileOperation,
	coverage: EnvelopeCoverage
): Uint8Array {
	const output = copyBytes(input);
	for (const segment of coveredIntersections(
		absoluteOffset,
		absoluteOffset + input.length,
		transformedLength,
		coverage
	)) {
		const relativeStart = segment.start - absoluteOffset;
		const relativeEnd = segment.endExclusive - absoluteOffset;
		const transformed = owned.run(
			operation,
			owned.runtime,
			input.subarray(relativeStart, relativeEnd),
			owned.contextSegment,
			owned.contextState,
			segment.start,
			owned.context
		);
		output.set(transformed, relativeStart);
	}
	return output;
}

async function runCoveredKernelAsync(
	operation: "forward" | "reverse",
	input: Uint8Array,
	owned: OwnedProfileOperation,
	coverage: EnvelopeCoverage,
	run: ProfileAsyncKernelRunner
): Promise<Uint8Array> {
	return runCoveredRangeAsync(operation, input, 0, input.length, owned, coverage, run);
}

async function restoreCoveredRangeAsync(
	input: Uint8Array,
	absoluteOffset: number,
	transformedLength: number,
	owned: OwnedProfileOperation,
	coverage: EnvelopeCoverage,
	run: ProfileAsyncKernelRunner
): Promise<Uint8Array> {
	return runCoveredRangeAsync(
		"reverse",
		input,
		absoluteOffset,
		transformedLength,
		owned,
		coverage,
		run
	);
}

async function runCoveredRangeAsync(
	operation: "forward" | "reverse",
	input: Uint8Array,
	absoluteOffset: number,
	transformedLength: number,
	owned: OwnedProfileOperation,
	coverage: EnvelopeCoverage,
	run: ProfileAsyncKernelRunner
): Promise<Uint8Array> {
	const output = copyBytes(input);
	const restored = await Promise.all(coveredIntersections(
		absoluteOffset,
		absoluteOffset + input.length,
		transformedLength,
		coverage
	).map(async segment => {
		const relativeStart = segment.start - absoluteOffset;
		const relativeEnd = segment.endExclusive - absoluteOffset;
		return Object.freeze({
			relativeStart,
			bytes: await runKernelAsync(
				operation,
				input.subarray(relativeStart, relativeEnd),
				segment.start,
				owned,
				run
			)
		});
	}));
	for (const segment of restored) output.set(segment.bytes, segment.relativeStart);
	return output;
}

function coveredIntersections(
	start: number,
	endExclusive: number,
	transformedLength: number,
	coverage: EnvelopeCoverage
): readonly Readonly<{ start: number; endExclusive: number }>[] {
	if (start === endExclusive) return [];
	if (coverage.mode === "full") return [Object.freeze({ start, endExclusive })];
	const prefixEnd = FISE_VALUE_METADATA_LENGTH + coverage.edgeBytes;
	const tailStart = transformedLength - coverage.edgeBytes;
	const segments: Readonly<{ start: number; endExclusive: number }>[] = [];
	const prefixStart = start;
	const selectedPrefixEnd = Math.min(endExclusive, prefixEnd);
	if (prefixStart < selectedPrefixEnd) {
		segments.push(Object.freeze({ start: prefixStart, endExclusive: selectedPrefixEnd }));
	}
	const selectedTailStart = Math.max(start, tailStart);
	if (selectedTailStart < endExclusive) {
		segments.push(Object.freeze({ start: selectedTailStart, endExclusive }));
	}
	return segments;
}

function assertCoveragePayload(payload: Uint8Array, coverage: EnvelopeCoverage): void {
	if (coverage.mode === "edges") {
		assertBinaryPayloadMetadata(payload.subarray(0, FISE_VALUE_METADATA_LENGTH));
	}
}

function layoutOf(
	transformedLength: number,
	owned: OwnedProfileOperation
): Readonly<{
	transformedLength: number;
	operationBindingLength: number;
	contextSegmentLength: number;
}> {
	return Object.freeze({
		transformedLength,
		operationBindingLength: owned.operationBindingLength,
		contextSegmentLength: owned.contextSegment.length
	});
}

async function runReverseAsync(
	transformed: Uint8Array,
	absoluteOffset: number,
	owned: OwnedProfileOperation,
	run: ProfileAsyncKernelRunner
): Promise<Uint8Array> {
	return runKernelAsync("reverse", transformed, absoluteOffset, owned, run);
}

async function runKernelAsync(
	operation: "forward" | "reverse",
	input: Uint8Array,
	absoluteOffset: number,
	owned: OwnedProfileOperation,
	run: ProfileAsyncKernelRunner
): Promise<Uint8Array> {
	return ownAsyncKernelOutput(
		await run(
			operation,
			owned.runtime,
			copyBytes(input),
			copyBytes(owned.contextSegment),
			owned.contextState,
			absoluteOffset,
			owned.context
		),
		input.length,
		operation
	);
}

function ownAsyncKernelOutput(
	output: Uint8Array,
	expectedLength: number,
	operation: "forward" | "reverse"
): Uint8Array {
	assertBytes(output, `${operation} kernel output`, "INVALID_PROFILE");
	if (output.length !== expectedLength) {
		throw new FiseError(
			"INVALID_PROFILE",
			`FISE: async ${operation} kernel changed byte length.`
		);
	}
	return snapshotBytes(output, `${operation} kernel output`, "INVALID_PROFILE");
}

function checkedEnvelopeInputLength(envelope: unknown): number {
	const length = checkedByteLength(envelope, "envelope", "INVALID_ENVELOPE");
	if (length > FISE_MAX_ENVELOPE_LENGTH) {
		throw new FiseError("ENVELOPE_LIMIT", "FISE: envelope exceeds the runtime limit.");
	}
	return length;
}

function assertPayloadLength(length: number): void {
	if (!Number.isSafeInteger(length) || length < 0 || length > MAX_UINT32) {
		throw new FiseError("ENVELOPE_LIMIT", "FISE: payload length must fit uint32.");
	}
}

function checkedEnvelopeLength(transformedLength: number): number {
	assertPayloadLength(transformedLength);
	const length = HEADER_LENGTH + transformedLength + MARKER_LENGTH;
	if (!Number.isSafeInteger(length) || length > FISE_MAX_ENVELOPE_LENGTH) {
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

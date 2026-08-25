import { FISE_WIRE_VERSION, MAX_PROFILE_ID_LENGTH } from "./constants.js";
import { validateProfileId } from "./profileValidation.js";
import { FiseError } from "../errors.js";
import { isUint8ArrayValue } from "./valueValidation.js";

const MAGIC = "FISE";
const MAGIC_BYTES = Uint8Array.from([0x46, 0x49, 0x53, 0x45]);
const TEXT_FIXED_HEADER_LENGTH = 22;
const BINARY_FIXED_HEADER_LENGTH = 13;
const MAX_TRANSFORMED_LENGTH = 0xffff_ffff;

export interface ParsedEnvelopeHeader {
	headerLength: number;
	profileId: string;
	saltLength: number;
	transformedLength: number;
}

export function encodeStringEnvelopeHeader(
	profileId: string,
	saltLength: number,
	transformedLength: number
): string {
	validateHeaderValues(profileId, saltLength, transformedLength);
	return (
		MAGIC +
		toHex(FISE_WIRE_VERSION.major, 2) +
		toHex(FISE_WIRE_VERSION.minor, 2) +
		toHex(profileId.length, 2) +
		toHex(saltLength, 4) +
		toHex(transformedLength, 8) +
		profileId
	);
}

export function parseStringEnvelopeHeader(envelope: string): ParsedEnvelopeHeader {
	if (typeof envelope !== "string" || envelope.length < TEXT_FIXED_HEADER_LENGTH) {
		throw invalidEnvelope("string envelope is shorter than the FISE 1.1 header");
	}
	if (envelope.slice(0, MAGIC.length) !== MAGIC) {
		throw invalidEnvelope("missing FISE 1.1 magic header; legacy envelopes are not supported");
	}

	const major = parseHex(envelope, 4, 6, "major version");
	const minor = parseHex(envelope, 6, 8, "minor version");
	assertSupportedVersion(major, minor);

	const profileLength = parseHex(envelope, 8, 10, "profile length");
	if (profileLength < 1 || profileLength > MAX_PROFILE_ID_LENGTH) {
		throw invalidEnvelope("profile length is outside the FISE 1.1 limit");
	}
	const headerLength = TEXT_FIXED_HEADER_LENGTH + profileLength;
	if (headerLength > envelope.length) {
		throw invalidEnvelope("profile identifier is truncated");
	}

	const saltLength = parseHex(envelope, 10, 14, "salt length");
	const transformedLength = parseHex(envelope, 14, 22, "transformed length");
	const profileId = envelope.slice(TEXT_FIXED_HEADER_LENGTH, headerLength);
	validateEnvelopeProfile(profileId);

	return { headerLength, profileId, saltLength, transformedLength };
}

export function encodeBinaryEnvelopeHeader(
	profileId: string,
	saltLength: number,
	transformedLength: number
): Uint8Array {
	validateHeaderValues(profileId, saltLength, transformedLength);
	const header = new Uint8Array(BINARY_FIXED_HEADER_LENGTH + profileId.length);
	header.set(MAGIC_BYTES, 0);
	header[4] = FISE_WIRE_VERSION.major;
	header[5] = FISE_WIRE_VERSION.minor;
	header[6] = profileId.length;
	const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
	view.setUint16(7, saltLength, false);
	view.setUint32(9, transformedLength, false);
	for (let index = 0; index < profileId.length; index++) {
		header[BINARY_FIXED_HEADER_LENGTH + index] = profileId.charCodeAt(index);
	}
	return header;
}

export function parseBinaryEnvelopeHeader(envelope: Uint8Array): ParsedEnvelopeHeader {
	if (!isUint8ArrayValue(envelope) || envelope.length < BINARY_FIXED_HEADER_LENGTH) {
		throw invalidEnvelope("binary envelope is shorter than the FISE 1.1 header");
	}
	for (let index = 0; index < MAGIC_BYTES.length; index++) {
		if (envelope[index] !== MAGIC_BYTES[index]) {
			throw invalidEnvelope("missing FISE 1.1 magic header; legacy envelopes are not supported");
		}
	}

	assertSupportedVersion(envelope[4], envelope[5]);
	const profileLength = envelope[6];
	if (profileLength < 1 || profileLength > MAX_PROFILE_ID_LENGTH) {
		throw invalidEnvelope("profile length is outside the FISE 1.1 limit");
	}
	const headerLength = BINARY_FIXED_HEADER_LENGTH + profileLength;
	if (headerLength > envelope.length) {
		throw invalidEnvelope("profile identifier is truncated");
	}

	const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
	const saltLength = view.getUint16(7, false);
	const transformedLength = view.getUint32(9, false);
	let profileId = "";
	for (let index = 0; index < profileLength; index++) {
		profileId += String.fromCharCode(envelope[BINARY_FIXED_HEADER_LENGTH + index]);
	}
	validateEnvelopeProfile(profileId);

	return { headerLength, profileId, saltLength, transformedLength };
}

export function assertEnvelopeProfile(actual: string, expected: string): void {
	if (actual !== expected) {
		throw new FiseError(
			"PROFILE_MISMATCH",
			`FISE: envelope profile '${actual}' does not match expected profile '${expected}'.`
		);
	}
}

export function assertEnvelopeLength(actual: number, expected: number): void {
	if (actual !== expected) {
		throw new FiseError(
			"LENGTH_MISMATCH",
			`FISE: envelope length ${actual} does not match declared length ${expected}.`
		);
	}
}

export function assertEnvelopeLimit(actual: number, maximum: number | undefined): void {
	if (maximum === undefined) return;
	if (actual > maximum) {
		throw new FiseError(
			"ENVELOPE_LIMIT",
			`FISE: envelope length ${actual} exceeds configured maximum ${maximum}.`
		);
	}
}

function validateHeaderValues(
	profileId: string,
	saltLength: number,
	transformedLength: number
): void {
	validateProfileId(profileId);
	if (!Number.isInteger(saltLength) || saltLength < 1 || saltLength > 0xffff) {
		throw new FiseError("INVALID_SALT", "FISE: salt length must fit an unsigned 16-bit field.");
	}
	if (
		!Number.isInteger(transformedLength) ||
		transformedLength < 0 ||
		transformedLength > MAX_TRANSFORMED_LENGTH
	) {
		throw new FiseError(
			"LENGTH_MISMATCH",
			"FISE: transformed data length must fit an unsigned 32-bit field."
		);
	}
}

function validateEnvelopeProfile(profileId: string): void {
	try {
		validateProfileId(profileId);
	} catch (error) {
		throw invalidEnvelope("profile identifier is malformed", error);
	}
}

function assertSupportedVersion(major: number, minor: number): void {
	if (major !== FISE_WIRE_VERSION.major || minor !== FISE_WIRE_VERSION.minor) {
		throw new FiseError(
			"UNSUPPORTED_VERSION",
			`FISE: unsupported envelope version ${major}.${minor}; expected ${FISE_WIRE_VERSION.major}.${FISE_WIRE_VERSION.minor}.`
		);
	}
}

function parseHex(envelope: string, start: number, end: number, label: string): number {
	const encoded = envelope.slice(start, end);
	if (encoded.length !== end - start || !/^[0-9a-f]+$/i.test(encoded)) {
		throw invalidEnvelope(`${label} is not fixed-width hexadecimal`);
	}
	return Number.parseInt(encoded, 16);
}

function toHex(value: number, width: number): string {
	return value.toString(16).padStart(width, "0");
}

function invalidEnvelope(message: string, cause?: unknown): FiseError {
	return new FiseError("INVALID_ENVELOPE", `FISE: ${message}.`, cause);
}

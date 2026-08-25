import { randomIntegerInclusive, randomSalt } from "./core/utils.js";
import {
	NormalizedStringProfile,
	normalizeStringProfile
} from "./core/profileValidation.js";
import {
	assertEnvelopeLength,
	assertEnvelopeLimit,
	assertEnvelopeProfile,
	encodeStringEnvelopeHeader,
	parseStringEnvelopeHeader
} from "./core/envelopeV11.js";
import {
	DecryptOptions,
	EncryptOptions,
	FiseLayoutInput,
	FiseStringProfile
} from "./types.js";
import { normalizeOffset } from "./core/normalizeOffset.js";
import { FiseError } from "./errors.js";
import { assertStringValue } from "./core/valueValidation.js";

/**
 * Creates a versioned FISE 1.1 string envelope with one atomic profile.
 *
 * @remarks The built-in profile creates a reversible representation. It does
 * not provide cryptographic confidentiality, authenticity, or integrity.
 */
export function fiseEncrypt(
	plaintext: string,
	profile: FiseStringProfile,
	options: EncryptOptions = {}
): string {
	assertStringValue(plaintext, "plaintext", "INVALID_INPUT");
	const normalized = normalizeStringProfile(profile, options);
	const saltLength = randomIntegerInclusive(
		normalized.saltRange.min,
		normalized.saltRange.max
	);
	return assembleStringEnvelope(plaintext, randomSalt(saltLength), normalized);
}

/** @internal Used only by the deterministic conformance entry point. */
export function fiseEncryptWithSalt(
	plaintext: string,
	salt: string,
	profile: FiseStringProfile,
	options: EncryptOptions = {}
): string {
	assertStringValue(plaintext, "plaintext", "INVALID_INPUT");
	assertStringValue(salt, "salt", "INVALID_SALT");
	return assembleStringEnvelope(
		plaintext,
		salt,
		normalizeStringProfile(profile, options)
	);
}

/**
 * Validates and reverses only the versioned FISE 1.1 string format.
 *
 * @remarks The operational name does not imply that the envelope was
 * cryptographically confidential or authenticated.
 */
export function fiseDecrypt(
	envelope: string,
	profile: FiseStringProfile,
	options: DecryptOptions = {}
): string {
	assertStringValue(envelope, "envelope", "INVALID_ENVELOPE");
	const normalized = normalizeStringProfile(profile, options);
	assertEnvelopeLimit(envelope.length, normalized.maxEnvelopeLength);
	const header = parseStringEnvelopeHeader(envelope);
	assertEnvelopeProfile(header.profileId, normalized.id);
	assertSaltLengthAllowed(header.saltLength, normalized, "INVALID_ENVELOPE");

	const expectedLength =
		header.headerLength +
		header.transformedLength +
		normalized.markerSize +
		header.saltLength;
	assertEnvelopeLength(envelope.length, expectedLength);

	const layoutInput: FiseLayoutInput = {
		transformedLength: header.transformedLength,
		saltLength: header.saltLength
	};
	const markerPosition = createStringOffset(normalized, layoutInput);
	const bodyStart = header.headerLength;
	const markerStart = bodyStart + markerPosition;
	const markerEnd = markerStart + normalized.markerSize;
	const actualMarker = envelope.slice(markerStart, markerEnd);
	const expectedMarker = createStringMarker(normalized, layoutInput);
	if (actualMarker !== expectedMarker) throw markerMismatch();

	const saltStart =
		header.headerLength + header.transformedLength + normalized.markerSize;
	const salt = envelope.slice(saltStart);
	const transformed =
		envelope.slice(bodyStart, markerStart) + envelope.slice(markerEnd, saltStart);
	const plaintext = runStringTransform(
		"decrypt",
		normalized,
		transformed,
		salt
	);
	assertStringValue(plaintext, "string transform output", "INVALID_CIPHERTEXT");
	return plaintext;
}

function assembleStringEnvelope(
	plaintext: string,
	salt: string,
	normalized: NormalizedStringProfile
): string {
	assertSaltLengthAllowed(salt.length, normalized, "INVALID_SALT");
	const transformed = runStringTransform(
		"encrypt",
		normalized,
		plaintext,
		salt
	);
	assertStringValue(transformed, "string transform output", "INVALID_CIPHERTEXT");
	const layoutInput: FiseLayoutInput = {
		transformedLength: transformed.length,
		saltLength: salt.length
	};
	const marker = createStringMarker(normalized, layoutInput);
	const offset = createStringOffset(normalized, layoutInput);
	const header = encodeStringEnvelopeHeader(
		normalized.id,
		salt.length,
		transformed.length
	);
	assertEnvelopeLimit(
		header.length + transformed.length + marker.length + salt.length,
		normalized.maxEnvelopeLength
	);
	return (
		header +
		transformed.slice(0, offset) +
		marker +
		transformed.slice(offset) +
		salt
	);
}

function createStringMarker(
	normalized: NormalizedStringProfile,
	input: FiseLayoutInput
): string {
	let marker: string;
	try {
		marker = normalized.profile.layout.createMarker(input, normalized.context);
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError(
			"INVALID_PROFILE",
			"FISE: string profile marker generation failed.",
			error
		);
	}
	if (typeof marker !== "string" || marker.length !== normalized.markerSize) {
		throw new FiseError(
			"INVALID_PROFILE",
			"FISE: string profile marker does not match markerSize."
		);
	}
	return marker;
}

function createStringOffset(
	normalized: NormalizedStringProfile,
	input: FiseLayoutInput
): number {
	let offset: number;
	try {
		offset = normalized.profile.layout.offset(input, normalized.context);
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError(
			"INVALID_PROFILE",
			"FISE: string profile offset calculation failed.",
			error
		);
	}
	return normalizeOffset(offset, input.transformedLength);
}

function runStringTransform(
	operation: "encrypt" | "decrypt",
	normalized: NormalizedStringProfile,
	input: string,
	salt: string
): string {
	try {
		return normalized.profile.transform[operation](input, salt);
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError(
			"INVALID_CIPHERTEXT",
			`FISE: string transform ${operation} operation failed.`,
			error
		);
	}
}

function assertSaltLengthAllowed(
	saltLength: number,
	profile: NormalizedStringProfile,
	code: "INVALID_SALT" | "INVALID_ENVELOPE"
): void {
	if (saltLength < profile.saltRange.min || saltLength > profile.saltRange.max) {
		throw new FiseError(
			code,
			`FISE: salt length ${saltLength} is outside profile range ${profile.saltRange.min}-${profile.saltRange.max}.`
		);
	}
}

function markerMismatch(): FiseError {
	return new FiseError(
		"MARKER_MISMATCH",
		"FISE: profile marker does not match the versioned envelope header and context."
	);
}

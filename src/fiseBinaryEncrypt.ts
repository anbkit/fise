import { randomIntegerInclusive, randomSaltBinary } from "./core/utils.js";
import {
	NormalizedBinaryProfile,
	normalizeBinaryProfile
} from "./core/profileValidation.js";
import {
	assertEnvelopeLength,
	assertEnvelopeLimit,
	assertEnvelopeProfile,
	encodeBinaryEnvelopeHeader,
	parseBinaryEnvelopeHeader
} from "./core/envelopeV11.js";
import {
	DecryptOptions,
	EncryptOptions,
	FiseBinaryProfile,
	FiseLayoutInput
} from "./types.js";
import { normalizeOffset } from "./core/normalizeOffset.js";
import { FiseError } from "./errors.js";
import { assertUint8ArrayValue } from "./core/valueValidation.js";

/**
 * Creates a versioned FISE 1.1 binary envelope with one atomic profile.
 *
 * @remarks The built-in profile creates a reversible representation. It does
 * not provide cryptographic confidentiality, authenticity, or integrity.
 */
export function fiseBinaryEncrypt(
	input: Uint8Array,
	profile: FiseBinaryProfile,
	options: EncryptOptions = {}
): Uint8Array {
	return fiseBinaryEncryptNormalized(
		input,
		normalizeBinaryProfile(profile, options)
	);
}

/** @internal Encrypts with one already-owned runtime profile snapshot. */
export function fiseBinaryEncryptNormalized(
	input: Uint8Array,
	normalized: NormalizedBinaryProfile
): Uint8Array {
	assertUint8ArrayValue(input, "binary input", "INVALID_INPUT");
	const saltLength = randomIntegerInclusive(
		normalized.saltRange.min,
		normalized.saltRange.max
	);
	return assembleBinaryEnvelope(
		input,
		randomSaltBinary(saltLength),
		normalized
	);
}

/** @internal Used only by the deterministic conformance entry point. */
export function fiseBinaryEncryptWithSalt(
	input: Uint8Array,
	salt: Uint8Array,
	profile: FiseBinaryProfile,
	options: EncryptOptions = {}
): Uint8Array {
	assertUint8ArrayValue(input, "binary input", "INVALID_INPUT");
	assertUint8ArrayValue(salt, "binary salt", "INVALID_SALT");
	return assembleBinaryEnvelope(
		input,
		salt,
		normalizeBinaryProfile(profile, options)
	);
}

/**
 * Validates and reverses only the versioned FISE 1.1 binary format.
 *
 * @remarks The operational name does not imply that the envelope was
 * cryptographically confidential or authenticated.
 */
export function fiseBinaryDecrypt(
	envelope: Uint8Array,
	profile: FiseBinaryProfile,
	options: DecryptOptions = {}
): Uint8Array {
	return fiseBinaryDecryptNormalized(
		envelope,
		normalizeBinaryProfile(profile, options)
	);
}

/** @internal Decrypts with one already-owned runtime profile snapshot. */
export function fiseBinaryDecryptNormalized(
	envelope: Uint8Array,
	normalized: NormalizedBinaryProfile
): Uint8Array {
	assertUint8ArrayValue(envelope, "binary envelope", "INVALID_ENVELOPE");
	assertEnvelopeLimit(envelope.length, normalized.maxEnvelopeLength);
	const header = parseBinaryEnvelopeHeader(envelope);
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
	const markerPosition = createBinaryOffset(normalized, layoutInput);
	const bodyStart = header.headerLength;
	const markerStart = bodyStart + markerPosition;
	const markerEnd = markerStart + normalized.markerSize;
	const actualMarker = envelope.subarray(markerStart, markerEnd);
	const expectedMarker = createBinaryMarker(normalized, layoutInput);
	if (!bytesEqual(actualMarker, expectedMarker)) throw markerMismatch();

	const saltStart =
		header.headerLength + header.transformedLength + normalized.markerSize;
	const salt = envelope.subarray(saltStart);
	const transformed = new Uint8Array(header.transformedLength);
	transformed.set(envelope.subarray(bodyStart, markerStart), 0);
	transformed.set(envelope.subarray(markerEnd, saltStart), markerPosition);
	const plaintext = runBinaryTransform(
		"decrypt",
		normalized,
		transformed,
		salt
	);
	assertUint8ArrayValue(plaintext, "binary transform output", "INVALID_CIPHERTEXT");
	return plaintext;
}

function assembleBinaryEnvelope(
	input: Uint8Array,
	salt: Uint8Array,
	normalized: NormalizedBinaryProfile
): Uint8Array {
	assertSaltLengthAllowed(salt.length, normalized, "INVALID_SALT");
	const transformed = runBinaryTransform(
		"encrypt",
		normalized,
		input,
		salt
	);
	assertUint8ArrayValue(transformed, "binary transform output", "INVALID_CIPHERTEXT");
	const layoutInput: FiseLayoutInput = {
		transformedLength: transformed.length,
		saltLength: salt.length
	};
	const marker = createBinaryMarker(normalized, layoutInput);
	const offset = createBinaryOffset(normalized, layoutInput);
	const header = encodeBinaryEnvelopeHeader(
		normalized.id,
		salt.length,
		transformed.length
	);
	const envelopeLength =
		header.length + transformed.length + marker.length + salt.length;
	assertEnvelopeLimit(envelopeLength, normalized.maxEnvelopeLength);
	let envelope: Uint8Array;
	try {
		envelope = new Uint8Array(envelopeLength);
	} catch (error) {
		throw new FiseError(
			"ENVELOPE_LIMIT",
			`FISE: unable to allocate a binary envelope of length ${envelopeLength}.`,
			error
		);
	}
	let position = 0;
	envelope.set(header, position);
	position += header.length;
	envelope.set(transformed.subarray(0, offset), position);
	position += offset;
	envelope.set(marker, position);
	position += marker.length;
	envelope.set(transformed.subarray(offset), position);
	position += transformed.length - offset;
	envelope.set(salt, position);
	return envelope;
}

function createBinaryMarker(
	normalized: NormalizedBinaryProfile,
	input: FiseLayoutInput
): Uint8Array {
	let marker: Uint8Array;
	try {
		marker = normalized.profile.layout.createMarker(input, normalized.context);
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError(
			"INVALID_PROFILE",
			"FISE: binary profile marker generation failed.",
			error
		);
	}
	assertUint8ArrayValue(marker, "binary profile marker", "INVALID_PROFILE");
	if (marker.length !== normalized.markerSize) {
		throw new FiseError(
			"INVALID_PROFILE",
			"FISE: binary profile marker does not match markerSize."
		);
	}
	return marker;
}

function createBinaryOffset(
	normalized: NormalizedBinaryProfile,
	input: FiseLayoutInput
): number {
	let offset: number;
	try {
		offset = normalized.profile.layout.offset(input, normalized.context);
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError(
			"INVALID_PROFILE",
			"FISE: binary profile offset calculation failed.",
			error
		);
	}
	return normalizeOffset(offset, input.transformedLength);
}

function runBinaryTransform(
	operation: "encrypt" | "decrypt",
	normalized: NormalizedBinaryProfile,
	input: Uint8Array,
	salt: Uint8Array
): Uint8Array {
	try {
		return normalized.profile.transform[operation](input, salt);
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError(
			"INVALID_CIPHERTEXT",
			`FISE: binary transform ${operation} operation failed.`,
			error
		);
	}
}

function assertSaltLengthAllowed(
	saltLength: number,
	profile: NormalizedBinaryProfile,
	code: "INVALID_SALT" | "INVALID_ENVELOPE"
): void {
	if (saltLength < profile.saltRange.min || saltLength > profile.saltRange.max) {
		throw new FiseError(
			code,
			`FISE: salt length ${saltLength} is outside profile range ${profile.saltRange.min}-${profile.saltRange.max}.`
		);
	}
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

function markerMismatch(): FiseError {
	return new FiseError(
		"MARKER_MISMATCH",
		"FISE: profile marker does not match the versioned envelope header and context."
	);
}

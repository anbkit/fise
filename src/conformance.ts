import { fiseBinaryEncryptWithSalt } from "./fiseBinaryEncrypt.js";
import { fiseEncryptWithSalt } from "./fiseEncrypt.js";
import {
	FiseFramedBinaryConformanceOptions,
	fiseFramedBinaryEncryptWithSalts
} from "./framedBinary.js";
import {
	EncryptOptions,
	FiseBinaryProfile,
	FiseStringProfile
} from "./types.js";

/**
 * Creates a deterministic string envelope for fixtures and cross-runtime
 * conformance vectors. A fixed salt is a test input, not a security control.
 */
export function createStringConformanceEnvelope(
	plaintext: string,
	salt: string,
	profile: FiseStringProfile,
	options: EncryptOptions = {}
): string {
	return fiseEncryptWithSalt(plaintext, salt, profile, options);
}

/** Deterministic binary equivalent of createStringConformanceEnvelope. */
export function createBinaryConformanceEnvelope(
	input: Uint8Array,
	salt: Uint8Array,
	profile: FiseBinaryProfile,
	options: EncryptOptions = {}
): Uint8Array {
	return fiseBinaryEncryptWithSalt(input, salt, profile, options);
}

/**
 * Deterministic indexed-container equivalent. Provide one fixed salt for each
 * frame; fixed salts remain fixture inputs and are not production controls.
 */
export function createFramedBinaryConformanceEnvelope(
	input: Uint8Array,
	salts: readonly Uint8Array[],
	profile: FiseBinaryProfile,
	options: FiseFramedBinaryConformanceOptions
): Uint8Array {
	return fiseFramedBinaryEncryptWithSalts(input, salts, profile, options);
}

export type { FiseFramedBinaryConformanceOptions } from "./framedBinary.js";

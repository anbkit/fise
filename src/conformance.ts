import { fiseBinaryEncryptWithSalt } from "./fiseBinaryEncrypt.js";
import { fiseEncryptWithSalt } from "./fiseEncrypt.js";
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

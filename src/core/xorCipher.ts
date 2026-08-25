import { FiseCipher } from "../types.js";
import { FiseError } from "../errors.js";
import { base64ToBytes, bytesToBase64 } from "./utils.js";
import { registerBuiltInStringCipher } from "./transformRegistry.js";

/**
 * XOR-based cipher implementation for FISE (string-based).
 *
 * This cipher XORs plaintext and salt UTF-16 code units, serializes each result
 * as two bytes, and base64-encodes those bytes. It is lossless for JavaScript
 * strings and designed for speed, not cryptographic confidentiality.
 *
 * Note: XOR is symmetric, so encrypt and decrypt use the same operation.
 */
export const xorCipher: FiseCipher = registerBuiltInStringCipher({
	id: "fise.xor.utf16.v1",
	encrypt(plaintext, salt) {
		if (plaintext.length > 0 && salt.length === 0) {
			throw new FiseError("INVALID_SALT", "FISE: string XOR salt must not be empty.");
		}
		const result = new Uint8Array(plaintext.length * 2);
		for (let i = 0; i < plaintext.length; i++) {
			const transformed = plaintext.charCodeAt(i) ^ salt.charCodeAt(i % salt.length);
			result[i * 2] = transformed >>> 8;
			result[i * 2 + 1] = transformed & 0xff;
		}
		return bytesToBase64(result);
	},

	decrypt(cipherText, salt) {
		const decoded = base64ToBytes(cipherText);
		if (decoded.length > 0 && salt.length === 0) {
			throw new FiseError("INVALID_SALT", "FISE: string XOR salt must not be empty.");
		}
		if (decoded.length % 2 !== 0) {
			throw new FiseError(
				"INVALID_CIPHERTEXT",
				"FISE: string XOR ciphertext must contain complete UTF-16 code units."
			);
		}
		const result = new Array(decoded.length / 2);
		for (let i = 0; i < result.length; i++) {
			const transformed = (decoded[i * 2] << 8) | decoded[i * 2 + 1];
			result[i] = String.fromCharCode(transformed ^ salt.charCodeAt(i % salt.length));
		}
		return result.join("");
	}
});

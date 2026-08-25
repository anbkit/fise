import { FiseBinaryCipher } from "../types.js";
import { FiseError } from "../errors.js";
import { registerBuiltInBinaryCipher } from "./transformRegistry.js";

/**
 * XOR-based cipher implementation for FISE (binary-optimized).
 *
 * This cipher performs XOR operation directly on binary data (Uint8Array).
 * No base64 conversion - works with pure binary throughout.
 *
 * Note: XOR is symmetric, so encrypt and decrypt use the same operation.
 */
export const xorBinaryCipher: FiseBinaryCipher = registerBuiltInBinaryCipher({
	id: "fise.xor.u8.v1",
	encrypt(plaintext: Uint8Array, salt: Uint8Array): Uint8Array {
		if (plaintext.length > 0 && salt.length === 0) {
			throw new FiseError("INVALID_SALT", "FISE: binary XOR salt must not be empty.");
		}
		const xorResult = new Uint8Array(plaintext.length);
		for (let i = 0; i < plaintext.length; i++) {
			xorResult[i] = plaintext[i] ^ salt[i % salt.length];
		}
		return xorResult;
	},

	decrypt(cipherText: Uint8Array, salt: Uint8Array): Uint8Array {
		if (cipherText.length > 0 && salt.length === 0) {
			throw new FiseError("INVALID_SALT", "FISE: binary XOR salt must not be empty.");
		}
		const decrypted = new Uint8Array(cipherText.length);
		for (let i = 0; i < cipherText.length; i++) {
			decrypted[i] = cipherText[i] ^ salt[i % salt.length];
		}
		return decrypted;
	}
});

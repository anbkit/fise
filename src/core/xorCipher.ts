import { FiseCipher } from "../types";
import { toBase64, fromBase64 } from "./utils.js";

/**
 * XOR-based cipher implementation for FISE (string-based).
 * 
 * This cipher performs XOR operation between plaintext and salt characters,
 * then base64-encodes the result. It's designed for speed, not cryptographic security.
 * 
 * Note: XOR is symmetric, so encrypt and decrypt use the same operation.
 */
export const xorCipher: FiseCipher = {
	encrypt(plaintext, salt) {
		const sLen = salt.length;
		const result = new Array(plaintext.length);
		for (let i = 0; i < plaintext.length; i++) {
			const c = plaintext.charCodeAt(i);
			const k = salt.charCodeAt(i % sLen);
			result[i] = String.fromCharCode(c ^ k);
		}
		return toBase64(result.join(""));
	},

	decrypt(cipherText, salt) {
		const decoded = fromBase64(cipherText);
		const sLen = salt.length;
		const result = new Array(decoded.length);
		for (let i = 0; i < decoded.length; i++) {
			const c = decoded.charCodeAt(i);
			const k = salt.charCodeAt(i % sLen);
			result[i] = String.fromCharCode(c ^ k);
		}
		return result.join("");
	}
};

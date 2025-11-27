import { randomSalt } from "./core/utils.js";
import { normalizeFiseRules } from "./core/normalizeFiseRules.js";
import { EncryptOptions, FiseCipher, FiseContext, FiseRules } from "./types.js";

/**
 * Encrypts plaintext using FISE transformation.
 * 
 * @param plaintext - The string to encrypt
 * @param cipher - The cipher implementation to use (e.g., xorCipher)
 * @param rules - The rules implementation that defines encoding/offset behavior.
 *                Only requires offset, encodeLength, and decodeLength (3 security points).
 *                Everything else is optional and will be automated.
 * @param options - Optional encryption options (timestamp)
 * @returns The encrypted envelope string
 */
export function encryptFise(
	plaintext: string,
	cipher: FiseCipher,
	rules: FiseRules,
	options: EncryptOptions = {}
): string {
	// Normalize rules to fill in optional methods with defaults
	const fullRules = normalizeFiseRules(rules);

	// Use salt range from rules (default: 10-99)
	const saltRange = rules.saltRange ?? { min: 10, max: 99 };
	const timestampMinutes = options.timestampMinutes;

	const range = saltRange.max - saltRange.min + 1;
	const saltLen =
		saltRange.min + Math.floor(Math.random() * Math.max(range, 1));

	const salt = randomSalt(saltLen);
	const ctx: FiseContext = { timestampMinutes, saltLength: saltLen };

	const cipherText = cipher.encrypt(plaintext, salt);
	const encodedLen = fullRules.encodeLength(saltLen, ctx);
	const offsetRaw = fullRules.offset(cipherText, ctx);

	const offset = Math.max(0, Math.min(offsetRaw, cipherText.length));

	const withLen =
		cipherText.slice(0, offset) + encodedLen + cipherText.slice(offset);

	return withLen + salt;
}

/**
 * Decrypts a FISE envelope back to plaintext.
 * 
 * @param envelope - The encrypted envelope string
 * @param cipher - The cipher implementation to use for decryption
 * @param rules - The rules implementation that matches the one used for encryption
 * @param options - Optional decryption options (timestampMinutes must match encryption)
 * @returns The decrypted plaintext string
 * @throws Error if the envelope cannot be decoded or if timestamp doesn't match
 */
export function decryptFise(
	envelope: string,
	cipher: FiseCipher,
	rules: FiseRules,
	options: { timestampMinutes?: number } = {}
): string {
	// Normalize rules to fill in optional methods with defaults
	const fullRules = normalizeFiseRules(rules);

	const ctx: FiseContext = { timestampMinutes: options.timestampMinutes };

	const { saltLength, encodedLength, withoutLen } = fullRules.preExtractLength(
		envelope,
		ctx
	);

	const salt = fullRules.extractSalt(envelope, saltLength, {
		...ctx,
		saltLength
	});

	// Optimize: Calculate offset directly (O(1)) instead of searching (O(n²))
	// Note: For defaultRules, offset only depends on length, not content
	const encodedSize = fullRules.encodedLengthSize;
	const ctxWithSalt = { ...ctx, saltLength };
	const cipherTextLen = withoutLen.length - encodedSize;
	const expectedOffset = fullRules.offset(
		"x".repeat(Math.max(1, cipherTextLen)),
		ctxWithSalt
	);
	const encodedPos = Math.max(0, Math.min(expectedOffset, cipherTextLen));

	if (
		encodedPos + encodedSize > withoutLen.length ||
		withoutLen.slice(encodedPos, encodedPos + encodedSize) !== encodedLength
	) {
		throw new Error(
			"FISE: cannot find encoded length at expected offset. " +
			"This may indicate a corrupted envelope, mismatched rules/timestamp, " +
			"or a rules implementation where offset depends on content (not just length)."
		);
	}

	const cipherText =
		withoutLen.slice(0, encodedPos) + withoutLen.slice(encodedPos + encodedSize);

	const decrypted = cipher.decrypt(cipherText, salt);

	return decrypted;
}

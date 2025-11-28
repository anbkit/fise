import { randomSalt } from "./core/utils.js";
import { normalizeFiseRules } from "./core/normalizeFiseRules.js";
import { DEFAULT_SALT_RANGE, DUMMY_CHAR } from "./core/constants.js";
import { EncryptOptions, DecryptOptions, FiseCipher, FiseContext, FiseRules } from "./types.js";

/**
 * Encrypts plaintext string using FISE transformation.
 *
 * For binary data encryption, use `encryptBinaryFise()` instead.
 *
 * @param plaintext - The string to encrypt
 * @param cipher - The cipher implementation to use (e.g., xorCipher)
 * @param rules - The rules implementation that defines encoding/offset behavior.
 *                Only requires offset, encodeLength, and decodeLength (3 security points).
 *                Everything else is optional and will be automated.
 * @param options - Optional encryption options (timestamp, metadata)
 * @returns The encrypted envelope string
 *
 */
export function encryptFise(
	plaintext: string,
	cipher: FiseCipher,
	rules: FiseRules<string>,
	options: EncryptOptions = {}
): string {
	// Normalize rules to fill in optional methods with defaults
	const fullRules = normalizeFiseRules(rules);

	// Use salt range from rules (default from constants)
	const saltRange = rules.saltRange ?? DEFAULT_SALT_RANGE;
	const timestamp = options.timestamp;

	const range = saltRange.max - saltRange.min + 1;
	const saltLen =
		saltRange.min + Math.floor(Math.random() * Math.max(range, 1));

	const salt = randomSalt(saltLen);
	const ctx: FiseContext = {
		timestamp,
		saltLength: saltLen,
		metadata: options.metadata
	};

	const cipherText = cipher.encrypt(plaintext, salt);
	const encodedLen = fullRules.encodeLength(saltLen, ctx);
	const offsetRaw = fullRules.offset(cipherText, ctx);

	const offset = Math.max(0, Math.min(offsetRaw, cipherText.length));

	const withLen =
		cipherText.slice(0, offset) + encodedLen + cipherText.slice(offset);

	return withLen + salt;
}

/**
 * Decrypts a FISE envelope string back to plaintext.
 *
 * For binary data decryption, use `decryptBinaryFise()` instead.
 *
 * @param envelope - The encrypted envelope string
 * @param cipher - The cipher implementation to use for decryption (e.g., xorCipher)
 * @param rules - The rules implementation that matches the one used for encryption
 * @param options - Optional decryption options (timestamp and metadata must match encryption)
 * @returns The decrypted plaintext string
 * @throws Error if the envelope cannot be decoded or if timestamp/metadata doesn't match
 *
 */
export function decryptFise(
	envelope: string,
	cipher: FiseCipher,
	rules: FiseRules<string>,
	options: DecryptOptions = {}
): string {
	// Normalize rules to fill in optional methods with defaults
	const fullRules = normalizeFiseRules(rules);

	const ctx: FiseContext = {
		timestamp: options.timestamp,
		metadata: options.metadata
	};

	const { saltLength, encodedLength, withoutLen } = fullRules.preExtractLength(
		envelope,
		ctx
	);

	// For string operations, encodedLength and withoutLen are always strings
	const encodedLengthStr = encodedLength as string;
	const withoutLenStr = withoutLen as string;

	const salt = fullRules.extractSalt(envelope, saltLength, {
		...ctx,
		saltLength
	});

	// Optimize: Calculate offset directly (O(1)) instead of searching (O(n²))
	// Note: For defaultRules, offset only depends on length, not content
	const encodedSize = fullRules.encodedLengthSize;
	const ctxWithSalt = { ...ctx, saltLength };
	const cipherTextLen = withoutLenStr.length - encodedSize;
	const expectedOffset = fullRules.offset(
		DUMMY_CHAR.repeat(Math.max(1, cipherTextLen)),
		ctxWithSalt
	);
	const encodedPos = Math.max(0, Math.min(expectedOffset, cipherTextLen));

	if (
		encodedPos + encodedSize > withoutLenStr.length ||
		withoutLenStr.slice(encodedPos, encodedPos + encodedSize) !== encodedLengthStr
	) {
		throw new Error(
			"FISE: cannot find encoded length at expected offset. " +
			"This may indicate a corrupted envelope, mismatched rules/timestamp, " +
			"or a rules implementation where offset depends on content (not just length)."
		);
	}

	const cipherText =
		withoutLenStr.slice(0, encodedPos) + withoutLenStr.slice(encodedPos + encodedSize);

	const decrypted = cipher.decrypt(cipherText, salt);

	return decrypted;
}

import { FiseContext } from "../types.js";

/**
 * Result of extracting length metadata from envelope
 */
export interface EnvelopeLengthInfo {
	saltLength: number;
	encodedLength: string | Uint8Array;
	withoutLen: string | Uint8Array;
}

/**
 * Generic length extraction for both string and binary envelopes.
 * Uses brute-force search across salt range to find valid length encoding.
 *
 * This algorithm is the same for both string and binary envelopes - only the
 * slice operations differ by type.
 *
 * @param envelope - Full envelope (with salt)
 * @param saltRange - Range of valid salt lengths to try
 * @param encodedLengthSize - Size of the encoded length marker
 * @param stripSalt - Function to remove salt from envelope
 * @param decodeLength - Function to decode length from encoding
 * @param offset - Function to calculate expected offset
 * @param ctxBase - Base context for decryption
 * @returns Length info including salt length, encoded length, and envelope without salt
 * @throws Error if no valid salt length can be found
 */
export function extractEnvelopeLength<T extends string | Uint8Array>(
	envelope: T,
	saltRange: { min: number; max: number },
	encodedLengthSize: number,
	stripSalt: (envelope: T, saltLen: number, ctx: FiseContext) => T,
	decodeLength: (encoded: string | Uint8Array, ctx: FiseContext) => number,
	offset: (cipherText: string | Uint8Array, ctx: FiseContext) => number,
	ctxBase: FiseContext
): EnvelopeLengthInfo {
	// Brute-force search across salt range
	for (let len = saltRange.min; len <= saltRange.max; len++) {
		const withoutSalt = stripSalt(envelope, len, ctxBase);

		// Check if envelope is large enough to contain encoded length
		if (withoutSalt.length < encodedLengthSize) continue;

		// Try all possible positions for the encoded length
		for (let i = 0; i <= withoutSalt.length - encodedLengthSize; i++) {
			const encoded = withoutSalt.slice(i, i + encodedLengthSize) as T;
			const decodedLen = decodeLength(encoded, ctxBase);

			// Validate decoded length
			if (Number.isNaN(decodedLen) || decodedLen !== len) continue;

			// Reconstruct candidate ciphertext without encoded length
			const candidate = reconstructWithoutLength(withoutSalt, i, encodedLengthSize);

			// Verify offset matches expected position
			const expectedOffset = offset(candidate, {
				...ctxBase,
				saltLength: len
			});

			if (expectedOffset !== i) continue;

			// Found valid encoding!
			return {
				saltLength: len,
				encodedLength: encoded,
				withoutLen: withoutSalt
			};
		}
	}

	throw new Error(
		"FISE: cannot infer salt length from envelope. " +
		"This may indicate a corrupted envelope or mismatched rules/timestamp."
	);
}

/**
 * Reconstruct data without the length encoding at specified position.
 * Handles both string and Uint8Array types.
 */
function reconstructWithoutLength<T extends string | Uint8Array>(
	data: T,
	position: number,
	encodedLengthSize: number
): string | Uint8Array {
	if (typeof data === 'string') {
		return data.slice(0, position) + data.slice(position + encodedLengthSize);
	}

	// Binary: create new Uint8Array with length encoding removed
	const result = new Uint8Array(data.length - encodedLengthSize);
	result.set(data.slice(0, position), 0);
	result.set(data.slice(position + encodedLengthSize), position);
	return result as T;
}

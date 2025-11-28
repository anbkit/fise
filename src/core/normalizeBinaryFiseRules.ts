import { FiseContext, FiseRules } from "../types.js";
import { extractEnvelopeLength, EnvelopeLengthInfo } from "./lengthExtractor.js";
import { DEFAULT_SALT_RANGE } from "./constants.js";

/**
 * Normalized FISE rules for binary operations.
 * All optional methods are filled with defaults optimized for Uint8Array.
 */
export interface NormalizedFiseRulesBinary {
	encodedLengthSize: number;
	offset(cipherText: Uint8Array, ctx: FiseContext): number;
	encodeLength(len: number, ctx: FiseContext): Uint8Array;
	decodeLength(encoded: Uint8Array, ctx: FiseContext): number;
	extractSalt(envelope: Uint8Array, saltLen: number, ctx: FiseContext): Uint8Array;
	stripSalt(envelope: Uint8Array, saltLen: number, ctx: FiseContext): Uint8Array;
	preExtractLength(envelope: Uint8Array, ctxBase: FiseContext): EnvelopeLengthInfo;
}

/**
 * Normalizes binary FiseRules by filling in optional methods with secure defaults.
 * Similar to normalizeFiseRules but works with Uint8Array.
 *
 * @param rules - Binary rules to normalize
 * @returns Normalized rules with all optional methods filled in
 */
export function normalizeFiseRulesBinary(
	rules: FiseRules<string | Uint8Array>
): NormalizedFiseRulesBinary {
	const saltRange = rules.saltRange ?? DEFAULT_SALT_RANGE;

	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	// Detect whether encodeLength returns text (string) or binary (Uint8Array)
	const testEncoded = rules.encodeLength(10, {});
	const isTextRule = typeof testEncoded === "string";

	const encodeLength = isTextRule
		? (len: number, ctx: FiseContext): Uint8Array =>
			encoder.encode((rules.encodeLength(len, ctx) as string))
		: (len: number, ctx: FiseContext): Uint8Array =>
			rules.encodeLength(len, ctx) as Uint8Array;

	const decodeLength = isTextRule
		? (encoded: Uint8Array, ctx: FiseContext): number => {
			try {
				return rules.decodeLength(decoder.decode(encoded) as any, ctx);
			} catch (err) {
				throw new Error("FISE: failed to decode length for binary rules; ensure text rules use UTF-8 encodings.");
			}
		}
		: (encoded: Uint8Array, ctx: FiseContext): number =>
			rules.decodeLength(encoded as any, ctx);

	const offset = (() => {
		if (!isTextRule) {
			return (cipherText: Uint8Array, ctx: FiseContext): number =>
				rules.offset(cipherText as any, ctx);
		}

		// Detect content-sensitive offset: if two different contents of same length yield different offsets, reject.
		const testLen = 8;
		const offA = rules.offset("a".repeat(testLen) as any, {});
		const offB = rules.offset("b".repeat(testLen) as any, {});
		if (offA !== offB) {
			throw new Error(
				"FISE: text-based offset depends on content; provide binary-aware rules or make offset length-only for binary encryption."
			);
		}

		return (_cipherText: Uint8Array, ctx: FiseContext): number => {
			// Map binary length to dummy text of same length (offset is length-based)
			const dummy = "x".repeat(Math.max(1, _cipherText.length));
			return rules.offset(dummy as any, ctx);
		};
	})();

	const encodedLengthSize = encodeLength(10, {}).length;

	const extractSalt = rules.extractSalt && !isTextRule
		? (envelope: Uint8Array, saltLen: number, ctx: FiseContext): Uint8Array =>
			(rules.extractSalt as any)(envelope, saltLen, ctx)
		: (envelope: Uint8Array, saltLen: number): Uint8Array =>
			envelope.slice(-saltLen);

	const stripSalt = rules.stripSalt && !isTextRule
		? (envelope: Uint8Array, saltLen: number, ctx: FiseContext): Uint8Array =>
			(rules.stripSalt as any)(envelope, saltLen, ctx)
		: (envelope: Uint8Array, saltLen: number): Uint8Array =>
			envelope.slice(0, envelope.length - saltLen);

	const preExtractLength = (envelope: Uint8Array, ctxBase: FiseContext): EnvelopeLengthInfo => {
		return extractEnvelopeLength(
			envelope,
			saltRange,
			encodedLengthSize,
			stripSalt,
			decodeLength as any,
			offset as any,
			ctxBase
		);
	};

	return {
		encodedLengthSize,
		offset,
		encodeLength,
		decodeLength,
		extractSalt,
		stripSalt,
		preExtractLength
	};
}

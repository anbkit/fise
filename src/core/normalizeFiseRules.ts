import { FiseContext, FiseRules } from "../types.js";
import { extractEnvelopeLength, EnvelopeLengthInfo } from "./lengthExtractor.js";
import { DEFAULT_SALT_RANGE } from "./constants.js";

/**
 * Internal normalized rules with all fields required for encryption/decryption.
 * This is the internal representation after filling in defaults.
 */
export interface NormalizedFiseRules {
    encodedLengthSize: number;
    offset(cipherText: string, ctx: FiseContext): number;
    encodeLength(len: number, ctx: FiseContext): string;
    decodeLength(encoded: string, ctx: FiseContext): number;
    extractSalt(envelope: string, saltLen: number, ctx: FiseContext): string;
    stripSalt(envelope: string, saltLen: number, ctx: FiseContext): string;
    preExtractLength(envelope: string, ctxBase: FiseContext): EnvelopeLengthInfo;
}

/**
 * Normalizes string-based FiseRules by filling in optional methods with secure defaults.
 * This allows users to only specify the 3 security points (offset, encodeLength, decodeLength)
 * and everything else is automated.
 *
 * @param rules - String-based rules to normalize
 * @returns Normalized rules with all optional methods filled in
 */
export function normalizeFiseRules(rules: FiseRules<string>): NormalizedFiseRules {
    const saltRange = rules.saltRange ?? DEFAULT_SALT_RANGE;

    // Infer encodedLengthSize from encodeLength output
    // Type system guarantees encodeLength returns string for FiseRules<string>
    const testEncoded = rules.encodeLength(10, {});
    const encodedLengthSize = testEncoded.length;

    // Default salt extraction: tail (unless custom extractSalt/stripSalt provided)
    // Type system guarantees string inputs/outputs
    const extractSalt = rules.extractSalt
        ? ((envelope: string, saltLen: number, ctx: FiseContext) => {
            return rules.extractSalt!(envelope, saltLen, ctx);
        })
        : ((envelope: string, saltLen: number, _ctx: FiseContext) => {
            return envelope.slice(-saltLen);
        });

    const stripSalt = rules.stripSalt
        ? ((envelope: string, saltLen: number, ctx: FiseContext) => {
            return rules.stripSalt!(envelope, saltLen, ctx);
        })
        : ((envelope: string, saltLen: number, _ctx: FiseContext) => {
            return envelope.slice(0, envelope.length - saltLen);
        });

    // Use generic length extractor - eliminates code duplication!
	const preExtractLength = (envelope: string, ctxBase: FiseContext) => {
		return extractEnvelopeLength(
			envelope,
			saltRange,
			encodedLengthSize,
			stripSalt,
			rules.decodeLength as any,
			rules.offset as any,
			ctxBase
		);
	};

    return {
        encodedLengthSize,
        offset: (cipherText: string, ctx: FiseContext) => {
            return rules.offset(cipherText, ctx);
        },
        encodeLength: (len: number, ctx: FiseContext) => {
            return rules.encodeLength(len, ctx);
        },
        decodeLength: (encoded: string, ctx: FiseContext) => {
            return rules.decodeLength(encoded, ctx);
        },
        extractSalt,
        stripSalt,
        preExtractLength
    };
}

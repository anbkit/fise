import { FiseContext, FiseRules } from "../types.js";

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
    preExtractLength(
        envelope: string,
        ctxBase: FiseContext
    ): {
        saltLength: number;
        encodedLength: string;
        withoutLen: string;
    };
}

/**
 * Normalizes FiseRules by filling in optional methods with secure defaults.
 * This allows users to only specify the 3 security points (offset, encodeLength, decodeLength)
 * and everything else is automated.
 */
export function normalizeFiseRules(rules: FiseRules): NormalizedFiseRules {
    const saltRange = rules.saltRange ?? { min: 10, max: 99 };

    // Infer encodedLengthSize from encodeLength output
    const testEncoded = rules.encodeLength(10, {});
    const encodedLengthSize = testEncoded.length;

    // Default salt extraction: tail (unless custom extractSalt/stripSalt provided)
    // If user provides extractSalt/stripSalt, use them; otherwise default to tail
    const extractSalt = rules.extractSalt ?? ((envelope: string, saltLen: number, _ctx: FiseContext) => {
        return envelope.slice(-saltLen);
    });

    const stripSalt = rules.stripSalt ?? ((envelope: string, saltLen: number, _ctx: FiseContext) => {
        return envelope.slice(0, envelope.length - saltLen);
    });

    // Always use automated pre-extraction: brute-force search
    const preExtractLength = (envelope: string, ctxBase: FiseContext) => {
        for (let len = saltRange.min; len <= saltRange.max; len++) {
            const withoutSalt = stripSalt(envelope, len, ctxBase);
            if (withoutSalt.length < encodedLengthSize) continue;

            for (let i = 0; i <= withoutSalt.length - encodedLengthSize; i++) {
                const encoded = withoutSalt.slice(i, i + encodedLengthSize);
                const decodedLen = rules.decodeLength(encoded, ctxBase);
                if (Number.isNaN(decodedLen) || decodedLen !== len) continue;

                const candidate = withoutSalt.slice(0, i) + withoutSalt.slice(i + encodedLengthSize);

                const expectedOffset = rules.offset(candidate, {
                    ...ctxBase,
                    saltLength: len
                });

                if (expectedOffset !== i) continue;

                return {
                    saltLength: len,
                    encodedLength: encoded,
                    withoutLen: withoutSalt
                };
            }
        }

        throw new Error("FISE: cannot infer salt length from envelope.");
    };

    return {
        encodedLengthSize,
        offset: rules.offset,
        encodeLength: rules.encodeLength,
        decodeLength: rules.decodeLength,
        extractSalt,
        stripSalt,
        preExtractLength
    };
}


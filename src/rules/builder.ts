import { FiseBuilderInstance } from "./builder.instance.js";

/**
 * FISE Builder - Static preset factory methods for creating common FISE rule configurations.
 * All methods return a FiseBuilderInstance that can be further customized or built.
 */
export class FiseBuilder {
    /**
     * Create a new FiseBuilderInstance for manual building
     * @example FiseBuilder.create().withOffset(...).build()
     */
    static create(): FiseBuilderInstance {
        return new FiseBuilderInstance();
    }

    /**
     * Create a builder with default configuration (similar to defaultRules)
     * Timestamp-based offset with base36 encoding.
     * @example FiseBuilder.defaults().build()
     */
    static defaults(): FiseBuilderInstance {
        return new FiseBuilderInstance()
            .withOffset((cipherText, ctx) => {
                const t = ctx.timestamp ?? 0;
                const len = cipherText.length || 1;
                return (len * 7 + (t % 11)) % len;
            })
            .withEncodeLength((len) => len.toString(36).padStart(2, "0"))
            .withDecodeLength((encoded) => parseInt(encoded, 36))
            .withSaltRange(10, 99);
    }

    /**
     * Create a builder with a simple timestamp-based configuration
     * @example FiseBuilder.simple(7, 11).build()
     */
    static simple(multiplier: number = 7, modulo: number = 11): FiseBuilderInstance {
        return new FiseBuilderInstance()
            .withOffset((cipherText, ctx) => {
                const t = ctx.timestamp ?? 0;
                const len = cipherText.length || 1;
                return (len * multiplier + (t % modulo)) % len;
            })
            .withEncodeLength((len) => len.toString(36).padStart(2, "0"))
            .withDecodeLength((encoded) => parseInt(encoded, 36))
            .withSaltRange(10, 99);
    }

    /**
     * Preset: Timestamp-based with different prime multipliers
     * Uses multiplier 13 and modulo 17 for different distribution
     * @example FiseBuilder.timestamp().build()
     */
    static timestamp(multiplier: number = 13, modulo: number = 17): FiseBuilderInstance {
        return new FiseBuilderInstance()
            .withOffset((cipherText, ctx) => {
                const t = ctx.timestamp ?? 0;
                const len = cipherText.length || 1;
                return (len * multiplier + (t % modulo)) % len;
            })
            .withEncodeLength((len) => len.toString(36).padStart(2, "0"))
            .withDecodeLength((encoded) => parseInt(encoded, 36))
            .withSaltRange(10, 99);
    }

    /**
     * Preset: Fixed offset at middle position
     * No timestamp dependency - simpler but less temporal diversity
     * @example FiseBuilder.fixed().build()
     */
    static fixed(): FiseBuilderInstance {
        return new FiseBuilderInstance()
            .withOffset((cipherText) => {
                const len = cipherText.length || 1;
                return Math.floor(len / 2);
            })
            .withEncodeLength((len) => len.toString(36).padStart(2, "0"))
            .withDecodeLength((encoded) => parseInt(encoded, 36))
            .withSaltRange(10, 99);
    }

    /**
     * Preset: Length-based modulo offset
     * Simple modulo-based offset without timestamp
     * @example FiseBuilder.lengthBased(7).build()
     */
    static lengthBased(modulo: number = 7): FiseBuilderInstance {
        return new FiseBuilderInstance()
            .withOffset((cipherText) => {
                const len = cipherText.length || 1;
                return len % modulo;
            })
            .withEncodeLength((len) => len.toString(36).padStart(2, "0"))
            .withDecodeLength((encoded) => parseInt(encoded, 36))
            .withSaltRange(10, 99);
    }

    /**
     * Preset: Prime-based offset with timestamp
     * Uses larger prime numbers for more complex distribution
     * @example FiseBuilder.prime().build()
     */
    static prime(multiplier: number = 17, modulo: number = 23): FiseBuilderInstance {
        return new FiseBuilderInstance()
            .withOffset((cipherText, ctx) => {
                const t = ctx.timestamp ?? 0;
                const len = cipherText.length || 1;
                return (len * multiplier + (t % modulo)) % len;
            })
            .withEncodeLength((len) => len.toString(36).padStart(2, "0"))
            .withDecodeLength((encoded) => parseInt(encoded, 36))
            .withSaltRange(10, 99);
    }

    /**
     * Preset: Multi-factor offset combining timestamp and length
     * More complex offset calculation with multiple factors
     * @example FiseBuilder.multiFactor().build()
     */
    static multiFactor(): FiseBuilderInstance {
        return new FiseBuilderInstance()
            .withOffset((cipherText, ctx) => {
                const t = ctx.timestamp ?? 0;
                const len = cipherText.length || 1;
                const saltLen = ctx.saltLength ?? 10;
                return (len * 7 + (t % 11) + (saltLen * 3)) % len;
            })
            .withEncodeLength((len) => len.toString(36).padStart(2, "0"))
            .withDecodeLength((encoded) => parseInt(encoded, 36))
            .withSaltRange(10, 99);
    }

    /**
     * Preset: Hex encoding variant
     * Uses hexadecimal encoding instead of base36
     * @example FiseBuilder.hex().build()
     */
    static hex(): FiseBuilderInstance {
        return new FiseBuilderInstance()
            .withOffset((cipherText, ctx) => {
                const t = ctx.timestamp ?? 0;
                const len = cipherText.length || 1;
                return (len * 7 + (t % 11)) % len;
            })
            .withEncodeLength((len) => len.toString(16).padStart(2, "0"))
            .withDecodeLength((encoded) => parseInt(encoded, 16))
            .withSaltRange(10, 99);
    }

    /**
     * Preset: Base62 encoding variant
     * Uses base62 encoding for more compact representation
     * @example FiseBuilder.base62().build()
     */
    static base62(): FiseBuilderInstance {
        const base62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
        return new FiseBuilderInstance()
            .withOffset((cipherText, ctx) => {
                const t = ctx.timestamp ?? 0;
                const len = cipherText.length || 1;
                return (len * 7 + (t % 11)) % len;
            })
            .withEncodeLength((len) => {
                let result = "";
                let n = len;
                do {
                    result = base62[n % 62] + result;
                    n = Math.floor(n / 62);
                } while (n > 0);
                return result.padStart(2, "0");
            })
            .withDecodeLength((encoded) => {
                let result = 0;
                for (let i = 0; i < encoded.length; i++) {
                    const idx = base62.indexOf(encoded[i]);
                    if (idx === -1) return NaN;
                    result = result * 62 + idx;
                }
                return result;
            })
            .withSaltRange(10, 99);
    }

    /**
     * Preset: XOR-based offset
     * Uses XOR operation for offset calculation
     * @example FiseBuilder.xor().build()
     */
    static xor(): FiseBuilderInstance {
        return new FiseBuilderInstance()
            .withOffset((cipherText, ctx) => {
                const t = ctx.timestamp ?? 0;
                const len = cipherText.length || 1;
                return (len ^ t) % len;
            })
            .withEncodeLength((len) => len.toString(36).padStart(2, "0"))
            .withDecodeLength((encoded) => parseInt(encoded, 36))
            .withSaltRange(10, 99);
    }

    /**
     * Preset: Base64 character set encoding
     * Uses base64 alphabet as custom encoding (not true base64, but uses base64 chars)
     * @example FiseBuilder.base64().build()
     */
    static base64(): FiseBuilderInstance {
        const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        const base = base64Chars.length;

        return new FiseBuilderInstance()
            .withOffset((cipherText, ctx) => {
                const t = ctx.timestamp ?? 0;
                const len = cipherText.length || 1;
                return (len * 7 + (t % 11)) % len;
            })
            .withEncodeLength((len) => {
                // Encode as base-N using base64 alphabet
                if (len === 0) return base64Chars[0] + base64Chars[0];
                let result = "";
                let n = len;
                do {
                    result = base64Chars[n % base] + result;
                    n = Math.floor(n / base);
                } while (n > 0);
                return result.padStart(2, base64Chars[0]);
            })
            .withDecodeLength((encoded) => {
                let result = 0;
                for (let i = 0; i < encoded.length; i++) {
                    const idx = base64Chars.indexOf(encoded[i]);
                    if (idx === -1) return NaN;
                    result = result * base + idx;
                }
                return result;
            })
            .withSaltRange(10, 99);
    }

    /**
     * Preset: Custom character set encoding
     * Uses a custom alphabet for encoding (more obfuscated)
     * @example FiseBuilder.customChars("!@#$%^&*()").build()
     */
    static customChars(alphabet: string = "!@#$%^&*()"): FiseBuilderInstance {
        if (alphabet.length < 10) {
            throw new Error("FISE FiseBuilder: customChars alphabet must have at least 10 characters");
        }
        const base = alphabet.length;

        return new FiseBuilderInstance()
            .withOffset((cipherText, ctx) => {
                const t = ctx.timestamp ?? 0;
                const len = cipherText.length || 1;
                return (len * 7 + (t % 11)) % len;
            })
            .withEncodeLength((len) => {
                // Encode as base-N using custom alphabet
                if (len === 0) return alphabet[0] + alphabet[0];
                let result = "";
                let n = len;
                do {
                    result = alphabet[n % base] + result;
                    n = Math.floor(n / base);
                } while (n > 0);
                return result.padStart(2, alphabet[0]);
            })
            .withDecodeLength((encoded) => {
                let result = 0;
                for (let i = 0; i < encoded.length; i++) {
                    const idx = alphabet.indexOf(encoded[i]);
                    if (idx === -1) return NaN;
                    result = result * base + idx;
                }
                return result;
            })
            .withSaltRange(10, 99);
    }
}

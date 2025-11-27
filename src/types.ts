export interface FiseContext {
	timestampMinutes?: number;
	saltLength?: number;
	randomSeed?: number;
}

/**
 * FISE rules interface - only requires 3 core security points.
 * This is the absolute minimum while maintaining full security.
 * 
 * **The Three Security Points:**
 * 1. **offset()** - Creates spatial diversity (where metadata goes)
 * 2. **encodeLength()** - Creates format diversity (how it looks)
 * 3. **decodeLength()** - Creates extraction diversity (how to read it)
 * 
 * Everything else is optional and will be automated with secure defaults.
 * 
 * @example
 * // With base36 encoding (most common)
 * const rules: FiseRules = {
 *   offset(cipherText, ctx) {
 *     const t = ctx.timestampMinutes ?? 0;
 *     return (cipherText.length * 7 + (t % 11)) % cipherText.length;
 *   },
 *   encodeLength(len) { return len.toString(36).padStart(2, "0"); },
 *   decodeLength(encoded) { return parseInt(encoded, 36); }
 * };
 */
export interface FiseRules {
	/**
	 * REQUIRED - Security Point #1: Calculate where to insert the encoded salt length.
	 * This creates SPATIAL DIVERSITY - different apps use different offsets.
	 * This is the PRIMARY security point - must vary per app.
	 */
	offset(cipherText: string, ctx: FiseContext): number;

	/**
	 * REQUIRED - Security Point #2: Encode salt length to string.
	 * This creates FORMAT DIVERSITY - different apps use different encodings.
	 * Defines how salt length is represented in the envelope.
	 */
	encodeLength(len: number, ctx: FiseContext): string;

	/**
	 * REQUIRED - Security Point #3: Decode salt length from string.
	 * This creates EXTRACTION DIVERSITY - different apps use different decodings.
	 * Must match encodeLength - decode(encode(len)) === len
	 */
	decodeLength(encoded: string, ctx: FiseContext): number;

	/**
	 * OPTIONAL: Salt length search range (default: 10-99)
	 * Only override if you use different salt length ranges.
	 * Note: This is NOT a security point - range doesn't create diversity.
	 */
	saltRange?: { min: number; max: number };

	/**
	 * OPTIONAL: Extract salt from full envelope (default: from tail).
	 * Only override if you need custom extraction logic (e.g., head-based).
	 * If not provided, defaults to tail-based extraction.
	 */
	extractSalt?(envelope: string, saltLen: number, ctx: FiseContext): string;

	/**
	 * OPTIONAL: Remove salt from envelope and return the raw cipher+metadata.
	 * Only override if you need custom extraction logic (e.g., head-based).
	 * If not provided, defaults to tail-based extraction.
	 */
	stripSalt?(envelope: string, saltLen: number, ctx: FiseContext): string;

	/**
	 * OPTIONAL: Metadata about the rules (e.g., name, description, source)
	 */
	meta?: {
		name?: string;
		description?: string;
		source?: string;
		deterministic?: boolean;
		allowsPreviousResult?: boolean;
	};
}

export interface FiseCipher {
	encrypt(plaintext: string, salt: string): string;
	decrypt(cipherText: string, salt: string): string;
}

export interface EncryptOptions {
	timestampMinutes?: number;
}

export interface DecryptOptions {
	timestampMinutes?: number;
}

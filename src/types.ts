export interface FiseContext {
	timestamp?: number;
	saltLength?: number;
	randomSeed?: number;
	/**
	 * Optional metadata object for passing custom values to rules.
	 * Allows users to pass their own context values (e.g., productId, userId, etc.)
	 * without modifying the FiseContext interface.
	 * 
	 * @example
	 * // Pass productId in metadata
	 * encryptFise(data, cipher, rules, { metadata: { productId: 123 } });
	 * // Access in rules: ctx.metadata?.productId
	 */
	metadata?: Record<string, any>;
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
 * **Type Parameter T:**
 * - Use `FiseRules<string>` for text-based encryption (default)
 * - Use `FiseRules<Uint8Array>` for binary encryption
 *
 * @example
 * // String-based rules (most common)
 * const rules: FiseRules<string> = {
 *   offset(cipherText, ctx) {
 *     const t = ctx.timestamp ?? 0;
 *     return (cipherText.length * 7 + (t % 11)) % cipherText.length;
 *   },
 *   encodeLength(len) { return len.toString(36).padStart(2, "0"); },
 *   decodeLength(encoded) { return parseInt(encoded, 36); }
 * };
 *
 * @example
 * // Binary rules
 * const binaryRules: FiseRules<Uint8Array> = {
 *   offset(cipherText, ctx) {
 *     const t = ctx.timestamp ?? 0;
 *     return (cipherText.length * 7 + (t % 11)) % cipherText.length;
 *   },
 *   encodeLength(len) {
 *     const buf = new ArrayBuffer(2);
 *     new DataView(buf).setUint16(0, len, false);
 *     return new Uint8Array(buf);
 *   },
 *   decodeLength(encoded) {
 *     return new DataView(encoded.buffer).getUint16(0, false);
 *   }
 * };
 */
export interface FiseRules<T extends string | Uint8Array = string> {
	/**
	 * REQUIRED - Security Point #1: Calculate where to insert the encoded salt length.
	 * This creates SPATIAL DIVERSITY - different apps use different offsets.
	 * This is the PRIMARY security point - must vary per app.
	 */
	offset(cipherText: T, ctx: FiseContext): number;

	/**
	 * REQUIRED - Security Point #2: Encode salt length.
	 * This creates FORMAT DIVERSITY - different apps use different encodings.
	 * Defines how salt length is represented in the envelope.
	 */
	encodeLength(len: number, ctx: FiseContext): T;

	/**
	 * REQUIRED - Security Point #3: Decode salt length.
	 * This creates EXTRACTION DIVERSITY - different apps use different decodings.
	 * Must match encodeLength - decode(encode(len)) === len
	 */
	decodeLength(encoded: T, ctx: FiseContext): number;

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
	extractSalt?(envelope: T, saltLen: number, ctx: FiseContext): T;

	/**
	 * OPTIONAL: Remove salt from envelope and return the raw cipher+metadata.
	 * Only override if you need custom extraction logic (e.g., head-based).
	 * If not provided, defaults to tail-based extraction.
	 */
	stripSalt?(envelope: T, saltLen: number, ctx: FiseContext): T;

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

/**
 * Binary cipher interface for working with binary data directly (no base64 conversion).
 * Used for video, images, files, and other binary data.
 */
export interface FiseBinaryCipher {
	encrypt(plaintext: Uint8Array, salt: Uint8Array): Uint8Array;
	decrypt(cipherText: Uint8Array, salt: Uint8Array): Uint8Array;
}

export interface EncryptOptions {
	timestamp?: number;
	/**
	 * Optional metadata to pass to rules via FiseContext.
	 * Useful for passing custom values like productId, userId, etc.
	 */
	metadata?: Record<string, any>;
}

export interface DecryptOptions {
	timestamp?: number;
	/**
	 * Optional metadata to pass to rules via FiseContext.
	 * Must match the metadata used during encryption for proper decryption.
	 */
	metadata?: Record<string, any>;
}

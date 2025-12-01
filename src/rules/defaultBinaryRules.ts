import { FiseContext, FiseRules } from "../types.js";
import { DEFAULT_OFFSET_PARAMS } from "../core/constants.js";

/**
 * Default FISE rules for binary encryption.
 * Uses the same three security points but works with binary data (Uint8Array).
 *
 * - offset: Works on byte length (same timestamp-based calculation as string mode)
 * - encodeLength: Returns Uint8Array (2 bytes, big-endian) - supports lengths up to 65535
 * - decodeLength: Takes Uint8Array and returns number
 *
 * Everything else uses defaults: tail-based salt extraction, DEFAULT_SALT_RANGE
 *
 * **Type-safe**: Only accepts Uint8Array inputs, no runtime string checks needed!
 * @see https://github.com/fise-io/fise/blob/main/src/rules/defaultBinaryRules.ts
 * @link https://github.com/anbkit/fise/blob/main/docs/RULES.md
 */
export const defaultBinaryRules: FiseRules<Uint8Array> = {
	offset(cipherText: Uint8Array, ctx) {
		const t = ctx.timestamp ?? 0;
		const len = cipherText.length || 1;
		return (len * DEFAULT_OFFSET_PARAMS.MULTIPLIER + (t % DEFAULT_OFFSET_PARAMS.MODULO)) % len;
	},

	encodeLength(len: number, _ctx: FiseContext): Uint8Array {
		// Encode as 2 bytes (big-endian) - supports salt lengths up to 65535
		const buf = new ArrayBuffer(2);
		new DataView(buf).setUint16(0, len, false); // false = big-endian
		return new Uint8Array(buf);
	},

	decodeLength(encoded: Uint8Array, _ctx: FiseContext): number {
		// Decode from 2 bytes (big-endian)
		// Type system guarantees encoded is Uint8Array - no runtime check needed!
		return new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength)
			.getUint16(0, false);
	}
};



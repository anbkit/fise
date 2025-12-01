import { FiseContext, FiseRules } from "../types.js";
import { DEFAULT_OFFSET_PARAMS } from "../core/constants.js";

/**
 * Default FISE rules for string-based encryption.
 * Uses the three core security points:
 * 1. offset() - spatial diversity (timestamp-based)
 * 2. encodeLength() - format diversity (base36 encoding)
 * 3. decodeLength() - extraction diversity (base36 decoding)
 *
 * Everything else is automated (salt extraction, brute-force, etc.)
 * This is the recommended way to create rules - just specify the 3 security points!
 * @see https://github.com/anbkit/fise/blob/main/src/rules/defaultRules.ts
 * @link https://github.com/anbkit/fise/blob/main/docs/RULES.md
 */
export const defaultRules: FiseRules<string> = {
	offset(cipherText: string, ctx) {
		const t = ctx.timestamp ?? 0;
		const len = cipherText.length || 1;
		return (len * DEFAULT_OFFSET_PARAMS.MULTIPLIER + (t % DEFAULT_OFFSET_PARAMS.MODULO)) % len;
	},

	encodeLength(len: number, ctx: FiseContext) {
		return len.toString(36).padStart(2, "0");
	},

	decodeLength(encoded: string, ctx: FiseContext) {
		return parseInt(encoded, 36);
	}
	// Everything else uses defaults: tail-based salt extraction, saltRange (10-99)
};

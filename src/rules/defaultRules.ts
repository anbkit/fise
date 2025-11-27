import { FiseContext, FiseRules } from "../types.js";

/**
 * Default FISE rules using the three core security points:
 * 1. offset() - spatial diversity
 * 2. encodeLength() - format diversity  
 * 3. decodeLength() - extraction diversity
 * 
 * Everything else is automated (salt extraction, brute-force, etc.)
 * This is the recommended way to create rules - just specify the 3 security points!
 */
export const defaultRules: FiseRules = {
	offset(cipherText: string, ctx) {
		const t = ctx.timestampMinutes ?? 0;
		const len = cipherText.length || 1;
		return (len * 7 + (t % 11)) % len;
	},

	encodeLength(len: number, ctx: FiseContext) {
		return len.toString(36).padStart(2, "0");
	},

	decodeLength(encoded: string, ctx: FiseContext) {
		return parseInt(encoded, 36);
	}
	// Everything else uses defaults: tail-based salt extraction, saltRange (10-99)
};

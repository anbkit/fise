import { DEFAULT_OFFSET_PARAMS } from "../core/constants.js";
import { xorCipher } from "../core/xorCipher.js";
import { defineStringProfile } from "../profile.js";

export const defaultStringProfile = defineStringProfile({
	id: "fise.default.string",
	representation: "string",
	transform: xorCipher,
	context: {
		timestamp: "optional",
		metadata: {},
		allowAdditionalMetadata: false
	},
	layout: {
		markerSize: 2,
		offset(input, ctx) {
			const length = input.transformedLength || 1;
			const timestamp = ctx.timestamp ?? 0;
			return (
				length * DEFAULT_OFFSET_PARAMS.MULTIPLIER +
				(timestamp % DEFAULT_OFFSET_PARAMS.MODULO)
			) % length;
		},
		createMarker(input) {
			return input.saltLength.toString(36).padStart(2, "0");
		}
	}
});

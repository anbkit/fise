import { DEFAULT_OFFSET_PARAMS } from "../core/constants.js";
import { xorBinaryCipher } from "../core/xorBinaryCipher.js";
import { defineBinaryProfile } from "../profile.js";

export const defaultBinaryProfile = defineBinaryProfile({
	id: "fise.default.binary",
	representation: "binary",
	transform: xorBinaryCipher,
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
			const marker = new Uint8Array(2);
			new DataView(marker.buffer).setUint16(0, input.saltLength, false);
			return marker;
		}
	}
});

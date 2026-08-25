import assert from "node:assert/strict";

import {
	defaultBinaryProfile,
	fiseBinaryDecrypt,
	fiseBinaryEncrypt
} from "fise";

const input = Uint8Array.from([0, 1, 2, 127, 128, 254, 255]);
const envelope = fiseBinaryEncrypt(input, defaultBinaryProfile);
const restored = fiseBinaryDecrypt(envelope, defaultBinaryProfile);
assert.deepEqual(restored, input);

assert.throws(
	() => fiseBinaryDecrypt(envelope, defaultBinaryProfile, {
		maxEnvelopeLength: envelope.length - 1
	}),
	{ code: "ENVELOPE_LIMIT" }
);

console.log("PASS binary-payload: byte round trip + caller bound");

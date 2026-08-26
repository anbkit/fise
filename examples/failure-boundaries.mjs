import assert from "node:assert/strict";

import { Fise, FiseError } from "fise";
import profile from "./fise.profile.mjs";

const fise = new Fise(profile);
const context = [
	"session_checkout_01",
	"user_42",
	"tenant_acme",
	"connection_9",
	"checkout:v1",
	21
];
const envelope = fise.encrypt({ checkoutId: "checkout_88", ready: true }, context);

assert.throws(
	() => fise.decrypt(envelope, [...context.slice(0, -1), 22]),
	hasCode("MARKER_MISMATCH")
);
assert.throws(
	() => fise.decrypt(envelope, [context[1], context[0], ...context.slice(2)]),
	hasCode("MARKER_MISMATCH")
);
assert.throws(
	() => fise.encrypt("invalid context shape", [{ session: context[0] }]),
	hasCode("INVALID_CONTEXT")
);

const unsupportedVersion = envelope.slice();
unsupportedVersion[4] = 1;
assert.throws(
	() => fise.decrypt(unsupportedVersion, context),
	hasCode("UNSUPPORTED_VERSION")
);

console.log("PASS failure-boundaries: wrong session state and invalid wire inputs failed closed");

function hasCode(code) {
	return error => error instanceof FiseError && error.code === code;
}

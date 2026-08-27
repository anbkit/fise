import assert from "node:assert/strict";

import { Fise, FiseError } from "fise";
import profile from "./fise.profile.mjs";

const strict = new Fise(profile);
const fallback = new Fise(profile, { strict: false });
const context = ["session_demo_01", "user_42", "orders", "v1"];
const order = { id: 42, status: "ready" };

const fallbackEnvelope = fallback.encrypt(order, context);
assert.equal(typeof fallbackEnvelope, "string");
assert.notStrictEqual(fallbackEnvelope, order);
assert.deepEqual(fallback.decrypt(fallbackEnvelope, context), order);

const unsupported = new Date("2026-08-27T00:00:00.000Z");
assert.throws(() => strict.encrypt(unsupported), FiseError);
assert.strictEqual(fallback.encrypt(unsupported), unsupported);

const envelope = strict.encrypt(order, context);
assert.strictEqual(
	fallback.decrypt(envelope, ["another-session", "user_42", "orders", "v1"]),
	envelope
);

const rawResponse = { source: "plain endpoint", order };
assert.strictEqual(fallback.decrypt(rawResponse, context), rawResponse);

console.log("PASS raw-fallback: opt-in ordinary operations preserved rejected raw inputs");

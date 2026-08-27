import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { Fise } from "fise";
import profile from "./fise.profile.mjs";

const fise = new Fise(profile);
const sessionId = randomUUID();
const userId = "user_42";
const responseSequence = 17;
// Optional client-visible session ID; never place an auth credential in context.
const context = [sessionId, userId, "orders", "v1", responseSequence];
const payload = {
	orderId: "order_1042",
	status: "ready",
	items: [{ sku: "fise-shirt", quantity: 2 }]
};

const apiResponse = JSON.stringify({
	data: fise.encrypt(payload, context)
});
const receivedEnvelope = JSON.parse(apiResponse).data;

assert.equal(typeof receivedEnvelope, "string");
assert.deepEqual(fise.decrypt(receivedEnvelope, context), payload);

console.log("PASS api-session: temporary client/server session state restored one API payload");

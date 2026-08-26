import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { Fise } from "fise";
import profile from "./fise.profile.mjs";

const fise = new Fise(profile);
const serverSession = Object.freeze({
	bindingId: randomUUID(),
	userId: "user_42",
	tenantId: "tenant_acme",
	connectionEpoch: 3
});

// The application establishes this short-lived state separately from the
// envelope, for example during session bootstrap.
const clientSession = Object.freeze({ ...serverSession });
const responseSequence = 17;
const serverContext = contextFor(serverSession, "orders:v1", responseSequence);
const payload = {
	orderId: "order_1042",
	status: "ready",
	items: [{ sku: "fise-shirt", quantity: 2 }]
};

const response = new Response(fise.encrypt(payload, serverContext), {
	headers: { "content-type": "application/vnd.fise" }
});
const receivedEnvelope = new Uint8Array(await response.arrayBuffer());
const clientContext = contextFor(clientSession, "orders:v1", responseSequence);

assert.equal(response.headers.get("content-type"), "application/vnd.fise");
assert.deepEqual(fise.decrypt(receivedEnvelope, clientContext), payload);

console.log("PASS api-session: temporary client/server session state restored one API payload");

function contextFor(session, resource, sequence) {
	return [
		session.bindingId,
		session.userId,
		session.tenantId,
		session.connectionEpoch,
		resource,
		sequence
	];
}

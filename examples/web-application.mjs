import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";

import { Fise } from "fise";
import profile from "./fise.profile.mjs";

const fise = new Fise(profile);
const sessionId = "client_session_7f4a";
const currentUserId = "user_42";
const order = {
	orderId: "order_1042",
	status: "ready",
	items: [{ sku: "fise-shirt", quantity: 2 }]
};
const fileBytes = Uint8Array.from(
	{ length: 96 * 1024 },
	(_, index) => (index * 31 + 11) & 0xff
);

const server = createServer((request, response) => {
	if (request.headers["x-client-session"] !== sessionId) {
		response.writeHead(400).end();
		return;
	}
	if (request.url === "/api/order") {
		const sequence = 17;
		const context = [sessionId, currentUserId, "orders", "v1", sequence];
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify({ data: fise.encrypt(order, context), sequence }));
		return;
	}
	if (request.url === "/api/receipt") {
		const sequence = 18;
		const context = [sessionId, currentUserId, "receipts", "v1", sequence];
		response.writeHead(200, {
			"content-type": "application/octet-stream",
			"x-fise-sequence": String(sequence)
		});
		response.end(fise.encrypt(fileBytes, context));
		return;
	}
	response.writeHead(404).end();
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address === "object");
const origin = `http://127.0.0.1:${address.port}`;

try {
	const orderResponse = await fetch(`${origin}/api/order`, {
		headers: { "x-client-session": sessionId }
	});
	assert.equal(orderResponse.ok, true);
	assert.match(orderResponse.headers.get("content-type") ?? "", /^application\/json/);
	const transport = await orderResponse.json();
	const orderContext = [
		sessionId,
		currentUserId,
		"orders",
		"v1",
		transport.sequence
	];
	const restoredOrder = validateOrder(fise.decrypt(transport.data, orderContext));
	assert.deepEqual(restoredOrder, order);

	const receiptResponse = await fetch(`${origin}/api/receipt`, {
		headers: { "x-client-session": sessionId }
	});
	assert.equal(receiptResponse.ok, true);
	assert.equal(receiptResponse.headers.get("content-type"), "application/octet-stream");
	const receiptSequence = Number(receiptResponse.headers.get("x-fise-sequence"));
	const receiptContext = [
		sessionId,
		currentUserId,
		"receipts",
		"v1",
		receiptSequence
	];
	const encryptedReceipt = new Uint8Array(await receiptResponse.arrayBuffer());
	const restoredReceipt = fise.decrypt(encryptedReceipt, receiptContext);
	assert.ok(restoredReceipt instanceof Uint8Array);
	assert.deepEqual(restoredReceipt, fileBytes);
	const receiptBlob = new Blob([restoredReceipt], { type: "application/pdf" });
	assert.equal(receiptBlob.size, fileBytes.length);
	assert.equal(receiptBlob.type, "application/pdf");
} finally {
	server.close();
	await once(server, "close");
}

console.log("PASS web-application: HTTP JSON and binary restored with synchronized context");

function validateOrder(value) {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		typeof value.orderId !== "string" ||
		typeof value.status !== "string" ||
		!Array.isArray(value.items)
	) {
		throw new Error("Invalid restored order");
	}
	return value;
}

import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { setImmediate as nextTurn } from "node:timers/promises";

import { Fise } from "fise";
import profile from "./fise.profile.mjs";

const fise = new Fise(profile);
const sessionId = "client_session_agent_7f4a";
const userId = "user_42";
const streamId = "agent_stream_1042";
const expectedEvents = [
	{ type: "response.started", responseId: "response_1042" },
	{ type: "text.delta", delta: "Checking order status. " },
	{
		type: "tool.call",
		name: "lookupOrder",
		arguments: { orderId: "order_1042" }
	},
	{
		type: "tool.result",
		name: "lookupOrder",
		result: { orderId: "order_1042", status: "ready" }
	},
	{ type: "text.delta", delta: "Order order_1042 is ready." },
	{ type: "response.completed", usage: { inputTokens: 18, outputTokens: 11 } }
];

const server = createServer((request, response) => {
	if (request.url !== "/api/agent-stream") {
		response.writeHead(404).end();
		return;
	}
	if (request.headers["x-client-session"] !== sessionId) {
		response.writeHead(400).end();
		return;
	}
	if (!request.headers.accept?.includes("text/event-stream")) {
		response.writeHead(406).end();
		return;
	}

	response.writeHead(200, {
		"content-type": "text/event-stream; charset=utf-8",
		"cache-control": "no-cache"
	});
	response.flushHeaders();
	void sendAgentEvents(response).catch((error) => response.destroy(error));
});

server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address === "object");

try {
	const response = await fetch(`http://127.0.0.1:${address.port}/api/agent-stream`, {
		headers: {
			accept: "text/event-stream",
			"x-client-session": sessionId
		}
	});
	assert.equal(response.ok, true);
	assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/);
	assert.ok(response.body);

	const restoredEvents = await readAgentEvents(response.body);
	assert.deepEqual(restoredEvents, expectedEvents);
	assert.equal(
		restoredEvents
			.filter((event) => event.type === "text.delta")
			.map((event) => event.delta)
			.join(""),
		"Checking order status. Order order_1042 is ready."
	);
	assert.equal(restoredEvents.at(-1)?.type, "response.completed");
} finally {
	server.close();
	await once(server, "close");
}

console.log(`PASS agent-stream: restored ${expectedEvents.length} encrypted SSE events in order`);

async function sendAgentEvents(response) {
	for (let sequence = 0; sequence < expectedEvents.length; sequence += 1) {
		const context = [sessionId, userId, "agent-stream", "v1", streamId, sequence];
		const frame = {
			streamId,
			sequence,
			data: fise.encrypt(expectedEvents[sequence], context)
		};
		response.write(`data: ${JSON.stringify(frame)}\n\n`);
		await nextTurn();
	}
	response.end();
}

async function readAgentEvents(body) {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	const events = [];
	let pending = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		pending += decoder.decode(value, { stream: true });
		pending = consumeSseFrames(pending, events);
	}

	pending += decoder.decode();
	pending = consumeSseFrames(pending, events);
	assert.equal(pending, "");
	return events;
}

function consumeSseFrames(input, events) {
	let pending = input;
	let boundary = pending.indexOf("\n\n");

	while (boundary !== -1) {
		const record = pending.slice(0, boundary);
		pending = pending.slice(boundary + 2);
		const lines = record.split("\n");
		assert.equal(lines.length, 1);
		assert.ok(lines[0].startsWith("data: "));
		const frame = validateFrame(JSON.parse(lines[0].slice(6)), events.length);
		const context = [
			sessionId,
			userId,
			"agent-stream",
			"v1",
			frame.streamId,
			frame.sequence
		];
		events.push(validateAgentEvent(fise.decrypt(frame.data, context)));
		boundary = pending.indexOf("\n\n");
	}

	return pending;
}

function validateFrame(value, expectedSequence) {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		value.streamId !== streamId ||
		value.sequence !== expectedSequence ||
		typeof value.data !== "string"
	) {
		throw new Error("Invalid agent stream frame");
	}
	return value;
}

function validateAgentEvent(value) {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		typeof value.type !== "string"
	) {
		throw new Error("Invalid restored agent event");
	}
	return value;
}

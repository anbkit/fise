import assert from "node:assert/strict";
import test from "node:test";

import {
	defaultBinaryProfile,
	defineBinaryProfile,
	fiseBinaryEncrypt
} from "fise";
import {
	FISE_MEDIA_TYPE,
	createFiseJsonResponse,
	createFiseResponse,
	fiseJsonDecrypt,
	fiseJsonEncrypt,
	fiseUtf8Decrypt,
	fiseUtf8Encrypt,
	readFiseJsonResponse,
	readFiseResponse
} from "fise/http";

test("UTF-8 and JSON helpers roundtrip through binary envelopes", () => {
	const text = "FISE 👋 — tiếng Việt";
	assert.equal(
		fiseUtf8Decrypt(fiseUtf8Encrypt(text, defaultBinaryProfile), defaultBinaryProfile),
		text
	);
	const value = { ok: true, nested: [1, "hai", null] };
	assert.deepEqual(
		fiseJsonDecrypt(fiseJsonEncrypt(value, defaultBinaryProfile), defaultBinaryProfile),
		value
	);
});

test("Response helpers preserve status and enforce the media contract", async () => {
	const response = createFiseJsonResponse(
		{ message: "binary first" },
		defaultBinaryProfile,
		{},
		{
			status: 202,
			headers: {
				"x-request-id": "r1",
				"content-length": "1",
				"content-encoding": "gzip"
			}
		}
	);
	assert.equal(response.status, 202);
	assert.equal(response.headers.get("x-request-id"), "r1");
	assert.equal(response.headers.get("content-length"), null);
	assert.equal(response.headers.get("content-encoding"), null);
	assert.equal(
		response.headers.get("content-type"),
		`${FISE_MEDIA_TYPE}; version=1.1; profile="${defaultBinaryProfile.id}"`
	);
	assert.deepEqual(
		await readFiseJsonResponse(response, defaultBinaryProfile),
		{ message: "binary first" }
	);
});

test("raw Response helpers carry Uint8Array payloads", async () => {
	const payload = Uint8Array.from([0, 1, 2, 254, 255]);
	const response = createFiseResponse(payload, defaultBinaryProfile);
	assert.deepEqual(
		await readFiseResponse(response, defaultBinaryProfile),
		payload
	);
});

test("Response readers reject wrong media type, version, profile and declared length", async () => {
	const envelope = fiseBinaryEncrypt(Uint8Array.from([1]), defaultBinaryProfile);
	const body = () => new Uint8Array(envelope);
	await assert.rejects(
		readFiseResponse(new Response(body()), defaultBinaryProfile),
		{ code: "INVALID_PAYLOAD" }
	);
	await assert.rejects(
		readFiseResponse(new Response(body(), {
			headers: { "content-type": `${FISE_MEDIA_TYPE}; version=9.9; profile="${defaultBinaryProfile.id}"` }
		}), defaultBinaryProfile),
		{ code: "UNSUPPORTED_VERSION" }
	);
	await assert.rejects(
		readFiseResponse(new Response(body(), {
			headers: { "content-type": `${FISE_MEDIA_TYPE}; version=1.1; profile="other.profile"` }
		}), defaultBinaryProfile),
		{ code: "PROFILE_MISMATCH" }
	);
	await assert.rejects(
		readFiseResponse(new Response(body(), {
			headers: {
				"content-type": `${FISE_MEDIA_TYPE}; version=1.1; profile="${defaultBinaryProfile.id}"`,
				"content-length": "999"
			}
		}), defaultBinaryProfile, { maxEnvelopeLength: 100 }),
		{ code: "ENVELOPE_LIMIT" }
	);
	await assert.rejects(
		readFiseResponse(new Response(body(), {
			headers: {
				"content-type": `${FISE_MEDIA_TYPE}; version=1.1; profile="${defaultBinaryProfile.id}"`,
				"content-encoding": "identity",
				"content-length": "1"
			}
		}), defaultBinaryProfile, { maxEnvelopeLength: 1_000 }),
		{ code: "LENGTH_MISMATCH" }
	);
});

test("Response readers accept a decoded body with compressed transport metadata", async () => {
	const payload = Uint8Array.from({ length: 512 }, (_, index) => index & 0xff);
	const envelope = fiseBinaryEncrypt(payload, defaultBinaryProfile);
	const response = new Response(envelope, {
		headers: {
			"content-type": `${FISE_MEDIA_TYPE}; version=1.1; profile="${defaultBinaryProfile.id}"`,
			"content-encoding": "gzip",
			// Fetch exposes decoded body bytes while network metadata can retain
			// the compressed representation's Content-Length.
			"content-length": String(envelope.length + 1_000)
		}
	});
	assert.deepEqual(
		await readFiseResponse(response, defaultBinaryProfile, {
			maxEnvelopeLength: envelope.length
		}),
		payload
	);
});

test("bounded Response reads cancel the stream as soon as the limit is exceeded", async () => {
	let pulls = 0;
	let cancelled = false;
	const stream = new ReadableStream({
		pull(controller) {
			pulls++;
			controller.enqueue(new Uint8Array(64));
			if (pulls === 10) controller.close();
		},
		cancel() {
			cancelled = true;
		}
	}, { highWaterMark: 0 });
	const response = new Response(stream, {
		headers: {
			"content-type": `${FISE_MEDIA_TYPE}; version=1.1; profile="${defaultBinaryProfile.id}"`
		}
	});

	await assert.rejects(
		readFiseResponse(response, defaultBinaryProfile, { maxEnvelopeLength: 100 }),
		{ code: "ENVELOPE_LIMIT" }
	);
	assert.equal(cancelled, true);
	assert.ok(pulls <= 2, `expected at most two pulls, received ${pulls}`);
});

test("bounded Response reads do not wait for cancellation settlement", async () => {
	for (const cancel of [
		() => Promise.reject(new Error("cancel rejected")),
		() => new Promise(() => undefined)
	]) {
		const stream = new ReadableStream({
			pull(controller) {
				controller.enqueue(new Uint8Array(101));
			},
			cancel
		}, { highWaterMark: 0 });
		const response = new Response(stream, {
			headers: {
				"content-type": `${FISE_MEDIA_TYPE}; version=1.1; profile="${defaultBinaryProfile.id}"`
			}
		});
		const outcome = await Promise.race([
			readFiseResponse(response, defaultBinaryProfile, { maxEnvelopeLength: 100 })
				.then(() => "unexpected success", error => error),
			new Promise(resolve => setTimeout(() => resolve("timeout"), 100))
		]);
		assert.notEqual(outcome, "timeout");
		assert.equal(outcome.code, "ENVELOPE_LIMIT");
	}
});

test("bounded Response reads fail closed without a readable stream", async () => {
	const response = {
		headers: new Headers({
			"content-type": `${FISE_MEDIA_TYPE}; version=1.1; profile="${defaultBinaryProfile.id}"`
		}),
		arrayBuffer: async () => new ArrayBuffer(0)
	};
	await assert.rejects(
		readFiseResponse(response, defaultBinaryProfile, { maxEnvelopeLength: 100 }),
		{ code: "RUNTIME_UNAVAILABLE" }
	);
});

test("Response readers retain one profile snapshot across asynchronous body reads", async () => {
	const profileB = defineBinaryProfile({
		...defaultBinaryProfile,
		id: "test.http.profile-b"
	});
	const envelopeB = fiseBinaryEncrypt(Uint8Array.from([9, 8, 7]), profileB);
	let releaseBody;
	const bodyGate = new Promise(resolve => {
		releaseBody = resolve;
	});
	const stream = new ReadableStream({
		async pull(controller) {
			await bodyGate;
			controller.enqueue(envelopeB);
			controller.close();
		}
	});
	const mutableProfile = {
		...defaultBinaryProfile,
		id: "test.http.profile-a"
	};
	const response = new Response(stream, {
		headers: {
			"content-type": `${FISE_MEDIA_TYPE}; version=1.1; profile="test.http.profile-a"`
		}
	});
	const pending = readFiseResponse(response, mutableProfile);
	mutableProfile.id = profileB.id;
	releaseBody();
	await assert.rejects(pending, { code: "PROFILE_MISMATCH" });
});

test("bounded Response readers normalize locked-stream failures", async () => {
	const envelope = fiseBinaryEncrypt(Uint8Array.from([1]), defaultBinaryProfile);
	const response = new Response(envelope, {
		headers: {
			"content-type": `${FISE_MEDIA_TYPE}; version=1.1; profile="${defaultBinaryProfile.id}"`
		}
	});
	const lock = response.body.getReader();
	try {
		await assert.rejects(
			readFiseResponse(response, defaultBinaryProfile, {
				maxEnvelopeLength: envelope.length
			}),
			{ code: "INVALID_PAYLOAD" }
		);
	} finally {
		lock.releaseLock();
	}
});

test("payload helpers expose typed UTF-8, JSON and serialization failures", () => {
	const invalidUtf8 = fiseBinaryEncrypt(Uint8Array.from([0xff]), defaultBinaryProfile);
	assert.throws(() => fiseUtf8Decrypt(invalidUtf8, defaultBinaryProfile), {
		code: "INVALID_PAYLOAD"
	});
	const notJson = fiseUtf8Encrypt("not-json", defaultBinaryProfile);
	assert.throws(() => fiseJsonDecrypt(notJson, defaultBinaryProfile), {
		code: "INVALID_PAYLOAD"
	});
	assert.throws(() => fiseJsonEncrypt(undefined, defaultBinaryProfile), {
		code: "INVALID_INPUT"
	});
	assert.throws(() => fiseJsonEncrypt(1n, defaultBinaryProfile), {
		code: "INVALID_INPUT"
	});
});

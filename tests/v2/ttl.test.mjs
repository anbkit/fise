import assert from "node:assert/strict";
import test from "node:test";

import { Fise, FiseError, Profile } from "fise";
import { decodeBase64Url } from "../../dist/v2/base64Url.js";
import { FISE_MAX_ENVELOPE_LENGTH } from "../../dist/v2/envelope.js";
import { setFiseClockForTesting } from "../../dist/v2/fise.js";
import profile from "./profile-a.generated.mjs";

const context = ["session_7f4a", "user_42", "orders", "v1"];

test("constructor TTL is snapshotted, bounded, and optional", () => {
	const options = { ttlSeconds: 30 };
	const expiring = new Fise(profile, options);
	options.ttlSeconds = 60;
	assert.equal(expiring.ttlSeconds, 30);
	assert.equal(new Fise(profile).ttlSeconds, undefined);
	assert.equal(new Fise(profile, { ttlSeconds: undefined }).ttlSeconds, undefined);

	for (const ttlSeconds of [
		0,
		-1,
		0.5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		0x1_0000_0000,
		"30",
		true,
		null
	]) {
		assert.throws(
			() => new Fise(profile, { ttlSeconds }),
			(error) => error instanceof FiseError && error.code === "INVALID_INPUT"
		);
	}
});

test("ordinary envelopes expire at the exact half-open second boundary", () => {
	let nowMilliseconds = 1_000_000;
	const producer = new Fise(profile, { ttlSeconds: 30 });
	const consumer = new Fise(profile);
	setFiseClockForTesting(producer, () => nowMilliseconds);
	setFiseClockForTesting(consumer, () => nowMilliseconds);

	const envelope = producer.encrypt({ orderId: 42 }, context);
	const wire = wireOf(envelope);
	const view = new DataView(wire.buffer, wire.byteOffset, wire.byteLength);
	assert.equal(wire[6], 40);
	assert.equal(view.getBigUint64(32, false), 1_030n);

	nowMilliseconds = 1_029_999;
	assert.deepEqual(consumer.decrypt(envelope, context), { orderId: 42 });

	nowMilliseconds = 1_030_000;
	assert.throws(
		() => consumer.decrypt(envelope, context),
		(error) => error instanceof FiseError && error.code === "ENVELOPE_EXPIRED"
	);
	assert.throws(
		() => consumer.decrypt(envelope, ["wrong-context"]),
		(error) => error instanceof FiseError && error.code === "MARKER_MISMATCH"
	);
});

test("TTL lifetime is never shortened by a partial producer second", () => {
	let nowMilliseconds = 1_999;
	const producer = new Fise(profile, { ttlSeconds: 1 });
	const consumer = new Fise(profile);
	setFiseClockForTesting(producer, () => nowMilliseconds);
	setFiseClockForTesting(consumer, () => nowMilliseconds);

	const envelope = producer.encrypt({ orderId: 42 }, context);
	const wire = wireOf(envelope);
	assert.equal(new DataView(wire.buffer, wire.byteOffset, wire.byteLength).getBigUint64(32), 3n);

	nowMilliseconds = 2_999;
	assert.deepEqual(consumer.decrypt(envelope, context), { orderId: 42 });
	nowMilliseconds = 3_000;
	assert.throws(
		() => consumer.decrypt(envelope, context),
		(error) => error instanceof FiseError && error.code === "ENVELOPE_EXPIRED"
	);
});

test("wire expiry is authoritative and independent of the decrypting instance TTL", () => {
	let nowMilliseconds = 2_000_000;
	const producer = new Fise(profile, { ttlSeconds: 30 });
	const shortPolicyConsumer = new Fise(profile, { ttlSeconds: 1 });
	setFiseClockForTesting(producer, () => nowMilliseconds);
	setFiseClockForTesting(shortPolicyConsumer, () => nowMilliseconds);
	const envelope = producer.encrypt("wire-owned lifetime", context);

	nowMilliseconds = 2_002_000;
	assert.equal(shortPolicyConsumer.decrypt(envelope, context), "wire-owned lifetime");

	const permanentProducer = new Fise(profile);
	setFiseClockForTesting(permanentProducer, () => {
		throw new Error("a non-TTL encrypt must not read the clock");
	});
	const permanent = permanentProducer.encrypt("no expiry", context);
	setFiseClockForTesting(shortPolicyConsumer, () => {
		throw new Error("a non-TTL decrypt must not read the clock");
	});
	assert.equal(shortPolicyConsumer.decrypt(permanent, context), "no expiry");
	const permanentWire = wireOf(permanent);
	assert.equal(
		new DataView(permanentWire.buffer, permanentWire.byteOffset, permanentWire.byteLength)
			.getBigUint64(32, false),
		0n
	);
});

test("expiry metadata is deterministic, bound to the profile operation, and tamper-evident", () => {
	let nowMilliseconds = 3_000_000;
	const thirtySeconds = new Fise(profile, { ttlSeconds: 30 });
	const sixtySeconds = new Fise(profile, { ttlSeconds: 60 });
	setFiseClockForTesting(thirtySeconds, () => nowMilliseconds);
	setFiseClockForTesting(sixtySeconds, () => nowMilliseconds);

	const first = thirtySeconds.encrypt("bound", context);
	const repeated = thirtySeconds.encrypt("bound", context);
	const differentTtl = sixtySeconds.encrypt("bound", context);
	assert.deepEqual(repeated, first);
	assert.notDeepEqual(differentTtl, first);

	for (const expiresAtSeconds of [0n, 9_999n]) {
		const tampered = wireOf(first).slice();
		new DataView(tampered.buffer, tampered.byteOffset, tampered.byteLength)
			.setBigUint64(32, expiresAtSeconds, false);
		assert.throws(
			() => thirtySeconds.decrypt(tampered, context),
			(error) => error instanceof FiseError && error.code === "MARKER_MISMATCH"
		);
	}

	nowMilliseconds = 3_001_000;
	assert.equal(thirtySeconds.decrypt(first, context), "bound");
});

test("TTL binding does not add hidden values to application context callbacks", () => {
	const observed = [];
	const bindingProfile = Profile.generated(
		"1029384756abcdef1029384756abcdef",
		0,
		12,
		(encoded, callbackContext) => {
			observed.push({ encoded: encoded.slice(), context: callbackContext });
			let lane = 0;
			for (const byte of encoded) lane = Math.imul((lane ^ byte) >>> 0, 0x45d9_f3b) >>> 0;
			return [lane, 0, 0, 0];
		},
		() => 0,
		(_layout, state) => state[0],
		(input, _segment, state) => input.map(byte => byte ^ (state[0] & 0xff)),
		(input, _segment, state) => input.map(byte => byte ^ (state[0] & 0xff))
	);
	observed.length = 0;
	const fise = new Fise(bindingProfile, { ttlSeconds: 30 });
	setFiseClockForTesting(fise, () => 7_000_000);
	const callbackContext = [23, "route"];
	const envelope = fise.encrypt("callback context", callbackContext);
	assert.equal(fise.decrypt(envelope, callbackContext), "callback context");

	const baseEncoding = new TextEncoder().encode("WzIzLCJyb3V0ZSJd");
	assert.ok(observed.length >= 2);
	for (const entry of observed) {
		assert.deepEqual(entry.context, callbackContext);
		assert.equal(Object.isFrozen(entry.context), true);
		assert.deepEqual(entry.encoded.subarray(0, baseEncoding.length), baseEncoding);
		assert.equal(entry.encoded[baseEncoding.length], 0);
		assert.equal(entry.encoded.length, baseEncoding.length + 18);
	}
});

test("expiration and clock failures bypass raw fallback", () => {
	let nowMilliseconds = 4_000_000;
	const fallback = new Fise(profile, { strict: false, ttlSeconds: 1 });
	setFiseClockForTesting(fallback, () => nowMilliseconds);
	const envelope = fallback.encrypt("short lived", context);
	nowMilliseconds = 4_001_000;
	assert.throws(
		() => fallback.decrypt(envelope, context),
		(error) => error instanceof FiseError && error.code === "ENVELOPE_EXPIRED"
	);

	const clockFailure = new Error("clock failed");
	setFiseClockForTesting(fallback, () => {
		throw clockFailure;
	});
	assert.throws(
		() => fallback.encrypt("clock-bound", context),
		(error) =>
			error instanceof FiseError &&
			error.code === "CLOCK_UNAVAILABLE" &&
			error.cause === clockFailure
	);
	setFiseClockForTesting(fallback, () => Number.NaN);
	assert.throws(
		() => fallback.decrypt(envelope, context),
		(error) => error instanceof FiseError && error.code === "CLOCK_UNAVAILABLE"
	);
});

test("ordinary binary TTL covers full/edge, range, and progressive restore", async () => {
	let nowMilliseconds = 5_000_000;
	const fise = new Fise(profile, { ttlSeconds: 2 });
	const edgeFise = new Fise(profile, {
		ttlSeconds: 2,
		binary: { mode: "edges", edgeBytes: 128 }
	});
	setFiseClockForTesting(fise, () => nowMilliseconds);
	setFiseClockForTesting(edgeFise, () => nowMilliseconds);
	const input = Uint8Array.from({ length: 1_003 }, (_, index) => (index * 17 + 3) & 0xff);
	const envelope = fise.encrypt(input, context);
	const edgeEnvelope = edgeFise.encrypt(input, context);
	const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
	const edgeView = new DataView(
		edgeEnvelope.buffer,
		edgeEnvelope.byteOffset,
		edgeEnvelope.byteLength
	);
	assert.equal(envelope[6], 40);
	assert.equal(view.getBigUint64(32, false), 5_002n);
	assert.equal(edgeEnvelope[7], 1);
	assert.equal(edgeView.getUint32(28, false), 128);
	assert.equal(edgeView.getBigUint64(32, false), 5_002n);

	for (const mutate of [
		(bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
			.setBigUint64(32, 5_003n, false),
		(bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
			.setUint32(28, 129, false),
		(bytes) => {
			bytes[7] = 0;
			new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(28, 0, false);
		}
	]) {
		const tampered = edgeEnvelope.slice();
		mutate(tampered);
		assert.throws(
			() => fise.decrypt(tampered, context),
			(error) => error instanceof FiseError && error.code === "MARKER_MISMATCH"
		);
	}

	nowMilliseconds = 5_001_000;
	assert.deepEqual(fise.decrypt(envelope, context), input);
	assert.deepEqual(fise.decrypt(edgeEnvelope, context), input);
	assert.deepEqual(
		fise.decryptRange(envelope, { start: 111, endExclusive: 777 }, context),
		input.slice(111, 777)
	);
	assert.deepEqual(
		fise.decryptRange(edgeEnvelope, { start: 111, endExclusive: 777 }, context),
		input.slice(111, 777)
	);
	const progressive = fise.decryptProgressive(envelope, context, { chunkSize: 256 });
	const edgeProgressive = fise.decryptProgressive(edgeEnvelope, context, { chunkSize: 256 });

	nowMilliseconds = 5_002_000;
	const restoredChunks = [];
	for await (const chunk of progressive) restoredChunks.push(chunk);
	assert.deepEqual(join(restoredChunks), input);
	const restoredEdgeChunks = [];
	for await (const chunk of edgeProgressive) restoredEdgeChunks.push(chunk);
	assert.deepEqual(join(restoredEdgeChunks), input);
	for (const operation of [
		() => fise.decrypt(envelope, context),
		() => fise.decrypt(edgeEnvelope, context),
		() => fise.decryptRange(envelope, { start: 0, endExclusive: 0 }, context),
		() => fise.decryptRange(edgeEnvelope, { start: 0, endExclusive: 0 }, context),
		() => fise.decryptProgressive(envelope, context),
		() => fise.decryptProgressive(edgeEnvelope, context)
	]) {
		assert.throws(
			operation,
			(error) => error instanceof FiseError && error.code === "ENVELOPE_EXPIRED"
		);
	}
});

test("ordinary binary binds expiry, including an empty payload", () => {
	let nowMilliseconds = 6_000_000;
	const fise = new Fise(profile, { ttlSeconds: 1 });
	setFiseClockForTesting(fise, () => nowMilliseconds);
	const empty = fise.encrypt(new Uint8Array(), context);
	const tampered = empty.slice();
	new DataView(tampered.buffer, tampered.byteOffset, tampered.byteLength)
		.setBigUint64(32, 9_999n, false);
	assert.throws(
		() => fise.decrypt(tampered, context),
		(error) => error instanceof FiseError && error.code === "MARKER_MISMATCH"
	);

	nowMilliseconds = 6_001_000;
	assert.throws(
		() => fise.decryptRange(empty, { start: 0, endExclusive: 0 }, context),
		(error) => error instanceof FiseError && error.code === "ENVELOPE_EXPIRED"
	);
});

function join(frames) {
	const output = new Uint8Array(frames.reduce((length, frame) => length + frame.length, 0));
	let offset = 0;
	for (const frame of frames) {
		output.set(frame, offset);
		offset += frame.length;
	}
	return output;
}

function wireOf(envelope) {
	return typeof envelope === "string"
		? decodeBase64Url(envelope, FISE_MAX_ENVELOPE_LENGTH)
		: envelope;
}

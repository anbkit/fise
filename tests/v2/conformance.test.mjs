import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	Fise,
	FiseError,
	FISE_WIRE_VERSION
} from "fise";
import profile from "../../conformance/v2/profile.generated.mjs";
import { decodeBase64Url } from "../../dist/v2/base64Url.js";
import {
	canonicalJson,
	decodeValue,
	encodeValue,
	prepareContext
} from "../../dist/v2/codec.js";
import {
	FISE_MAX_ENVELOPE_LENGTH,
	openPayload
} from "../../dist/v2/envelope.js";
import { setFiseClockForTesting } from "../../dist/v2/fise.js";
import {
	compressLz4Block,
	decompressLz4Block
} from "../../dist/v2/lz4.js";

const vectors = JSON.parse(readFileSync(
	new URL("../../conformance/v2/vectors.json", import.meta.url),
	"utf8"
));

test("the FISE 2.0 conformance corpus identifies one frozen contract profile", () => {
	assert.equal(vectors.format, "fise-v2-conformance");
	assert.deepEqual(vectors.wireVersion, FISE_WIRE_VERSION);
	assert.equal(vectors.profileFingerprint, profile.fingerprint);
	assert.equal(Object.isFrozen(profile), true);
});

test("canonical structured vectors preserve exact JSON text and UTF-8 bytes", () => {
	for (const vector of vectors.canonicalJson) {
		const canonical = canonicalJson(JSON.parse(vector.inputJson));
		assert.equal(canonical, vector.canonicalJson, vector.id);
		assert.equal(hexOf(new TextEncoder().encode(canonical)), vector.utf8Hex, vector.id);
	}
});

test("positional context vectors preserve canonical JSON and Base64URL bytes", () => {
	for (const vector of vectors.contexts) {
		const prepared = prepareContext(JSON.parse(vector.inputJson));
		assert.equal(canonicalJson(prepared.value), vector.canonicalJson, vector.id);
		assert.equal(new TextDecoder().decode(prepared.encoded), vector.encodedBase64Url, vector.id);
	}
});

test("binary64 numbers use the frozen ECMAScript JSON representation", () => {
	for (const vector of vectors.numberSerialization) {
		assert.equal(
			canonicalJson(numberFromIeee754Hex(vector.ieee754Hex)),
			vector.canonicalJson,
			vector.ieee754Hex
		);
	}
});

test("the deterministic LZ4 encoder matches every frozen block decision", () => {
	for (const vector of vectors.lz4Blocks) {
		const input = bytesOf(vector.inputHex);
		const compressed = compressLz4Block(input);
		assert.equal(hexOf(compressed), vector.compressedHex, vector.id);
		assert.deepEqual(
			decompressLz4Block(compressed, input.length),
			input,
			vector.id
		);
	}
});

test("malformed LZ4 blocks fail with the frozen payload error", () => {
	for (const vector of vectors.invalidLz4Blocks) {
		assert.throws(
			() => decompressLz4Block(
				bytesOf(vector.compressedHex),
				vector.expectedLength
			),
			(error) => error instanceof FiseError && error.code === vector.errorCode,
			vector.id
		);
	}
});

test("logical payload metadata and adaptive LZ4 bytes remain exact", () => {
	for (const vector of vectors.payloads) {
		const value = inputOf(vector);
		const payload = encodeValue(value);
		assert.equal(hexOf(payload), vector.payloadHex, vector.id);
		if (vector.canonicalLength !== undefined) {
			assert.equal(
				new TextEncoder().encode(canonicalJson(value)).length,
				vector.canonicalLength,
				vector.id
			);
		}
		if (vector.payloadType !== undefined) {
			assert.equal(payload[1], vector.payloadType, vector.id);
		}
		assert.deepEqual(decodeValue(payload), value, vector.id);
	}
});

test("ordinary, edge, and TTL envelopes match their golden transports", () => {
	for (const vector of vectors.envelopes) {
		const producer = new Fise(profile, vector.options ?? {});
		const consumer = new Fise(profile);
		if (vector.clockMilliseconds !== undefined) {
			setFiseClockForTesting(producer, () => vector.clockMilliseconds);
			setFiseClockForTesting(consumer, () => vector.clockMilliseconds);
		}
		const input = inputOf(vector);
		const envelope = producer.encrypt(input, vector.context);
		assert.equal(
			typeof envelope,
			vector.transport === "base64url" ? "string" : "object",
			vector.id
		);
		if (vector.expectedTransport !== undefined) {
			assert.equal(envelope, vector.expectedTransport, vector.id);
		}
		assert.equal(hexOf(wireOf(envelope)), vector.wireHex, vector.id);
		assert.deepEqual(consumer.decrypt(envelope, vector.context), input, vector.id);
	}
});

test("TTL uses the frozen half-open expiry boundary", () => {
	for (const vector of vectors.freshness) {
		const source = envelopeVector(vector.sourceEnvelope);
		const fise = new Fise(profile);
		setFiseClockForTesting(fise, () => vector.clockMilliseconds);
		const restore = () => fise.decrypt(bytesOf(source.wireHex), source.context);
		if (vector.outcome === "restored") {
			assert.deepEqual(restore(), inputOf(source), vector.id);
		} else {
			assert.throws(
				restore,
				(error) => error instanceof FiseError && error.code === vector.errorCode,
				vector.id
			);
		}
	}
});

test("non-canonical Base64URL transports fail before wire parsing", () => {
	const fise = new Fise(profile);
	for (const vector of vectors.invalidTransports) {
		assert.throws(
			() => decodeBase64Url(vector.value, FISE_MAX_ENVELOPE_LENGTH),
			(error) => error instanceof FiseError && error.code === vector.errorCode,
			vector.id
		);
		assert.throws(
			() => fise.decrypt(vector.value),
			(error) => error instanceof FiseError && error.code === vector.errorCode,
			`${vector.id} public decrypt`
		);
	}
});

test("malformed headers, wire policy, markers, and lengths keep stable errors", () => {
	for (const vector of vectors.invalidEnvelopes) {
		const source = envelopeVector(vector.sourceEnvelope);
		const envelope = applyMutation(bytesOf(source.wireHex), vector.mutation);
		const fise = new Fise(profile);
		if (source.clockMilliseconds !== undefined) {
			setFiseClockForTesting(fise, () => source.clockMilliseconds);
		}
		assert.throws(
			() => fise.decrypt(envelope, vector.context ?? source.context),
			(error) => error instanceof FiseError && error.code === vector.errorCode,
			vector.id
		);
	}
});

test("valid profile envelopes with malformed logical payloads fail closed", () => {
	const fise = new Fise(profile);
	for (const vector of vectors.invalidPayloadEnvelopes) {
		const envelope = bytesOf(vector.wireHex);
		assert.equal(hexOf(openPayload(envelope, profile, [])), vector.payloadHex, vector.id);
		assert.throws(
			() => fise.decrypt(envelope),
			(error) => error instanceof FiseError && error.code === vector.errorCode,
			vector.id
		);
	}
});

test("golden binary envelopes preserve direct range and progressive semantics", async () => {
	for (const vector of vectors.envelopes.filter(vector => vector.kind === "binary")) {
		const fise = new Fise(profile);
		if (vector.clockMilliseconds !== undefined) {
			setFiseClockForTesting(fise, () => vector.clockMilliseconds);
		}
		const envelope = bytesOf(vector.wireHex);
		assert.equal(
			hexOf(fise.decryptRange(envelope, {
				start: vector.range.start,
				endExclusive: vector.range.endExclusive
			}, vector.context)),
			vector.range.expectedHex,
			vector.id
		);
		const chunks = [];
		for await (const chunk of fise.decryptProgressive(envelope, vector.context, {
			chunkSize: vector.progressive.chunkSize
		})) {
			chunks.push(hexOf(chunk));
		}
		assert.deepEqual(chunks, vector.progressive.expectedChunksHex, vector.id);
	}
});

test("the generated WASM backend produces the same conformance envelopes", async () => {
	for (const vector of vectors.envelopes.filter(vector => vector.clockMilliseconds === undefined)) {
		const javascript = new Fise(profile, vector.options ?? {});
		const wasm = await javascript.withWasm();
		const input = inputOf(vector);
		const javascriptEnvelope = javascript.encrypt(input, vector.context);
		const wasmEnvelope = wasm.encrypt(input, vector.context);
		assert.deepEqual(wasmEnvelope, javascriptEnvelope, vector.id);
		assert.deepEqual(javascript.decrypt(wasmEnvelope, vector.context), input, vector.id);
		assert.deepEqual(wasm.decrypt(javascriptEnvelope, vector.context), input, vector.id);
	}
});

test("invalid canonical inputs fail with their frozen error codes", () => {
	for (const vector of vectors.invalid) {
		const value = vector.kind === "ieee754"
			? numberFromIeee754Hex(vector.ieee754Hex)
			: JSON.parse(vector.inputJson);
		assert.throws(
			() => canonicalJson(value),
			(error) => error instanceof FiseError && error.code === vector.errorCode,
			vector.id
		);
	}
});

test("invalid positional contexts fail with their frozen error codes", () => {
	const fise = new Fise(profile);
	for (const vector of vectors.invalidContext) {
		const context = JSON.parse(vector.inputJson);
		assert.throws(
			() => fise.encrypt("context validation", context),
			(error) => error instanceof FiseError && error.code === vector.errorCode,
			vector.id
		);
	}
});

test("the profile-bound Fise class keeps the intentionally small runtime surface", async () => {
	assert.deepEqual(Object.getOwnPropertyNames(Fise.prototype).sort(), [
		"constructor",
		"decrypt",
		"decryptProgressive",
		"decryptRange",
		"encrypt",
		"parallel",
		"withWasm"
	]);
	assert.deepEqual(Object.keys(new Fise(profile)).sort(), [
		"profile",
		"strict",
		"ttlSeconds"
	]);

	const parallel = await new Fise(profile).parallel({
		workerCount: 1,
		minimumParallelBytes: 0
	});
	try {
		assert.deepEqual(Object.keys(parallel).sort(), [
			"close",
			"decrypt",
			"decryptProgressive",
			"decryptRange",
			"encrypt",
			"minimumParallelBytes",
			"profile",
			"strict",
			"ttlSeconds",
			"workerCount"
		]);
	} finally {
		await parallel.close();
	}
});

function inputOf(vector) {
	if (vector.inputFromPayload !== undefined) {
		const payload = vectors.payloads.find(candidate => candidate.id === vector.inputFromPayload);
		assert.ok(payload, `missing payload input ${vector.inputFromPayload}`);
		return inputOf(payload);
	}
	return vector.kind === "json"
		? JSON.parse(vector.inputJson)
		: bytesOf(vector.inputHex);
}

function envelopeVector(id) {
	const vector = vectors.envelopes.find(candidate => candidate.id === id);
	assert.ok(vector, `missing envelope ${id}`);
	return vector;
}

function applyMutation(source, mutation) {
	if (mutation === undefined) return source;
	if (mutation.type === "truncate") return source.slice(0, mutation.length);
	if (mutation.type === "truncate-tail") {
		return source.slice(0, source.length - mutation.bytes);
	}
	if (mutation.type === "append") {
		const suffix = bytesOf(mutation.hex);
		const output = new Uint8Array(source.length + suffix.length);
		output.set(source, 0);
		output.set(suffix, source.length);
		return output;
	}
	const output = source.slice();
	if (mutation.type === "replace") {
		output.set(bytesOf(mutation.hex), mutation.offset);
		return output;
	}
	if (mutation.type === "xor") {
		output[mutation.offset] ^= mutation.value;
		return output;
	}
	assert.fail(`unsupported mutation ${mutation.type}`);
}

function numberFromIeee754Hex(source) {
	const bytes = bytesOf(source);
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
		.getFloat64(0, false);
}

function bytesOf(source) {
	assert.match(source, /^(?:[0-9a-f]{2})*$/);
	const output = new Uint8Array(source.length / 2);
	for (let index = 0; index < output.length; index++) {
		output[index] = Number.parseInt(source.slice(index * 2, index * 2 + 2), 16);
	}
	return output;
}

function hexOf(bytes) {
	return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

function wireOf(envelope) {
	return typeof envelope === "string"
		? decodeBase64Url(envelope, FISE_MAX_ENVELOPE_LENGTH)
		: envelope;
}

import assert from "node:assert/strict";
import test from "node:test";

import { Fise, FiseError } from "fise";
import { decodeValue, encodeValue } from "../../dist/v2/codec.js";
import {
	compressLz4Block,
	decompressLz4Block
} from "../../dist/v2/lz4.js";
import profile from "./profile-a.generated.mjs";

test("adaptive structured compression preserves canonical values and reduces repetitive wire", () => {
	const value = {
		orders: Array.from({ length: 1_000 }, (_, index) => ({
			id: `order_${index}`,
			status: index % 2 === 0 ? "ready" : "pending",
			resource: "orders",
			items: [{ sku: "fise-shirt", quantity: index % 4 + 1 }]
		}))
	};
	const payload = encodeValue(value);
	assert.equal(payload[0], 1);
	assert.equal(payload[1], 3, "repetitive structured data should select LZ4 block encoding");
	assert.deepEqual(decodeValue(payload), value);

	const fise = new Fise(profile);
	const envelope = fise.encrypt(value, ["structured-compression"]);
	assert.equal(typeof envelope, "string");
	assert.ok(
		envelope.length < JSON.stringify(value).length,
		"adaptive compression should offset Base64URL expansion for repetitive JSON"
	);
	assert.deepEqual(fise.decrypt(envelope, ["structured-compression"]), value);
});

test("small structured values retain the ordinary canonical JSON payload", () => {
	const value = { ok: true, count: 3 };
	const payload = encodeValue(value);
	assert.equal(payload[0], 1);
	assert.equal(payload[1], 1);
	assert.deepEqual(decodeValue(payload), value);
});

test("LZ4 block codec handles boundaries, overlap matches, and deterministic input", () => {
	for (let length = 0; length <= 1_024; length++) {
		const input = Uint8Array.from(
			{ length },
			(_, index) => ((index * 29) ^ (index >>> 2) ^ length) & 0xff
		);
		const compressed = compressLz4Block(input);
		assert.deepEqual(decompressLz4Block(compressed, input.length), input);
		assert.deepEqual(compressLz4Block(input), compressed);
	}

	const repeated = new TextEncoder().encode("x".repeat(100_000));
	const compressed = compressLz4Block(repeated);
	assert.ok(compressed.length < repeated.length / 100);
	assert.deepEqual(decompressLz4Block(compressed, repeated.length), repeated);

	const interoperableBlock = Uint8Array.of(
		0x44,
		0x61, 0x62, 0x63, 0x64,
		0x04, 0x00,
		0x50,
		0x65, 0x66, 0x67, 0x68, 0x69
	);
	assert.equal(
		new TextDecoder().decode(decompressLz4Block(interoperableBlock, 17)),
		"abcdabcdabcdefghi"
	);
});

test("compressed structured decoding is bounded and converts malformed blocks to FiseError", () => {
	const malformedPayloads = [
		Uint8Array.of(1, 3),
		Uint8Array.of(1, 3, 0, 0, 0, 10, 0x10),
		Uint8Array.of(1, 3, 0, 0, 0, 4, 0x00, 0x00, 0x00),
		Uint8Array.of(1, 3, 0, 0, 4, 1, 0x00),
		Uint8Array.of(1, 3, 0x20, 0x00, 0x00, 0x01, 0x00)
	];
	for (const payload of malformedPayloads) {
		assert.throws(
			() => decodeValue(payload),
			(error) => error instanceof FiseError && error.code === "INVALID_PAYLOAD"
		);
	}

	let state = 0x1234_5678;
	for (let attempt = 0; attempt < 2_000; attempt++) {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		const length = state & 63;
		const input = new Uint8Array(length);
		for (let index = 0; index < input.length; index++) {
			state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
			input[index] = state >>> 24;
		}
		try {
			const output = decompressLz4Block(input, state & 127);
			assert.equal(output.length, state & 127);
		} catch (error) {
			assert.ok(error instanceof FiseError);
			assert.equal(error.code, "INVALID_PAYLOAD");
		}
	}
});

test("compressed structured data still requires fatal UTF-8 and canonical JSON", () => {
	const encoder = new TextEncoder();
	for (const content of [
		encoder.encode('{"z":1,"a":2}'),
		Uint8Array.of(0xc3, 0x28)
	]) {
		const block = compressLz4Block(content);
		const payload = new Uint8Array(6 + block.length);
		payload.set([1, 3], 0);
		new DataView(payload.buffer).setUint32(2, content.length, false);
		payload.set(block, 6);
		assert.throws(
			() => decodeValue(payload),
			(error) => error instanceof FiseError && error.code === "INVALID_PAYLOAD"
		);
	}
});

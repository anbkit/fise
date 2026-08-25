import assert from "node:assert/strict";
import test from "node:test";

import {
	createBinaryConformanceEnvelope,
	createFramedBinaryConformanceEnvelope,
	createStringConformanceEnvelope
} from "fise/conformance";
import {
	createWasmXorBinaryCipher,
	defaultBinaryProfile,
	defaultStringProfile,
	fiseBinaryDecrypt,
	fiseFramedBinaryDecrypt,
	fiseDecrypt,
	withBinaryBackend
} from "fise";

const STRING_VECTOR =
	"FISE010113000a0000001cfise.default.string0aAHgAVABeAF8AWwAVAHAAfgBrAHw=0123456789";
const BINARY_VECTOR_HEX =
	"46495345010113000a00000006666973652e64656661756c742e62696e617279000a00000000fafa00010203040506070809";
const FRAMED_BINARY_VECTOR_HEX =
	"464953460100001300000004000000060000000200080000666973652e64656661756c742e62696e6172790000003b000000300000006b0000002e46495345010113000a00000004666973652e64656661756c742e62696e617279000a000000000001020304050607080946495345010113000a00000002666973652e64656661756c742e62696e617279000af4f40a0b0c0d0e0f10111213";

test("FISE 1.1 string conformance vector is stable", () => {
	const envelope = createStringConformanceEnvelope(
		"Hello FISE",
		"0123456789",
		defaultStringProfile,
		{ timestamp: 0 }
	);
	assert.equal(envelope, STRING_VECTOR);
	assert.equal(fiseDecrypt(envelope, defaultStringProfile, { timestamp: 0 }), "Hello FISE");
});

test("FISE 1.1 binary conformance vector is stable", () => {
	const input = Uint8Array.from([0, 1, 2, 3, 254, 255]);
	const salt = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
	const envelope = createBinaryConformanceEnvelope(
		input,
		salt,
		defaultBinaryProfile,
		{ timestamp: 0 }
	);
	assert.equal(toHex(envelope), BINARY_VECTOR_HEX);
	assert.deepEqual(
		fiseBinaryDecrypt(envelope, defaultBinaryProfile, { timestamp: 0 }),
		input
	);
});

test("WASM produces the same FISE 1.1 binary conformance vector", async () => {
	const wasmCipher = await createWasmXorBinaryCipher();
	const wasmProfile = withBinaryBackend(defaultBinaryProfile, wasmCipher);
	const envelope = createBinaryConformanceEnvelope(
		Uint8Array.from([0, 1, 2, 3, 254, 255]),
		Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
		wasmProfile,
		{ timestamp: 0 }
	);
	assert.equal(toHex(envelope), BINARY_VECTOR_HEX);
});

test("FISE framed binary conformance vector is stable", async () => {
	const input = Uint8Array.from([0, 1, 2, 3, 254, 255]);
	const envelope = createFramedBinaryConformanceEnvelope(
		input,
		[
			Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
			Uint8Array.from([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
		],
		defaultBinaryProfile,
		{ frameSize: 4, timestamp: 0 }
	);
	assert.equal(toHex(envelope), FRAMED_BINARY_VECTOR_HEX);
	assert.deepEqual(
		await fiseFramedBinaryDecrypt(envelope, defaultBinaryProfile, {
			timestamp: 0
		}),
		input
	);
});

test("conformance helpers reject salts outside the selected profile", () => {
	assert.throws(
		() => createStringConformanceEnvelope("x", "short", defaultStringProfile),
		{ code: "INVALID_SALT" }
	);
	assert.throws(
		() => createBinaryConformanceEnvelope(
			new Uint8Array([1]),
			new Uint8Array(5),
			defaultBinaryProfile
		),
		{ code: "INVALID_SALT" }
	);
});

function toHex(bytes) {
	return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

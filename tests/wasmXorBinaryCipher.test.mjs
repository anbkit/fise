import assert from "node:assert/strict";
import test from "node:test";

import {
	createWasmXorBinaryCipher,
	defaultBinaryProfile,
	fiseBinaryDecrypt,
	fiseBinaryEncrypt,
	isWasmXorBinaryCipherSupported,
	withBinaryBackend,
	xorBinaryCipher
} from "../dist/index.js";

function deterministicBytes(length, factor = 31) {
	return Uint8Array.from({ length }, (_, index) => (index * factor + 17) & 0xff);
}

test("WASM XOR support is available in Node", () => {
	assert.equal(isWasmXorBinaryCipherSupported(), true);
});

test("WASM XOR matches the JavaScript cipher across memory boundaries", async () => {
	const wasmCipher = await createWasmXorBinaryCipher();
	const salt = deterministicBytes(67, 13);

	for (const length of [0, 1, 1_024, 65_537, 1_048_576]) {
		const input = deterministicBytes(length);
		const inputBefore = input.slice();
		const saltBefore = salt.slice();
		const expected = xorBinaryCipher.encrypt(input, salt);
		const actual = wasmCipher.encrypt(input, salt);

		assert.deepEqual(actual, expected, `WASM mismatch at ${length} bytes`);
		assert.deepEqual(wasmCipher.decrypt(actual, salt), input);
		assert.deepEqual(input, inputBefore, `WASM mutated input at ${length} bytes`);
		assert.deepEqual(salt, saltBefore, `WASM mutated salt at ${length} bytes`);

		const ownedOutput = actual.slice();
		wasmCipher.encrypt(new Uint8Array([9, 8, 7]), salt);
		assert.deepEqual(actual, ownedOutput, `WASM output aliased memory at ${length} bytes`);
	}
});

test("WASM and JavaScript binary envelopes interoperate", async () => {
	const wasmCipher = await createWasmXorBinaryCipher();
	const input = deterministicBytes(256 * 1024, 19);
	const wasmProfile = withBinaryBackend(defaultBinaryProfile, wasmCipher);

	const jsEnvelope = fiseBinaryEncrypt(input, defaultBinaryProfile);
	assert.deepEqual(
		fiseBinaryDecrypt(jsEnvelope, wasmProfile),
		input
	);

	const wasmEnvelope = fiseBinaryEncrypt(input, wasmProfile);
	assert.deepEqual(
		fiseBinaryDecrypt(wasmEnvelope, defaultBinaryProfile),
		input
	);
});

test("each factory call returns an isolated cipher instance", async () => {
	const [first, second] = await Promise.all([
		createWasmXorBinaryCipher(),
		createWasmXorBinaryCipher()
	]);
	const input = deterministicBytes(128 * 1024);
	const salt = deterministicBytes(32, 7);

	assert.deepEqual(first.encrypt(input, salt), second.encrypt(input, salt));
});

test("WASM memory growth is capped per cipher instance", async () => {
	const cipher = await createWasmXorBinaryCipher({ maxMemoryPages: 1 });
	const salt = deterministicBytes(31, 7);
	const withinOnePage = deterministicBytes((64 * 1024) - salt.length);
	assert.deepEqual(
		cipher.decrypt(cipher.encrypt(withinOnePage, salt), salt),
		withinOnePage
	);
	assert.throws(
		() => cipher.encrypt(new Uint8Array(64 * 1024), new Uint8Array([1])),
		{ code: "WASM_MEMORY_LIMIT" }
	);
});

test("WASM factory validates its memory options", async () => {
	for (const options of [
		null,
		{ maxMemoryPages: null },
		{ maxMemoryPages: 0 },
		{ maxMemoryPages: 1.5 },
		{ maxMemoryPages: "2" },
		{ maxMemoryPages: 65_537 },
		{ maximumMemoryPages: 2 }
	]) {
		await assert.rejects(
			createWasmXorBinaryCipher(options),
			{ code: "INVALID_INPUT" }
		);
	}
});

test("WASM options ignore inherited prototype pollution", async () => {
	Object.prototype.maxMemoryPages = 1;
	try {
		const cipher = await createWasmXorBinaryCipher({});
		const salt = new Uint8Array([1]);
		const input = new Uint8Array(64 * 1024);
		assert.equal(cipher.encrypt(input, salt).length, input.length);
	} finally {
		delete Object.prototype.maxMemoryPages;
	}
});

test("WASM instantiate failures are normalized to typed FISE errors", async () => {
	// Populate the shared compiled-module cache so this test isolates instantiate.
	await createWasmXorBinaryCipher();
	const originalInstantiate = WebAssembly.instantiate;
	try {
		WebAssembly.instantiate = () => {
			throw new RangeError("runtime rejected instance");
		};
		await assert.rejects(
			createWasmXorBinaryCipher(),
			error => (
				error?.code === "WASM_COMPILE_FAILED" &&
				error.cause instanceof RangeError
			)
		);

		WebAssembly.instantiate = () => Promise.reject(new Error("async rejection"));
		await assert.rejects(
			createWasmXorBinaryCipher(),
			error => (
				error?.code === "WASM_COMPILE_FAILED" &&
				error.cause?.message === "async rejection"
			)
		);
	} finally {
		WebAssembly.instantiate = originalInstantiate;
	}
});

test("binary XOR ciphers reject an empty salt for non-empty input", async () => {
	const wasmCipher = await createWasmXorBinaryCipher();
	const input = new Uint8Array([1]);
	const emptySalt = new Uint8Array();

	assert.throws(
		() => xorBinaryCipher.encrypt(input, emptySalt),
		/FISE: binary XOR salt must not be empty/
	);
	assert.throws(
		() => wasmCipher.encrypt(input, emptySalt),
		/FISE: binary XOR salt must not be empty/
	);
});

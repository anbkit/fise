import assert from "node:assert/strict";

import {
	FiseError,
	createWasmXorBinaryCipher,
	defaultBinaryProfile,
	fiseBinaryDecrypt,
	fiseBinaryEncrypt,
	isWasmXorBinaryCipherSupported,
	withBinaryBackend
} from "fise";

const allowJavascriptFallback = true;
const fallbackCodes = new Set([
	"WASM_UNAVAILABLE",
	"WASM_COMPILE_FAILED",
	"WASM_MEMORY_LIMIT"
]);
const selected = await selectBinaryProfile({ allowJavascriptFallback });
const input = Uint8Array.from({ length: 4_096 }, (_, index) => index & 0xff);

// A conforming backend preserves the logical transform and wire profile, so
// envelopes remain decodable across the JavaScript and WASM implementations.
const javascriptEnvelope = fiseBinaryEncrypt(input, defaultBinaryProfile);
assert.deepEqual(
	fiseBinaryDecrypt(javascriptEnvelope, selected.profile),
	input
);
const selectedEnvelope = fiseBinaryEncrypt(input, selected.profile);
assert.deepEqual(
	fiseBinaryDecrypt(selectedEnvelope, defaultBinaryProfile),
	input
);

console.log(`PASS wasm-backend: selected ${selected.backend} explicitly`);

async function selectBinaryProfile({ allowJavascriptFallback }) {
	if (!isWasmXorBinaryCipherSupported()) {
		if (!allowJavascriptFallback) {
			throw new Error("This deployment requires WebAssembly");
		}
		console.warn(
			"WASM APIs unavailable; explicitly selecting the JavaScript backend."
		);
		return { backend: "javascript", profile: defaultBinaryProfile };
	}

	try {
		const backend = await createWasmXorBinaryCipher({ maxMemoryPages: 32 });
		return {
			backend: "wasm",
			profile: withBinaryBackend(defaultBinaryProfile, backend)
		};
	} catch (error) {
		if (
			!allowJavascriptFallback ||
			!(error instanceof FiseError) ||
			!fallbackCodes.has(error.code)
		) {
			throw error;
		}
		console.warn(
			`WASM failed with ${error.code}; explicitly selecting JavaScript.`
		);
		return { backend: "javascript", profile: defaultBinaryProfile };
	}
}

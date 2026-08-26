import assert from "node:assert/strict";

import {
	Fise,
	isParallelSupported,
	isWasmSupported
} from "fise";
import profile from "./fise.profile.mjs";

const javascript = new Fise(profile);
const input = Uint8Array.from({ length: 300_000 }, (_, index) => (index * 29 + 5) & 0xff);
const context = [
	"session_compute_01",
	"user_42",
	"connection_12",
	"binary-job:v1",
	8
];
const javascriptEnvelope = javascript.encrypt(input, context);

if (isWasmSupported()) {
	const wasm = await javascript.withWasm();
	assert.deepEqual(wasm.decrypt(javascriptEnvelope, context), input);
	assert.deepEqual(javascript.decrypt(wasm.encrypt(input, context), context), input);
}

if (isParallelSupported()) {
	const parallel = await javascript.parallel({ workerCount: 2, minimumParallelBytes: 0 });
	try {
		assert.deepEqual(await parallel.decrypt(javascriptEnvelope, context), input);
		assert.deepEqual(
			javascript.decrypt(await parallel.encrypt(input, context), context),
			input
		);
		const framed = await parallel.encryptFramed(input, context, { frameSize: 64 * 1024 });
		assert.deepEqual(await parallel.decryptFramed(framed, context), input);
	} finally {
		await parallel.close();
	}
}

console.log("PASS backends: generated JS/WASM/worker kernels preserve one wire contract");

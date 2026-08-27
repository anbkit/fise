import assert from "node:assert/strict";

import {
	Fise,
	isParallelSupported,
	isWasmSupported
} from "fise";
import profile from "./fise.profile.mjs";

const javascript = new Fise(profile);
const edgeJavascript = new Fise(profile, {
	binary: { mode: "edges", edgeBytes: 16 * 1024 }
});
const input = Uint8Array.from({ length: 300_000 }, (_, index) => (index * 29 + 5) & 0xff);
const context = [
	"session_compute_01",
	"user_42",
	"connection_12",
	"binary-job:v1",
	8
];
const javascriptEnvelope = javascript.encrypt(input, context);
const edgeEnvelope = edgeJavascript.encrypt(input, context);

if (isWasmSupported()) {
	const wasm = await javascript.withWasm();
	const edgeWasm = await edgeJavascript.withWasm();
	assert.deepEqual(wasm.decrypt(javascriptEnvelope, context), input);
	assert.deepEqual(wasm.decrypt(edgeEnvelope, context), input);
	assert.deepEqual(javascript.decrypt(wasm.encrypt(input, context), context), input);
	assert.deepEqual(javascript.decrypt(edgeWasm.encrypt(input, context), context), input);
}

if (isParallelSupported()) {
	const parallel = await javascript.parallel({ workerCount: 2, minimumParallelBytes: 0 });
	const edgeParallel = await edgeJavascript.parallel({ workerCount: 2, minimumParallelBytes: 0 });
	try {
		assert.deepEqual(await parallel.decrypt(javascriptEnvelope, context), input);
		assert.deepEqual(await parallel.decrypt(edgeEnvelope, context), input);
		assert.deepEqual(
			javascript.decrypt(await parallel.encrypt(input, context), context),
			input
		);
		assert.deepEqual(
			javascript.decrypt(await edgeParallel.encrypt(input, context), context),
			input
		);
		assert.deepEqual(
			await parallel.decryptRange(
				javascriptEnvelope,
				{ start: 50_000, endExclusive: 200_000 },
				context
			),
			input.slice(50_000, 200_000)
		);
	} finally {
		await parallel.close();
		await edgeParallel.close();
	}
}

console.log("PASS backends: generated JS/WASM/worker kernels preserve one wire contract");

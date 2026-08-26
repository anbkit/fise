import assert from "node:assert/strict";
import test from "node:test";

import {
	Fise,
	FiseError,
	isParallelSupported,
	isWasmSupported
} from "fise";
import profile from "./profile-a.generated.mjs";
import { adapterFor } from "../../dist/v2/parallel.js";

const context = [17, "backend parity"];

test("generated WASM and specialized JavaScript interoperate", async (t) => {
	if (!isWasmSupported()) return t.skip("WebAssembly unavailable");
	const javascript = new Fise(profile);
	const wasm = await javascript.withWasm();
	for (const length of [0, 1, 2, 255, 256, 4_097, 70_000]) {
		const input = bytes(length);
		assert.deepEqual(wasm.decrypt(javascript.encrypt(input, context), context), input);
		assert.deepEqual(javascript.decrypt(wasm.encrypt(input, context), context), input);
	}
	const framed = wasm.encryptFramed(bytes(1_003), context, { frameSize: 256 });
	assert.deepEqual(javascript.decryptFramed(framed, context), bytes(1_003));
});

test("parallel workers preserve absolute positions and interoperate with JS", async (t) => {
	if (!isParallelSupported()) return t.skip("dedicated workers unavailable");
	const javascript = new Fise(profile);
	const parallel = await javascript.parallel({ workerCount: 2, minimumParallelBytes: 0 });
	const emptyContainer = javascript.encryptFramed(new Uint8Array());
	try {
		for (const length of [1, 2, 255, 256, 4_097, 70_000]) {
			const input = bytes(length);
			assert.deepEqual(
				await parallel.decrypt(javascript.encrypt(input, context), context),
				input
			);
			assert.deepEqual(
				javascript.decrypt(await parallel.encrypt(input, context), context),
				input
			);
		}

		const input = bytes(1_003);
		const framed = await parallel.encryptFramed(input, context, { frameSize: 128 });
		assert.deepEqual(await parallel.decryptFramed(framed, context), input);
		assert.deepEqual(
			await parallel.decryptRange(
				framed,
				{ start: 111, endExclusive: 777 },
				context
			),
			input.slice(111, 777)
		);
		assert.throws(
			() => javascript.decryptRange(framed, { start: 0, endExclusive: 0 }, {}),
			(error) => error instanceof FiseError && error.code === "INVALID_CONTEXT"
		);
		await assert.rejects(
			parallel.decryptRange(framed, { start: 0, endExclusive: 0 }, {}),
			(error) => error instanceof FiseError && error.code === "INVALID_CONTEXT"
		);
	} finally {
		await parallel.close();
	}
	await assert.rejects(
		parallel.encrypt(new Uint8Array([1])),
		(error) => error instanceof FiseError && error.code === "PARALLEL_UNAVAILABLE"
	);
	for (const operation of [
		() => parallel.encryptFramed(new Uint8Array()),
		() => parallel.decryptFramed(emptyContainer),
		() => parallel.decryptRange(emptyContainer, { start: 0, endExclusive: 0 })
	]) {
		await assert.rejects(
			operation(),
			(error) => error instanceof FiseError && error.code === "PARALLEL_UNAVAILABLE"
		);
	}
	assert.throws(
		() => parallel.decryptProgressive(emptyContainer),
		(error) => error instanceof FiseError && error.code === "PARALLEL_UNAVAILABLE"
	);
});

test("worker adapters fail closed after a fatal lifecycle event", async () => {
	let receive;
	let fail;
	let terminateCalls = 0;
	const posted = [];
	const adapter = adapterFor(
		message => posted.push(message),
		listener => {
			receive = listener;
		},
		listener => {
			fail = listener;
		},
		async () => {
			terminateCalls++;
		}
	);

	const initialized = adapter.initialize(Uint8Array.of(0, 97, 115, 109));
	assert.equal(posted[0].type, "init");
	receive({ type: "ready" });
	await initialized;

	const pending = adapter.run(workerRequest());
	await Promise.resolve();
	assert.equal(posted[1].type, "run");
	fail(new Error("worker exited unexpectedly"));

	await assert.rejects(
		pending,
		(error) => error instanceof FiseError && error.code === "PARALLEL_WORKER_FAILED"
	);
	await assert.rejects(
		adapter.run(workerRequest()),
		(error) => error instanceof FiseError && error.code === "PARALLEL_WORKER_FAILED"
	);

	await adapter.close();
	assert.equal(terminateCalls, 1);
});

test("worker adapters fail closed when request dispatch throws", async () => {
	let receive;
	const dispatchFailure = new Error("postMessage failed");
	const adapter = adapterFor(
		message => {
			if (message.type === "run") throw dispatchFailure;
		},
		listener => {
			receive = listener;
		},
		() => {},
		async () => {}
	);

	const initialized = adapter.initialize(Uint8Array.of(0, 97, 115, 109));
	receive({ type: "ready" });
	await initialized;

	for (let attempt = 0; attempt < 2; attempt++) {
		await assert.rejects(
			adapter.run(workerRequest()),
			(error) =>
				error instanceof FiseError &&
				error.code === "PARALLEL_WORKER_FAILED" &&
				error.cause === dispatchFailure
		);
	}
	await adapter.close();
});

function bytes(length) {
	return Uint8Array.from({ length }, (_, index) => (index * 37 + 13) & 0xff);
}

function workerRequest() {
	return {
		type: "run",
		operation: "forward",
		input: Uint8Array.of(1, 2, 3).buffer,
		contextSegment: Uint8Array.of(4, 5, 6).buffer,
		contextState: [0, 1, 2, 3],
		absoluteOffset: 0
	};
}

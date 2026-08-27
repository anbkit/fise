import assert from "node:assert/strict";
import test from "node:test";

import {
	Fise,
	FiseError,
	Profile,
	isParallelSupported,
	isWasmSupported
} from "fise";
import profile from "./profile-a.generated.mjs";
import { setFiseClockForTesting } from "../../dist/v2/fise.js";
import { adapterFor } from "../../dist/v2/parallel.js";
import { withClearedWasmMemory } from "../../dist/v2/wasmMemory.js";

const context = [17, "backend parity"];

test("generated WASM and specialized JavaScript interoperate", async (t) => {
	if (!isWasmSupported()) return t.skip("WebAssembly unavailable");
	const javascript = new Fise(profile);
	const wasm = await javascript.withWasm();
	const edgeJavascript = new Fise(profile, {
		binary: { mode: "edges", edgeBytes: 2_048 }
	});
	const edgeWasm = await edgeJavascript.withWasm();
	for (const length of [0, 1, 2, 255, 256, 4_097, 70_000]) {
		const input = bytes(length);
		assert.deepEqual(wasm.decrypt(javascript.encrypt(input, context), context), input);
		assert.deepEqual(javascript.decrypt(wasm.encrypt(input, context), context), input);
	}
	const input = bytes(1_003);
	const envelope = wasm.encrypt(input, context);
	assert.deepEqual(
		javascript.decryptRange(envelope, { start: 111, endExclusive: 777 }, context),
		input.slice(111, 777)
	);
	const progressive = [];
	for await (const chunk of wasm.decryptProgressive(envelope, context, { chunkSize: 256 })) {
		progressive.push(chunk);
	}
	assert.deepEqual(join(progressive), input);

	const edgeInput = bytes(20_003);
	const edgeEnvelope = edgeWasm.encrypt(edgeInput, context);
	assert.deepEqual(javascript.decrypt(edgeEnvelope, context), edgeInput);
	assert.deepEqual(
		wasm.decryptRange(edgeEnvelope, { start: 1_900, endExclusive: 18_100 }, context),
		edgeInput.slice(1_900, 18_100)
	);
});

test("WASM preserves opt-in raw fallback", async (t) => {
	if (!isWasmSupported()) return t.skip("WebAssembly unavailable");
	const javascript = new Fise(profile, { strict: false });
	const wasm = await javascript.withWasm();
	const raw = new Date("2026-08-27T00:00:00.000Z");
	const envelope = new Fise(profile).encrypt("bound", context);

	assert.equal(wasm.strict, false);
	assert.strictEqual(wasm.encrypt(raw), raw);
	assert.strictEqual(wasm.decrypt(raw), raw);
	assert.strictEqual(wasm.decrypt(envelope, [18, "backend parity"]), envelope);
	assert.equal(wasm.decrypt(wasm.encrypt("works", context), context), "works");
});

test("WASM inherits constructor TTL and enforces wire expiry", async (t) => {
	if (!isWasmSupported()) return t.skip("WebAssembly unavailable");
	let nowMilliseconds = 1_000_000;
	const javascript = new Fise(profile, { ttlSeconds: 2 });
	setFiseClockForTesting(javascript, () => nowMilliseconds);
	const wasm = await javascript.withWasm();
	assert.equal(wasm.ttlSeconds, 2);

	const javascriptEnvelope = javascript.encrypt("javascript TTL", context);
	const wasmEnvelope = wasm.encrypt("WASM TTL", context);
	assert.equal(wasm.decrypt(javascriptEnvelope, context), "javascript TTL");
	assert.equal(javascript.decrypt(wasmEnvelope, context), "WASM TTL");

	nowMilliseconds = 1_002_000;
	for (const operation of [
		() => wasm.decrypt(javascriptEnvelope, context),
		() => javascript.decrypt(wasmEnvelope, context)
	]) {
		assert.throws(
			operation,
			(error) => error instanceof FiseError && error.code === "ENVELOPE_EXPIRED"
		);
	}
});

test("WASM traps are profile failures and used memory is cleared on failure", async (t) => {
	if (!isWasmSupported()) return t.skip("WebAssembly unavailable");
	const trappingProfile = Profile.generated(
		"abcdef0123456789abcdef0123456789",
		0,
		12,
		() => [0, 0, 0, 0],
		() => 0,
		() => 0,
		input => input.slice(),
		input => input.slice(),
		trappingWasmModule()
	);
	const wasm = await new Fise(trappingProfile).withWasm();
	assert.throws(
		() => wasm.encrypt("trap"),
		(error) => error instanceof FiseError && error.code === "INVALID_PROFILE"
	);

	const memory = new WebAssembly.Memory({ initial: 1 });
	const failure = new Error("kernel failed after writes");
	assert.throws(
		() => withClearedWasmMemory(memory, 7, bytes => {
			bytes.set([1, 2, 3, 4, 5, 6, 7]);
			throw failure;
		}),
		(error) => error === failure
	);
	assert.deepEqual(new Uint8Array(memory.buffer, 0, 7), new Uint8Array(7));
});

test("parallel workers preserve absolute positions and interoperate with JS", async (t) => {
	if (!isParallelSupported()) return t.skip("dedicated workers unavailable");
	const javascript = new Fise(profile);
	const parallel = await javascript.parallel({ workerCount: 2, minimumParallelBytes: 0 });
	const edgeJavascript = new Fise(profile, {
		binary: { mode: "edges", edgeBytes: 2_048 }
	});
	const edgeParallel = await edgeJavascript.parallel({ workerCount: 2, minimumParallelBytes: 0 });
	const emptyEnvelope = javascript.encrypt(new Uint8Array());
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
		const envelope = await parallel.encrypt(input, context);
		assert.deepEqual(await parallel.decrypt(envelope, context), input);
		assert.deepEqual(
			await parallel.decryptRange(
				envelope,
				{ start: 111, endExclusive: 777 },
				context
			),
			input.slice(111, 777)
		);
		const progressive = [];
		for await (const chunk of parallel.decryptProgressive(envelope, context, {
			chunkSize: 128
		})) progressive.push(chunk);
		assert.deepEqual(join(progressive), input);
		const noContextEnvelope = await parallel.encrypt(input);
		const noContextProgressive = [];
		for await (const chunk of parallel.decryptProgressive(noContextEnvelope, {
			chunkSize: 257
		})) noContextProgressive.push(chunk);
		assert.deepEqual(join(noContextProgressive), input);

		const edgeInput = bytes(20_003);
		const edgeEnvelope = await edgeParallel.encrypt(edgeInput, context);
		assert.deepEqual(javascript.decrypt(edgeEnvelope, context), edgeInput);
		assert.deepEqual(
			await parallel.decryptRange(
				edgeEnvelope,
				{ start: 1_900, endExclusive: 18_100 },
				context
			),
			edgeInput.slice(1_900, 18_100)
		);
		assert.throws(
			() => javascript.decryptRange(envelope, { start: 0, endExclusive: 0 }, {}),
			(error) => error instanceof FiseError && error.code === "INVALID_CONTEXT"
		);
		await assert.rejects(
			parallel.decryptRange(envelope, { start: 0, endExclusive: 0 }, {}),
			(error) => error instanceof FiseError && error.code === "INVALID_CONTEXT"
		);
	} finally {
		await parallel.close();
		await edgeParallel.close();
	}
	await assert.rejects(
		parallel.encrypt(new Uint8Array([1])),
		(error) => error instanceof FiseError && error.code === "PARALLEL_UNAVAILABLE"
	);
	await assert.rejects(
		parallel.decryptRange(emptyEnvelope, { start: 0, endExclusive: 0 }),
		(error) => error instanceof FiseError && error.code === "PARALLEL_UNAVAILABLE"
	);
	assert.throws(
		() => parallel.decryptProgressive(emptyEnvelope),
		(error) => error instanceof FiseError && error.code === "PARALLEL_UNAVAILABLE"
	);
});

test("parallel workers preserve opt-in raw fallback and closed-runtime rejection", async (t) => {
	if (!isParallelSupported()) return t.skip("dedicated workers unavailable");
	const fallback = new Fise(profile, { strict: false });
	const parallel = await fallback.parallel({ workerCount: 2, minimumParallelBytes: 0 });
	const raw = new Date("2026-08-27T00:00:00.000Z");
	const envelope = new Fise(profile).encrypt("bound", context);
	try {
		assert.equal(parallel.strict, false);
		assert.strictEqual(await parallel.encrypt(raw), raw);
		assert.strictEqual(await parallel.decrypt(raw), raw);
		assert.strictEqual(
			await parallel.decrypt(envelope, [18, "backend parity"]),
			envelope
		);
		assert.equal(
			await parallel.decrypt(await parallel.encrypt("works", context), context),
			"works"
		);
	} finally {
		await parallel.close();
	}
	await assert.rejects(
		parallel.encrypt(raw),
		(error) => error instanceof FiseError && error.code === "PARALLEL_UNAVAILABLE"
	);
});

test("parallel workers inherit TTL for ordinary range and progressive operations", async (t) => {
	if (!isParallelSupported()) return t.skip("dedicated workers unavailable");
	let nowMilliseconds = 2_000_000;
	const javascript = new Fise(profile, { ttlSeconds: 2 });
	setFiseClockForTesting(javascript, () => nowMilliseconds);
	const parallel = await javascript.parallel({ workerCount: 2, minimumParallelBytes: 0 });
	assert.equal(parallel.ttlSeconds, 2);
	try {
		const ordinary = await parallel.encrypt("worker TTL", context);
		assert.equal(javascript.decrypt(ordinary, context), "worker TTL");

		const input = bytes(1_003);
		const envelope = await parallel.encrypt(input, context);
		assert.deepEqual(await parallel.decrypt(envelope, context), input);
		const progressive = parallel.decryptProgressive(envelope, context, { chunkSize: 128 });

		nowMilliseconds = 2_002_000;
		const restored = [];
		for await (const chunk of progressive) restored.push(chunk);
		assert.deepEqual(join(restored), input);
		await assert.rejects(
			parallel.decrypt(ordinary, context),
			(error) => error instanceof FiseError && error.code === "ENVELOPE_EXPIRED"
		);
		await assert.rejects(
			parallel.decryptRange(envelope, { start: 0, endExclusive: 1 }, context),
			(error) => error instanceof FiseError && error.code === "ENVELOPE_EXPIRED"
		);
		assert.throws(
			() => parallel.decryptProgressive(envelope, context),
			(error) => error instanceof FiseError && error.code === "ENVELOPE_EXPIRED"
		);
	} finally {
		await parallel.close();
	}
});

test("parallel options convert hostile reflection failures to INVALID_INPUT", async (t) => {
	if (!isParallelSupported()) return t.skip("dedicated workers unavailable");
	const failure = new Error("parallel ownKeys trap");
	await assert.rejects(
		new Fise(profile).parallel(new Proxy({}, { ownKeys: () => { throw failure; } })),
		(error) =>
			error instanceof FiseError &&
			error.code === "INVALID_INPUT" &&
			error.cause === failure
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

function join(frames) {
	const output = new Uint8Array(frames.reduce((length, frame) => length + frame.length, 0));
	let offset = 0;
	for (const frame of frames) {
		output.set(frame, offset);
		offset += frame.length;
	}
	return output;
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

function trappingWasmModule() {
	return Uint8Array.of(
		0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
		0x01, 0x0d, 0x01, 0x60, 0x09,
		0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f,
		0x00,
		0x03, 0x03, 0x02, 0x00, 0x00,
		0x05, 0x03, 0x01, 0x00, 0x01,
		0x07, 0x1e, 0x03,
		0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
		0x07, 0x66, 0x6f, 0x72, 0x77, 0x61, 0x72, 0x64, 0x00, 0x00,
		0x07, 0x72, 0x65, 0x76, 0x65, 0x72, 0x73, 0x65, 0x00, 0x01,
		0x0a, 0x09, 0x02,
		0x03, 0x00, 0x00, 0x0b,
		0x03, 0x00, 0x00, 0x0b
	);
}

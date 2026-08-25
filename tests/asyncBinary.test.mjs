import assert from "node:assert/strict";
import test from "node:test";

import {
	createParallelXorBinaryCipher,
	defaultBinaryProfile,
	fiseBinaryDecrypt,
	fiseBinaryDecryptAsync,
	fiseBinaryEncrypt,
	fiseBinaryEncryptAsync,
	isParallelXorBinaryCipherSupported,
	xorBinaryCipher
} from "fise";

const makeBytes = length => Uint8Array.from(
	{ length },
	(_, index) => (index * 37 + 11) & 0xff
);

test("parallel XOR backend preserves absolute salt position across worker chunks", async () => {
	assert.equal(isParallelXorBinaryCipherSupported(), true);
	const backend = await createParallelXorBinaryCipher({
		workerCount: 3,
		minimumParallelBytes: 0
	});
	try {
		const salt = Uint8Array.from({ length: 67 }, (_, index) => index + 1);
		for (const length of [1, 2, 66, 67, 68, 257, 256 * 1024 + 13]) {
			const input = makeBytes(length);
			const expected = xorBinaryCipher.encrypt(input, salt);
			assert.deepEqual(await backend.encrypt(input, salt), expected);
			assert.deepEqual(await backend.decrypt(expected, salt), input);
		}
		const mutableInput = makeBytes(300_000);
		const mutableSalt = salt.slice();
		const expectedOwnedResult = xorBinaryCipher.encrypt(mutableInput, mutableSalt);
		const ownedResultPromise = backend.encrypt(mutableInput, mutableSalt);
		mutableInput.fill(0);
		mutableSalt.fill(0);
		assert.deepEqual(await ownedResultPromise, expectedOwnedResult);
		assert.equal(backend.workerCount, 3);
		assert.equal(backend.minimumParallelBytes, 0);
	} finally {
		await backend.close();
	}
});

test("async worker envelopes remain ordinary FISE 1.1 wire across backends", async () => {
	const backend = await createParallelXorBinaryCipher({
		workerCount: 2,
		minimumParallelBytes: 0
	});
	try {
		const input = makeBytes(300_001);
		const original = input.slice();
		const workerEnvelopePromise = fiseBinaryEncryptAsync(
			input,
			defaultBinaryProfile,
			{ backend }
		);
		input.fill(0);
		const workerEnvelope = await workerEnvelopePromise;
		assert.deepEqual(Array.from(workerEnvelope.subarray(0, 6)), [70, 73, 83, 69, 1, 1]);
		assert.deepEqual(fiseBinaryDecrypt(workerEnvelope, defaultBinaryProfile), original);

		const syncEnvelope = fiseBinaryEncrypt(original, defaultBinaryProfile);
		assert.deepEqual(
			await fiseBinaryDecryptAsync(syncEnvelope, defaultBinaryProfile, { backend }),
			original
		);
	} finally {
		await backend.close();
	}
});

test("parallel backend has an explicit local threshold and close lifecycle", async () => {
	const backend = await createParallelXorBinaryCipher({
		workerCount: 1,
		minimumParallelBytes: 10_000
	});
	const input = makeBytes(32);
	const salt = Uint8Array.from([1, 2, 3]);
	assert.deepEqual(await backend.encrypt(input, salt), xorBinaryCipher.encrypt(input, salt));
	await backend.close();
	await backend.close();
	await assert.rejects(
		backend.encrypt(makeBytes(32), salt),
		{ code: "PARALLEL_WORKER_FAILED" }
	);

	const activeBackend = await createParallelXorBinaryCipher({
		workerCount: 1,
		minimumParallelBytes: 0
	});
	const activeTransform = activeBackend.encrypt(makeBytes(1024 * 1024), salt);
	const closing = activeBackend.close();
	await assert.rejects(activeTransform, { code: "PARALLEL_WORKER_FAILED" });
	await closing;
});

test("async binary operations reject spoofed reserved backends and mismatches", async () => {
	const spoofed = {
		id: "fise.xor.u8.v1",
		async encrypt(input, salt) {
			return xorBinaryCipher.encrypt(input, salt);
		},
		async decrypt(input, salt) {
			return xorBinaryCipher.decrypt(input, salt);
		}
	};
	await assert.rejects(
		fiseBinaryEncryptAsync(new Uint8Array([1]), defaultBinaryProfile, {
			backend: spoofed
		}),
		{ code: "TRANSFORM_MISMATCH" }
	);

	const mismatched = {
		id: "application.other.transform",
		async encrypt(input) {
			return input.slice();
		},
		async decrypt(input) {
			return input.slice();
		}
	};
	await assert.rejects(
		fiseBinaryEncryptAsync(new Uint8Array([1]), defaultBinaryProfile, {
			backend: mismatched
		}),
		{ code: "TRANSFORM_MISMATCH" }
	);
});

test("async binary options and cancellation fail closed", async () => {
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		fiseBinaryEncryptAsync(new Uint8Array([1]), defaultBinaryProfile, {
			signal: controller.signal
		}),
		{ code: "OPERATION_ABORTED" }
	);
	await assert.rejects(
		fiseBinaryEncryptAsync(new Uint8Array([1]), defaultBinaryProfile, {
			unknown: true
		}),
		{ code: "INVALID_INPUT" }
	);
	const accessorOptions = {};
	Object.defineProperty(accessorOptions, "backend", {
		enumerable: true,
		get() {
			throw new Error("must not execute");
		}
	});
	await assert.rejects(
		fiseBinaryEncryptAsync(new Uint8Array([1]), defaultBinaryProfile, accessorOptions),
		{ code: "INVALID_INPUT" }
	);
	const invalidSignal = {
		get aborted() {
			throw new Error("must be normalized");
		},
		addEventListener() {},
		removeEventListener() {}
	};
	await assert.rejects(
		fiseBinaryEncryptAsync(new Uint8Array([1]), defaultBinaryProfile, {
			signal: invalidSignal
		}),
		{ code: "INVALID_INPUT" }
	);
});

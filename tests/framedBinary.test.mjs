import assert from "node:assert/strict";
import test from "node:test";

import {
	FISE_FRAMED_BINARY_VERSION,
	createParallelXorBinaryCipher,
	defaultBinaryProfile,
	defineBinaryProfile,
	fiseFramedBinaryDecrypt,
	fiseFramedBinaryDecryptProgressive,
	fiseFramedBinaryDecryptRange,
	fiseFramedBinaryEncrypt,
	xorBinaryCipher
} from "fise";

const makeBytes = length => Uint8Array.from(
	{ length },
	(_, index) => (index * 29 + 7) & 0xff
);

test("framed binary round trip, range restore, and progressive restore share one index", async () => {
	const input = makeBytes(1_003);
	const container = await fiseFramedBinaryEncrypt(input, defaultBinaryProfile, {
		frameSize: 128,
		concurrency: 3
	});
	assert.equal(String.fromCharCode(...container.subarray(0, 4)), "FISF");
	assert.deepEqual(FISE_FRAMED_BINARY_VERSION, { major: 1, minor: 0 });
	assert.equal(container[4], 1);
	assert.equal(container[5], 0);
	const view = new DataView(container.buffer, container.byteOffset, container.byteLength);
	assert.equal(view.getUint32(8, false), 128);
	assert.equal(view.getUint32(12, false), input.length);
	assert.equal(view.getUint32(16, false), 8);

	assert.deepEqual(
		await fiseFramedBinaryDecrypt(container, defaultBinaryProfile, { concurrency: 2 }),
		input
	);
	for (const [start, endExclusive] of [
		[0, 1],
		[0, 128],
		[127, 129],
		[255, 701],
		[1_000, 1_003],
		[400, 400]
	]) {
		assert.deepEqual(
			await fiseFramedBinaryDecryptRange(
				container,
				defaultBinaryProfile,
				{ start, endExclusive },
				{ concurrency: 3 }
			),
			input.slice(start, endExclusive)
		);
	}

	const progressive = [];
	for await (const frame of fiseFramedBinaryDecryptProgressive(
		container,
		defaultBinaryProfile
	)) {
		progressive.push(frame);
	}
	assert.deepEqual(progressive.map(frame => frame.length), [128, 128, 128, 128, 128, 128, 128, 107]);
	assert.deepEqual(concat(progressive), input);
});

test("empty framed payload remains profile-bound and yields no progressive frames", async () => {
	const container = await fiseFramedBinaryEncrypt(
		new Uint8Array(),
		defaultBinaryProfile,
		{ frameSize: 32 }
	);
	assert.equal(new DataView(container.buffer).getUint32(16, false), 0);
	assert.deepEqual(
		await fiseFramedBinaryDecrypt(container, defaultBinaryProfile),
		new Uint8Array()
	);
	const frames = [];
	for await (const frame of fiseFramedBinaryDecryptProgressive(
		container,
		defaultBinaryProfile
	)) frames.push(frame);
	assert.deepEqual(frames, []);

	const otherProfile = defineBinaryProfile({
		...defaultBinaryProfile,
		id: "fise.test.other.binary"
	});
	await assert.rejects(
		fiseFramedBinaryDecrypt(container, otherProfile),
		{ code: "PROFILE_MISMATCH" }
	);
});

test("framed operations compose with the real parallel worker backend", async () => {
	const backend = await createParallelXorBinaryCipher({
		workerCount: 3,
		minimumParallelBytes: 0
	});
	try {
		const input = makeBytes(512 * 1024 + 17);
		const container = await fiseFramedBinaryEncrypt(input, defaultBinaryProfile, {
			frameSize: 128 * 1024,
			concurrency: 2,
			backend
		});
		assert.deepEqual(
			await fiseFramedBinaryDecryptRange(
				container,
				defaultBinaryProfile,
				{ start: 64 * 1024 - 3, endExclusive: 400 * 1024 + 9 },
				{ concurrency: 2, backend }
			),
			input.slice(64 * 1024 - 3, 400 * 1024 + 9)
		);
		assert.deepEqual(
			await fiseFramedBinaryDecrypt(container, defaultBinaryProfile, {
				concurrency: 2,
				backend
			}),
			input
		);
	} finally {
		await backend.close();
	}
});

test("range restore validates only selected inner envelopes after the outer index", async () => {
	const input = makeBytes(192);
	const container = await fiseFramedBinaryEncrypt(input, defaultBinaryProfile, {
		frameSize: 64
	});
	const corrupted = container.slice();
	const profileLength = corrupted[7];
	const indexStart = 24 + profileLength;
	const firstFrameOffset = new DataView(
		corrupted.buffer,
		corrupted.byteOffset,
		corrupted.byteLength
	).getUint32(indexStart, false);
	const innerProfileLength = corrupted[firstFrameOffset + 6];
	const innerHeaderLength = 13 + innerProfileLength;
	corrupted[firstFrameOffset + innerHeaderLength] ^= 1;

	assert.deepEqual(
		await fiseFramedBinaryDecryptRange(
			corrupted,
			defaultBinaryProfile,
			{ start: 64, endExclusive: 128 }
		),
		input.slice(64, 128)
	);
	await assert.rejects(
		fiseFramedBinaryDecrypt(corrupted, defaultBinaryProfile),
		{ code: "MARKER_MISMATCH" }
	);
});

test("range restoration performs exactly the selected frame transforms", async () => {
	const { counters, profile } = createCountingProfile();
	const input = makeBytes(256);
	const container = await fiseFramedBinaryEncrypt(input, profile, {
		frameSize: 64
	});

	for (const [range, expectedFrameTransforms] of [
		[{ start: 5, endExclusive: 13 }, 1],
		[{ start: 63, endExclusive: 65 }, 2],
		[{ start: 31, endExclusive: 225 }, 4],
		[{ start: 96, endExclusive: 96 }, 0]
	]) {
		counters.decrypt = 0;
		assert.deepEqual(
			await fiseFramedBinaryDecryptRange(container, profile, range),
			input.slice(range.start, range.endExclusive)
		);
		assert.equal(counters.decrypt, expectedFrameTransforms);
	}

	const malformedUnselectedFrame = container.slice();
	const firstFrameOffset = frameOffset(malformedUnselectedFrame, 0);
	malformedUnselectedFrame[firstFrameOffset] ^= 0xff;
	counters.decrypt = 0;
	assert.deepEqual(
		await fiseFramedBinaryDecryptRange(
			malformedUnselectedFrame,
			profile,
			{ start: 64, endExclusive: 128 }
		),
		input.slice(64, 128)
	);
	assert.equal(counters.decrypt, 1);
});

test("progressive restoration is pull-driven, snapshots input, and stops without prefetch", async () => {
	const { counters, profile } = createCountingProfile();
	const input = makeBytes(192);
	const source = await fiseFramedBinaryEncrypt(input, profile, { frameSize: 64 });
	const pristine = source.slice();
	counters.decrypt = 0;

	const iterator = fiseFramedBinaryDecryptProgressive(source, profile);
	assert.equal(counters.decrypt, 0);
	source.fill(0);

	const first = await iterator.next();
	assert.equal(first.done, false);
	assert.deepEqual(first.value, input.slice(0, 64));
	assert.equal(counters.decrypt, 1);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(counters.decrypt, 1);

	const second = await iterator.next();
	assert.equal(second.done, false);
	assert.deepEqual(second.value, input.slice(64, 128));
	assert.equal(counters.decrypt, 2);
	await iterator.return();
	assert.equal(counters.decrypt, 2);

	counters.decrypt = 0;
	for await (const frame of fiseFramedBinaryDecryptProgressive(pristine, profile)) {
		assert.deepEqual(frame, input.slice(0, 64));
		break;
	}
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(counters.decrypt, 1);
});

test("progressive restoration handles abort, empty input, and frame failure per pull", async () => {
	const { counters, profile } = createCountingProfile();
	const input = makeBytes(128);
	const container = await fiseFramedBinaryEncrypt(input, profile, { frameSize: 64 });

	const controller = new AbortController();
	counters.decrypt = 0;
	const aborted = fiseFramedBinaryDecryptProgressive(container, profile, {
		signal: controller.signal
	});
	assert.deepEqual((await aborted.next()).value, input.slice(0, 64));
	assert.equal(counters.decrypt, 1);
	controller.abort();
	await assert.rejects(aborted.next(), { code: "OPERATION_ABORTED" });
	assert.equal(counters.decrypt, 1);

	const empty = await fiseFramedBinaryEncrypt(new Uint8Array(), profile, {
		frameSize: 64
	});
	counters.decrypt = 0;
	const emptyIterator = fiseFramedBinaryDecryptProgressive(empty, profile);
	assert.deepEqual(await emptyIterator.next(), { value: undefined, done: true });
	assert.equal(counters.decrypt, 0);

	counters.decrypt = 0;
	counters.failDecrypt = true;
	const failing = fiseFramedBinaryDecryptProgressive(container, profile);
	const unhandled = [];
	const onUnhandled = reason => unhandled.push(reason);
	process.on("unhandledRejection", onUnhandled);
	try {
		await assert.rejects(failing.next(), { code: "INVALID_CIPHERTEXT" });
		assert.equal(counters.decrypt, 1);
		await new Promise(resolve => setImmediate(resolve));
		assert.deepEqual(unhandled, []);
	} finally {
		process.off("unhandledRejection", onUnhandled);
		counters.failDecrypt = false;
	}
});

test("progressive iterator creation validates the complete outer index synchronously", async () => {
	const container = await fiseFramedBinaryEncrypt(
		makeBytes(128),
		defaultBinaryProfile,
		{ frameSize: 64 }
	);
	const malformed = container.slice();
	new DataView(malformed.buffer).setUint32(
		24 + malformed[7],
		malformed.length,
		false
	);
	assert.throws(
		() => fiseFramedBinaryDecryptProgressive(malformed, defaultBinaryProfile),
		{ code: "INVALID_ENVELOPE" }
	);
});

test("framed parser rejects malformed index, version, bounds, and ranges", async () => {
	const input = makeBytes(200);
	const container = await fiseFramedBinaryEncrypt(input, defaultBinaryProfile, {
		frameSize: 64
	});
	const wrongVersion = container.slice();
	wrongVersion[5] = 1;
	await assert.rejects(
		fiseFramedBinaryDecrypt(wrongVersion, defaultBinaryProfile),
		{ code: "UNSUPPORTED_VERSION" }
	);

	const wrongOffset = container.slice();
	const indexStart = 24 + wrongOffset[7];
	new DataView(wrongOffset.buffer).setUint32(indexStart, wrongOffset.length, false);
	await assert.rejects(
		fiseFramedBinaryDecrypt(wrongOffset, defaultBinaryProfile),
		{ code: "INVALID_ENVELOPE" }
	);
	await assert.rejects(
		fiseFramedBinaryDecrypt(container, defaultBinaryProfile, {
			maxContainerLength: container.length - 1
		}),
		{ code: "ENVELOPE_LIMIT" }
	);
	await assert.rejects(
		fiseFramedBinaryDecrypt(container, defaultBinaryProfile, {
			maxFrameCount: 3
		}),
		{ code: "FRAME_LIMIT" }
	);
	for (const range of [
		{ start: -1, endExclusive: 1 },
		{ start: 2, endExclusive: 1 },
		{ start: 0, endExclusive: 201 },
		{ start: 0, endExclusive: 1, extra: true }
	]) {
		await assert.rejects(
			fiseFramedBinaryDecryptRange(
				container,
				defaultBinaryProfile,
				range
			),
			{ code: "INVALID_RANGE" }
		);
	}
});

test("framed options and cancellation fail before frame work", async () => {
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		fiseFramedBinaryEncrypt(new Uint8Array([1]), defaultBinaryProfile, {
			signal: controller.signal,
			frameSize: 1
		}),
		{ code: "OPERATION_ABORTED" }
	);
	await assert.rejects(
		fiseFramedBinaryEncrypt(new Uint8Array([1]), defaultBinaryProfile, {
			frameSize: 0
		}),
		{ code: "INVALID_INPUT" }
	);
	const accessorOptions = {};
	Object.defineProperty(accessorOptions, "frameSize", {
		enumerable: true,
		get() {
			throw new Error("must not execute");
		}
	});
	await assert.rejects(
		fiseFramedBinaryEncrypt(
			new Uint8Array([1]),
			defaultBinaryProfile,
			accessorOptions
		),
		{ code: "INVALID_INPUT" }
	);
});

function concat(chunks) {
	const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.length;
	}
	return output;
}

function createCountingProfile() {
	const counters = { encrypt: 0, decrypt: 0, failDecrypt: false };
	const profile = defineBinaryProfile({
		...defaultBinaryProfile,
		id: "test.counting.binary.profile.v1",
		transform: {
			id: "test.counting.binary.transform.v1",
			encrypt(input, salt) {
				counters.encrypt++;
				return xorBinaryCipher.encrypt(input, salt);
			},
			decrypt(input, salt) {
				counters.decrypt++;
				if (counters.failDecrypt) throw new Error("instrumented frame failure");
				return xorBinaryCipher.decrypt(input, salt);
			}
		}
	});
	return { counters, profile };
}

function frameOffset(container, frameIndex) {
	const indexStart = 24 + container[7];
	return new DataView(
		container.buffer,
		container.byteOffset,
		container.byteLength
	).getUint32(indexStart + frameIndex * 8, false);
}

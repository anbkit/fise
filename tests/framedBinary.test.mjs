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
	fiseFramedBinaryEncrypt
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


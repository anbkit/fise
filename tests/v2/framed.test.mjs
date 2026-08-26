import assert from "node:assert/strict";
import test from "node:test";

import { Fise, FiseError, FISF_WIRE_VERSION } from "fise";
import profileA from "./profile-a.generated.mjs";
import profileB from "./profile-b.generated.mjs";

const input = Uint8Array.from({ length: 1_003 }, (_, index) => (index * 17 + 3) & 0xff);

test("FISF 2.0 restores full, selective, and progressive binary data", async () => {
	const fise = new Fise(profileA);
	const context = [7];
	const container = fise.encryptFramed(input, context, { frameSize: 256 });
	assert.deepEqual(fise.decryptFramed(container, context), input);
	assert.deepEqual(
		fise.decryptRange(container, { start: 250, endExclusive: 700 }, context),
		input.slice(250, 700)
	);
	assert.deepEqual(
		fise.decryptRange(container, { start: 500, endExclusive: 500 }, context),
		new Uint8Array()
	);

	const frames = [];
	for await (const frame of fise.decryptProgressive(container, context)) frames.push(frame);
	assert.deepEqual(join(frames), input);
	assert.equal(frames.length, 4);
	assert.deepEqual(FISF_WIRE_VERSION, { major: 2, minor: 0 });
});

test("progressive restoration snapshots container and context before the first pull", async () => {
	const fise = new Fise(profileA);
	const context = [9];
	const container = fise.encryptFramed(input, context, { frameSize: 128 });
	const progressive = fise.decryptProgressive(container, context);
	container.fill(0);
	context[0] = 10;
	const restored = [];
	for await (const frame of progressive) restored.push(frame);
	assert.deepEqual(join(restored), input);
});

test("progressive restoration is pull-driven and aborts on the next pull", async () => {
	const fise = new Fise(profileA);
	const container = fise.encryptFramed(input, undefined, { frameSize: 100 });
	const controller = new AbortController();
	const progressive = fise.decryptProgressive(container, undefined, { signal: controller.signal });
	const first = await progressive.next();
	assert.equal(first.done, false);
	assert.deepEqual(first.value, input.slice(0, 100));
	controller.abort();
	await assert.rejects(
		progressive.next(),
		(error) => error instanceof FiseError && error.code === "OPERATION_ABORTED"
	);
});

test("FISF rejects wrong profiles, malformed indexes, and invalid ranges", () => {
	const first = new Fise(profileA);
	const second = new Fise(profileB);
	const container = first.encryptFramed(input, undefined, { frameSize: 256 });
	assert.throws(
		() => second.decryptFramed(container),
		(error) => error instanceof FiseError && error.code === "PROFILE_MISMATCH"
	);

	const malformed = container.slice();
	new DataView(malformed.buffer).setUint32(40, 0, false);
	assert.throws(() => first.decryptFramed(malformed), FiseError);
	assert.throws(
		() => first.decryptRange(container, { start: 0, endExclusive: input.length + 1 }),
		(error) => error instanceof FiseError && error.code === "INVALID_RANGE"
	);
});

test("empty framed binary data roundtrips without synthetic frames", async () => {
	const fise = new Fise(profileA);
	const container = fise.encryptFramed(new Uint8Array(), [1]);
	const otherContext = fise.encryptFramed(new Uint8Array(), [2]);
	assert.notDeepEqual(container, otherContext);
	assert.deepEqual(fise.decryptFramed(container, [1]), new Uint8Array());
	assert.throws(
		() => fise.decryptFramed(container, [2]),
		(error) => error instanceof FiseError && error.code === "MARKER_MISMATCH"
	);
	let pulls = 0;
	for await (const _frame of fise.decryptProgressive(container, [1])) pulls++;
	assert.equal(pulls, 0);
});

test("FISF bounds frame counts before per-frame work", () => {
	const fise = new Fise(profileA);
	assert.throws(
		() => fise.encryptFramed(new Uint8Array(65_537), undefined, { frameSize: 1 }),
		(error) => error instanceof FiseError && error.code === "FRAME_LIMIT"
	);

	const malformed = fise.encryptFramed(new Uint8Array());
	const view = new DataView(malformed.buffer, malformed.byteOffset, malformed.byteLength);
	view.setUint32(24, 1, false);
	view.setUint32(28, 65_537, false);
	view.setUint32(32, 65_537, false);
	assert.throws(
		() => fise.decryptFramed(malformed),
		(error) => error instanceof FiseError && error.code === "FRAME_LIMIT"
	);

	const oversizedPlaintext = fise.encryptFramed(new Uint8Array([1]), undefined, {
		frameSize: 1
	});
	const oversizedView = new DataView(
		oversizedPlaintext.buffer,
		oversizedPlaintext.byteOffset,
		oversizedPlaintext.byteLength
	);
	oversizedView.setUint32(24, 0xffff_ffff, false);
	oversizedView.setUint32(28, 0xffff_ffff, false);
	assert.throws(
		() => fise.decryptFramed(oversizedPlaintext),
		(error) => error instanceof FiseError && error.code === "FRAME_LIMIT"
	);
});

function join(frames) {
	const output = new Uint8Array(frames.reduce((length, frame) => length + frame.length, 0));
	let offset = 0;
	for (const frame of frames) {
		output.set(frame, offset);
		offset += frame.length;
	}
	return output;
}

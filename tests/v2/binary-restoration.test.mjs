import assert from "node:assert/strict";
import test from "node:test";

import { Fise, FiseError } from "fise";
import { decryptBinaryRange } from "../../dist/v2/binary.js";
import { canBorrowBytesForSynchronousRead } from "../../dist/v2/bytes.js";
import { DEFAULT_EDGE_BYTES } from "../../dist/v2/coverage.js";
import {
	assertBinaryContentEnvelopeCapacity,
	FISE_ENVELOPE_OVERHEAD,
	FISE_MAX_ENVELOPE_LENGTH,
	ownBinaryEnvelope
} from "../../dist/v2/envelope.js";
import { runProfileKernel } from "../../dist/v2/profile.js";
import profile from "./profile-a.generated.mjs";

const context = ["session_7f4a", "user_42", "binary", "v2"];

test("synchronous range borrowing is limited to ordinary local byte arrays", () => {
	assert.equal(canBorrowBytesForSynchronousRead(new Uint8Array(8)), true);
	class ByteSubclass extends Uint8Array {}
	assert.equal(canBorrowBytesForSynchronousRead(new ByteSubclass(8)), false);
	if (typeof SharedArrayBuffer === "function") {
		assert.equal(
			canBorrowBytesForSynchronousRead(new Uint8Array(new SharedArrayBuffer(8))),
			false
		);
	}
});

test("binary input size is rejected before payload copying", () => {
	const maximumContentLength = FISE_MAX_ENVELOPE_LENGTH - FISE_ENVELOPE_OVERHEAD - 2;
	assert.doesNotThrow(() => assertBinaryContentEnvelopeCapacity(maximumContentLength));
	assert.throws(
		() => assertBinaryContentEnvelopeCapacity(maximumContentLength + 1),
		(error) => error instanceof FiseError && error.code === "ENVELOPE_LIMIT"
	);
});

test("ordinary binary envelopes restore full, selective, and progressive data", async () => {
	const fise = new Fise(profile);
	const input = Uint8Array.from({ length: 300_123 }, (_, index) => (index * 41 + 7) & 0xff);
	const envelope = fise.encrypt(input, context);

	assert.ok(envelope instanceof Uint8Array);
	assert.deepEqual(fise.decrypt(envelope, context), input);
	for (const range of [
		{ start: 0, endExclusive: 0 },
		{ start: 0, endExclusive: 1 },
		{ start: 17, endExclusive: 91 },
		{ start: 255_999, endExclusive: 300_123 },
		{ start: input.length, endExclusive: input.length }
	]) {
		assert.deepEqual(
			fise.decryptRange(envelope, range, context),
			input.slice(range.start, range.endExclusive)
		);
	}

	const chunks = [];
	for await (const chunk of fise.decryptProgressive(envelope, context, {
		chunkSize: 65_537
	})) {
		chunks.push(chunk);
	}
	assert.deepEqual(join(chunks), input);
	assert.deepEqual(chunks.map(chunk => chunk.length), [65_537, 65_537, 65_537, 65_537, 37_975]);

	const noContextEnvelope = fise.encrypt(input);
	const noContextChunks = [];
	for await (const chunk of fise.decryptProgressive(noContextEnvelope, {
		chunkSize: 100_000
	})) {
		noContextChunks.push(chunk);
	}
	assert.deepEqual(join(noContextChunks), input);
});

test("binary edge mode transforms only configured edges and restores every read shape", async () => {
	const edgeBytes = 2_048;
	const fise = new Fise(profile, {
		binary: { mode: "edges", edgeBytes }
	});
	const input = Uint8Array.from({ length: 20_003 }, (_, index) => (index * 43 + 17) & 0xff);
	const envelope = fise.encrypt(input, context);
	const owned = ownBinaryEnvelope(envelope, profile, context);
	const transformed = transformedPayload(envelope, owned.markerOffset);

	assert.equal(envelope[7], 1);
	assert.equal(new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength).getUint32(28, false), edgeBytes);
	assert.deepEqual(owned.coverage, { mode: "edges", edgeBytes });
	assert.deepEqual(
		transformed.slice(2 + edgeBytes, 2 + input.length - edgeBytes),
		input.slice(edgeBytes, input.length - edgeBytes),
		"edge mode deliberately leaves the middle binary region untransformed"
	);
	assert.deepEqual(fise.decrypt(envelope, context), input);

	for (const range of [
		{ start: 11, endExclusive: 333 },
		{ start: edgeBytes - 12, endExclusive: edgeBytes + 12 },
		{ start: 8_000, endExclusive: 9_000 },
		{ start: input.length - edgeBytes - 12, endExclusive: input.length - edgeBytes + 12 },
		{ start: input.length - 333, endExclusive: input.length - 11 },
		{ start: 0, endExclusive: input.length }
	]) {
		assert.deepEqual(
			fise.decryptRange(envelope, range, context),
			input.slice(range.start, range.endExclusive)
		);
	}

	const chunks = [];
	for await (const chunk of fise.decryptProgressive(envelope, context, { chunkSize: 3_001 })) {
		chunks.push(chunk);
	}
	assert.deepEqual(join(chunks), input);
});

test("binary edge mode skips reverse work for a range wholly inside the clear middle", () => {
	const fise = new Fise(profile, {
		binary: { mode: "edges", edgeBytes: 1_024 }
	});
	const input = Uint8Array.from({ length: 50_000 }, (_, index) => (index * 31 + 9) & 0xff);
	const envelope = fise.encrypt(input, context);
	const calls = [];
	const recordingRun = (...arguments_) => {
		calls.push({
			operation: arguments_[0],
			length: arguments_[2].length,
			absoluteOffset: arguments_[5]
		});
		return runProfileKernel(...arguments_);
	};

	assert.deepEqual(
		decryptBinaryRange(
			envelope,
			profile,
			{ start: 10_000, endExclusive: 20_000 },
			context,
			recordingRun
		),
		input.slice(10_000, 20_000)
	);
	assert.deepEqual(calls, [
		{ operation: "reverse", length: 2, absoluteOffset: 0 }
	]);
});

test("binary edge mode does not imply integrity for its clear middle", () => {
	const fise = new Fise(profile, {
		binary: { mode: "edges", edgeBytes: 200 }
	});
	const input = Uint8Array.from({ length: 2_000 }, (_, index) => (index * 13 + 5) & 0xff);
	const envelope = fise.encrypt(input, context);
	const owned = ownBinaryEnvelope(envelope, profile, context);
	const contentOffset = 1_000;
	const logicalOffset = 2 + contentOffset;
	const physicalOffset = 40 + logicalOffset + (logicalOffset >= owned.markerOffset ? 4 : 0);
	const tampered = envelope.slice();
	tampered[physicalOffset] ^= 0x80;
	const expected = input.slice();
	expected[contentOffset] ^= 0x80;

	assert.deepEqual(fise.decrypt(tampered, context), expected);
	assert.deepEqual(
		fise.decryptRange(
			tampered,
			{ start: contentOffset - 1, endExclusive: contentOffset + 2 },
			context
		),
		expected.slice(contentOffset - 1, contentOffset + 2)
	);
});

test("overlapping edge coverage canonicalizes to full coverage", () => {
	const fise = new Fise(profile);
	const edgeFise = new Fise(profile, {
		binary: { mode: "edges", edgeBytes: 50 }
	});
	const input = Uint8Array.from({ length: 100 }, (_, index) => index);
	const full = fise.encrypt(input, context);
	const overlapping = edgeFise.encrypt(input, context);

	assert.deepEqual(overlapping, full);
	assert.equal(overlapping[7], 0);
	assert.equal(new DataView(overlapping.buffer, overlapping.byteOffset, overlapping.byteLength).getUint32(28, false), 0);
});

test("direct range crosses marker placement without decrypting the full payload", () => {
	const fise = new Fise(profile);
	const input = Uint8Array.from({ length: 1_000_003 }, (_, index) => (index * 19 + 11) & 0xff);
	const envelope = fise.encrypt(input, context);
	const calls = [];
	const recordingRun = (...arguments_) => {
		calls.push({
			operation: arguments_[0],
			length: arguments_[2].length,
			absoluteOffset: arguments_[5]
		});
		return runProfileKernel(...arguments_);
	};
	const markerOffset = ownBinaryEnvelope(envelope, profile, context).markerOffset;
	assert.ok(markerOffset > 2 && markerOffset < input.length + 2);
	const markerContentOffset = markerOffset - 2;
	const start = markerContentOffset - 617;
	const endExclusive = markerContentOffset + 617;

	const restored = decryptBinaryRange(
		envelope,
		profile,
		{ start, endExclusive },
		context,
		recordingRun
	);

	assert.deepEqual(restored, input.slice(start, endExclusive));
	assert.deepEqual(calls, [
		{ operation: "reverse", length: 2, absoluteOffset: 0 },
		{ operation: "reverse", length: endExclusive - start, absoluteOffset: start + 2 }
	]);
});

test("progressive restoration snapshots the envelope and validates before first pull", async () => {
	const fise = new Fise(profile);
	const input = Uint8Array.from({ length: 1_111 }, (_, index) => (index * 29 + 5) & 0xff);
	const envelope = fise.encrypt(input, context);
	const iterator = fise.decryptProgressive(envelope, context, { chunkSize: 256 });
	envelope.fill(0);

	const chunks = [];
	for await (const chunk of iterator) chunks.push(chunk);
	assert.deepEqual(join(chunks), input);
	assert.throws(
		() => fise.decryptProgressive(envelope, context),
		(error) => error instanceof FiseError && error.code === "INVALID_ENVELOPE"
	);
});

test("progressive restoration is pull-driven and aborts on the next pull", async () => {
	const fise = new Fise(profile);
	const input = Uint8Array.from({ length: 900 }, (_, index) => index & 0xff);
	const envelope = fise.encrypt(input, context);
	const controller = new AbortController();
	const iterator = fise.decryptProgressive(envelope, context, {
		chunkSize: 300,
		signal: controller.signal
	});

	assert.deepEqual((await iterator.next()).value, input.slice(0, 300));
	controller.abort();
	await assert.rejects(
		iterator.next(),
		(error) => error instanceof FiseError && error.code === "OPERATION_ABORTED"
	);
});

test("empty binary envelopes produce empty range and progressive results", async () => {
	const fise = new Fise(profile);
	const envelope = fise.encrypt(new Uint8Array(), context);
	assert.deepEqual(
		fise.decryptRange(envelope, { start: 0, endExclusive: 0 }, context),
		new Uint8Array()
	);
	let count = 0;
	for await (const _chunk of fise.decryptProgressive(envelope, context)) count++;
	assert.equal(count, 0);

	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		fise.decryptProgressive(envelope, context, { signal: controller.signal }).next(),
		(error) => error instanceof FiseError && error.code === "OPERATION_ABORTED"
	);
});

test("progressive restoration checks abort state on the terminal pull", async () => {
	const fise = new Fise(profile);
	const input = Uint8Array.of(1, 2, 3);
	const envelope = fise.encrypt(input, context);
	const controller = new AbortController();
	const iterator = fise.decryptProgressive(envelope, context, {
		chunkSize: input.length,
		signal: controller.signal
	});

	assert.deepEqual((await iterator.next()).value, input);
	controller.abort();
	await assert.rejects(
		iterator.next(),
		(error) => error instanceof FiseError && error.code === "OPERATION_ABORTED"
	);
});

test("range and progressive restoration reject structured envelopes and wrong context", () => {
	const fise = new Fise(profile);
	const structured = fise.encrypt({ ok: true }, context);
	const binary = fise.encrypt(Uint8Array.of(1, 2, 3), context);

	assert.throws(
		() => fise.decryptRange(structured, { start: 0, endExclusive: 0 }, context),
		(error) => error instanceof FiseError && error.code === "INVALID_ENVELOPE"
	);
	for (const operation of [
		() => fise.decryptRange(binary, { start: 0, endExclusive: 1 }, ["wrong"]),
		() => fise.decryptProgressive(binary, ["wrong"])
	]) {
		assert.throws(
			operation,
			(error) => error instanceof FiseError && error.code === "MARKER_MISMATCH"
		);
	}
});

test("range and progressive options are strict and bounded", () => {
	const fise = new Fise(profile);
	const envelope = fise.encrypt(Uint8Array.of(1, 2, 3), context);
	for (const range of [
		{},
		{ start: -1, endExclusive: 1 },
		{ start: 2, endExclusive: 1 },
		{ start: 0.5, endExclusive: 1 },
		{ start: 0, endExclusive: 4 },
		null
	]) {
		assert.throws(
			() => fise.decryptRange(envelope, range, context),
			(error) => error instanceof FiseError && error.code === "INVALID_RANGE"
		);
	}
	for (const chunkSize of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 0x1_0000_0000, "256"]) {
		assert.throws(
			() => fise.decryptProgressive(envelope, context, { chunkSize }),
			(error) => error instanceof FiseError && error.code === "INVALID_INPUT"
		);
	}
	assert.throws(
		() => fise.decryptProgressive(envelope, context, { signal: {} }),
		(error) => error instanceof FiseError && error.code === "INVALID_INPUT"
	);
	assert.throws(
		() => fise.decryptProgressive(envelope, context, { signal: { aborted: false } }),
		(error) => error instanceof FiseError && error.code === "INVALID_INPUT"
	);
});

test("constructor binary options default, snapshot, and fail closed", () => {
	const input = Uint8Array.from({ length: 1_000 }, (_, index) => index & 0xff);
	const mutableBinary = { mode: "edges", edgeBytes: 100 };
	const fise = new Fise(profile, { binary: mutableBinary });
	mutableBinary.edgeBytes = 200;
	assert.deepEqual(fise.decrypt(fise.encrypt({ binary: false }, context), context), {
		binary: false
	});

	const defaultEdges = new Fise(profile, { binary: { mode: "edges" } });
	const smallEnvelope = defaultEdges.encrypt(input, context);
	assert.equal(smallEnvelope[7], 0, "overlapping default edges canonicalize to full");
	const defaultEdgeInput = new Uint8Array(DEFAULT_EDGE_BYTES * 2 + 1);
	defaultEdgeInput[defaultEdgeInput.length - 1] = 1;
	const defaultEdgeEnvelope = defaultEdges.encrypt(defaultEdgeInput, context);
	const defaultEdgeView = new DataView(
		defaultEdgeEnvelope.buffer,
		defaultEdgeEnvelope.byteOffset,
		defaultEdgeEnvelope.byteLength
	);
	assert.equal(defaultEdgeEnvelope[7], 1);
	assert.equal(defaultEdgeView.getUint32(28, false), DEFAULT_EDGE_BYTES);
	assert.deepEqual(defaultEdges.decrypt(defaultEdgeEnvelope, context), defaultEdgeInput);

	for (const binary of [
		{},
		{ mode: "head-tail", edgeBytes: 10 },
		{ mode: "edges", edgeBytes: 0 },
		{ mode: "edges", edgeBytes: -1 },
		{ mode: "edges", edgeBytes: 1.5 },
		{ mode: "edges", edgeBytes: 0x1_0000_0000 },
		{ mode: "edges", edgeBytes: 10, extra: true },
		null
	]) {
		assert.throws(
			() => new Fise(profile, { binary }),
			(error) => error instanceof FiseError && error.code === "INVALID_INPUT"
		);
	}
	assert.throws(
		() => new Fise(profile, { strict: false, binary: { mode: "edges", edgeBytes: 0 } }),
		(error) => error instanceof FiseError && error.code === "INVALID_INPUT"
	);
	const binaryAccessor = {};
	Object.defineProperty(binaryAccessor, "mode", { get: () => "edges" });
	assert.throws(
		() => new Fise(profile, { binary: binaryAccessor }),
		(error) => error instanceof FiseError && error.code === "INVALID_INPUT"
	);
	const reflectionFailure = new Error("binary ownKeys trap");
	assert.throws(
		() => new Fise(profile, {
			binary: new Proxy({}, { ownKeys: () => { throw reflectionFailure; } })
		}),
		(error) =>
			error instanceof FiseError &&
			error.code === "INVALID_INPUT" &&
			error.cause === reflectionFailure
	);
	assert.throws(
		() => new Fise(profile).encrypt(input, context, { binary: { mode: "edges" } }),
		(error) => error instanceof FiseError && error.code === "INVALID_INPUT"
	);

	const envelope = fise.encrypt(input, context);
	assert.equal(
		new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength).getUint32(28, false),
		100,
		"constructor snapshots nested binary options"
	);
	const changedCoverage = envelope.slice();
	new DataView(
		changedCoverage.buffer,
		changedCoverage.byteOffset,
		changedCoverage.byteLength
	).setUint32(28, 101, false);
	assert.throws(
		() => fise.decrypt(changedCoverage, context),
		(error) => error instanceof FiseError && error.code === "MARKER_MISMATCH"
	);
	const unknownFlag = envelope.slice();
	unknownFlag[7] |= 0x80;
	assert.throws(
		() => fise.decrypt(unknownFlag, context),
		(error) => error instanceof FiseError && error.code === "INVALID_ENVELOPE"
	);
	const missingEdgeLength = envelope.slice();
	new DataView(
		missingEdgeLength.buffer,
		missingEdgeLength.byteOffset,
		missingEdgeLength.byteLength
	).setUint32(28, 0, false);
	assert.throws(
		() => fise.decrypt(missingEdgeLength, context),
		(error) => error instanceof FiseError && error.code === "INVALID_ENVELOPE"
	);
});

test("marker and exact envelope length are checked before selected bytes are restored", () => {
	const fise = new Fise(profile);
	const envelope = fise.encrypt(Uint8Array.from({ length: 128 }, (_, index) => index), context);
	const markerOffset = ownBinaryEnvelope(envelope, profile, context).markerOffset;
	const tampered = envelope.slice();
	tampered[40 + markerOffset] ^= 0x80;
	assert.throws(
		() => fise.decryptRange(tampered, { start: 3, endExclusive: 9 }, context),
		(error) => error instanceof FiseError && error.code === "MARKER_MISMATCH"
	);
	assert.throws(
		() => fise.decryptRange(envelope.slice(0, -1), { start: 0, endExclusive: 1 }, context),
		(error) => error instanceof FiseError && error.code === "LENGTH_MISMATCH"
	);
});

function join(chunks) {
	const output = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.length;
	}
	return output;
}

function transformedPayload(envelope, markerOffset) {
	const output = new Uint8Array(envelope.length - 44);
	output.set(envelope.subarray(40, 40 + markerOffset));
	output.set(envelope.subarray(44 + markerOffset), markerOffset);
	return output;
}

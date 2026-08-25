import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import test from "node:test";

import {
	defaultBinaryProfile,
	defaultStringProfile,
	defineBinaryProfile,
	defineStringProfile,
	fiseBinaryDecrypt,
	fiseBinaryEncrypt,
	fiseDecrypt,
	fiseEncrypt
} from "fise";
import {
	parseBinaryEnvelopeHeader,
	parseStringEnvelopeHeader
} from "../dist/core/envelopeV11.js";

test("string envelopes expose exact FISE 1.1 profile and lengths", () => {
	const envelope = fiseEncrypt("header", defaultStringProfile);
	const header = parseStringEnvelopeHeader(envelope);
	assert.equal(header.profileId, defaultStringProfile.id);
	assert.equal(header.saltLength >= 10 && header.saltLength <= 99, true);
	assert.equal(header.headerLength, 22 + defaultStringProfile.id.length);
	assert.equal(envelope.slice(0, 8), "FISE0101");
});

test("binary envelopes expose exact FISE 1.1 profile and lengths", () => {
	const envelope = fiseBinaryEncrypt(Uint8Array.from([1, 2, 3]), defaultBinaryProfile);
	const header = parseBinaryEnvelopeHeader(envelope);
	assert.equal(header.profileId, defaultBinaryProfile.id);
	assert.equal(header.transformedLength, 3);
	assert.deepEqual(Array.from(envelope.subarray(0, 6)), [70, 73, 83, 69, 1, 1]);
});

test("binary envelopes accept Uint8Array values from another realm", () => {
	const envelope = fiseBinaryEncrypt(Uint8Array.from([7, 8, 9]), defaultBinaryProfile);
	const crossRealmEnvelope = runInNewContext(
		`Uint8Array.from(${JSON.stringify(Array.from(envelope))})`
	);
	assert.equal(crossRealmEnvelope instanceof Uint8Array, false);
	assert.deepEqual(
		fiseBinaryDecrypt(crossRealmEnvelope, defaultBinaryProfile),
		Uint8Array.from([7, 8, 9])
	);
});

test("legacy magic-less envelopes fail closed", () => {
	assert.throws(() => fiseDecrypt("legacy0a0123456789", defaultStringProfile), {
		code: "INVALID_ENVELOPE"
	});
	assert.throws(
		() => fiseBinaryDecrypt(new Uint8Array(64), defaultBinaryProfile),
		{ code: "INVALID_ENVELOPE" }
	);
});

test("unsupported string and binary versions use typed errors", () => {
	const stringEnvelope = fiseEncrypt("version", defaultStringProfile);
	const wrongStringVersion = `${stringEnvelope.slice(0, 6)}02${stringEnvelope.slice(8)}`;
	assert.throws(() => fiseDecrypt(wrongStringVersion, defaultStringProfile), {
		code: "UNSUPPORTED_VERSION"
	});

	const binaryEnvelope = fiseBinaryEncrypt(Uint8Array.from([1]), defaultBinaryProfile);
	const wrongBinaryVersion = binaryEnvelope.slice();
	wrongBinaryVersion[5] = 2;
	assert.throws(() => fiseBinaryDecrypt(wrongBinaryVersion, defaultBinaryProfile), {
		code: "UNSUPPORTED_VERSION"
	});
});

test("profile mismatch fails before transform execution", () => {
	const envelope = fiseEncrypt("profile", defaultStringProfile);
	const other = defineStringProfile({
		...defaultStringProfile,
		id: "example.other"
	});
	assert.throws(() => fiseDecrypt(envelope, other), {
		code: "PROFILE_MISMATCH"
	});
});

test("truncation and trailing data fail exact length checks", () => {
	const stringEnvelope = fiseEncrypt("length", defaultStringProfile);
	assert.throws(
		() => fiseDecrypt(stringEnvelope.slice(0, -1), defaultStringProfile),
		{ code: "LENGTH_MISMATCH" }
	);
	assert.throws(
		() => fiseDecrypt(`${stringEnvelope}x`, defaultStringProfile),
		{ code: "LENGTH_MISMATCH" }
	);

	const binaryEnvelope = fiseBinaryEncrypt(Uint8Array.from([1, 2]), defaultBinaryProfile);
	assert.throws(
		() => fiseBinaryDecrypt(binaryEnvelope.subarray(0, -1), defaultBinaryProfile),
		{ code: "LENGTH_MISMATCH" }
	);
	const trailing = new Uint8Array(binaryEnvelope.length + 1);
	trailing.set(binaryEnvelope);
	assert.throws(() => fiseBinaryDecrypt(trailing, defaultBinaryProfile), {
		code: "LENGTH_MISMATCH"
	});
});

test("caller and profile envelope limits are checked before parsing", () => {
	const envelope = fiseEncrypt("bounded", defaultStringProfile);
	assert.throws(
		() => fiseDecrypt(envelope, defaultStringProfile, {
			maxEnvelopeLength: envelope.length - 1
		}),
		{ code: "ENVELOPE_LIMIT" }
	);
	assert.throws(
		() => fiseDecrypt(envelope, defaultStringProfile, { maxEnvelopeLength: -1 }),
		{ code: "INVALID_INPUT" }
	);
	const bounded = defineStringProfile({
		...defaultStringProfile,
		id: "test.bound",
		limits: { maxEnvelopeLength: 1 }
	});
	assert.throws(() => fiseEncrypt("x", bounded), {
		code: "ENVELOPE_LIMIT"
	});
});

test("invalid profile layout fails with INVALID_PROFILE", () => {
	assert.throws(
		() => defineStringProfile({ ...defaultStringProfile, id: "not allowed!" }),
		{ code: "INVALID_PROFILE" }
	);
	assert.throws(
		() => defineStringProfile({
			...defaultStringProfile,
			id: "test.bad-range",
			layout: { ...defaultStringProfile.layout, saltRange: { min: 0, max: 10 } }
		}),
		{ code: "INVALID_PROFILE" }
	);
	const emptyMarker = defineStringProfile({
		...defaultStringProfile,
		id: "test.empty-marker",
		layout: { ...defaultStringProfile.layout, createMarker() { return ""; } }
	});
	assert.throws(() => fiseEncrypt("x", emptyMarker), { code: "INVALID_PROFILE" });
	const invalidOffset = defineStringProfile({
		...defaultStringProfile,
		id: "test.invalid-offset",
		layout: { ...defaultStringProfile.layout, offset() { return Infinity; } }
	});
	assert.throws(() => fiseEncrypt("x", invalidOffset), { code: "INVALID_PROFILE" });
});

test("context-aware marker rejects a mismatched external context", () => {
	const profile = defineStringProfile({
		...defaultStringProfile,
		id: "test.context-marker",
		context: {
			metadata: { code: { type: "number", required: true } }
		},
		layout: {
			...defaultStringProfile.layout,
			createMarker(input, ctx) {
				return ((input.saltLength + Number(ctx.metadata?.code)) % 1_296)
					.toString(36)
					.padStart(2, "0");
			}
		}
	});
	const envelope = fiseEncrypt("context", profile, { metadata: { code: 4 } });
	assert.equal(
		fiseDecrypt(envelope, profile, { metadata: { code: 4 } }),
		"context"
	);
	assert.throws(
		() => fiseDecrypt(envelope, profile, { metadata: { code: 5 } }),
		{ code: "MARKER_MISMATCH" }
	);
});

test("malformed fixed string header fields never escape untyped exceptions", () => {
	const envelope = fiseEncrypt("header fuzz", defaultStringProfile);
	const cases = [
		`X${envelope.slice(1)}`,
		`${envelope.slice(0, 8)}00${envelope.slice(10)}`,
		`${envelope.slice(0, 10)}zzzz${envelope.slice(14)}`,
		`${envelope.slice(0, 14)}zzzzzzzz${envelope.slice(22)}`
	];
	for (const malformed of cases) {
		assert.throws(() => fiseDecrypt(malformed, defaultStringProfile), error => {
			return typeof error.code === "string";
		});
	}
});

test("malformed fixed binary header fields use typed errors", () => {
	const envelope = fiseBinaryEncrypt(Uint8Array.from([1, 2, 3]), defaultBinaryProfile);
	for (const index of [0, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
		const malformed = envelope.slice();
		malformed[index] ^= 0xff;
		assert.throws(() => fiseBinaryDecrypt(malformed, defaultBinaryProfile), error => {
			return typeof error.code === "string";
		});
	}
});

test("public input types fail with stable codes", () => {
	assert.throws(() => fiseEncrypt(42, defaultStringProfile), { code: "INVALID_INPUT" });
	assert.throws(() => fiseDecrypt(new Uint8Array(), defaultStringProfile), {
		code: "INVALID_ENVELOPE"
	});
	assert.throws(() => fiseBinaryEncrypt("bytes", defaultBinaryProfile), {
		code: "INVALID_INPUT"
	});
	assert.throws(() => fiseBinaryDecrypt("bytes", defaultBinaryProfile), {
		code: "INVALID_ENVELOPE"
	});
});

test("incomplete profiles and malformed transform outputs fail closed", () => {
	assert.throws(() => fiseEncrypt("x", { id: "test.incomplete" }), {
		code: "INVALID_PROFILE"
	});
	const badEncrypt = defineStringProfile({
		...defaultStringProfile,
		id: "test.bad-encrypt",
		transform: {
			id: "test.bad-encrypt-transform",
			encrypt() { return 42; },
			decrypt() { return "x"; }
		}
	});
	assert.throws(() => fiseEncrypt("x", badEncrypt), { code: "INVALID_CIPHERTEXT" });

	const envelope = fiseEncrypt("x", defaultStringProfile);
	const badDecrypt = defineStringProfile({
		...defaultStringProfile,
		transform: {
			id: "test.bad-decrypt-transform",
			encrypt() { return ""; },
			decrypt() { return 42; }
		}
	});
	assert.throws(() => fiseDecrypt(envelope, badDecrypt), {
		code: "INVALID_CIPHERTEXT"
	});

	const badBinary = defineBinaryProfile({
		...defaultBinaryProfile,
		id: "test.bad-binary",
		transform: {
			id: "test.bad-binary-transform",
			encrypt() { return "bytes"; },
			decrypt() { return new Uint8Array(); }
		}
	});
	assert.throws(
		() => fiseBinaryEncrypt(Uint8Array.from([1]), badBinary),
		{ code: "INVALID_CIPHERTEXT" }
	);

	const throwingTransform = defineStringProfile({
		...defaultStringProfile,
		id: "test.throwing-transform",
		transform: {
			id: "test.throwing-string-transform",
			encrypt() { throw new Error("application failure"); },
			decrypt() { return ""; }
		}
	});
	assert.throws(() => fiseEncrypt("x", throwingTransform), {
		code: "INVALID_CIPHERTEXT"
	});

	const throwingOffset = defineStringProfile({
		...defaultStringProfile,
		id: "test.throwing-offset",
		layout: {
			...defaultStringProfile.layout,
			offset() { throw new Error("application failure"); }
		}
	});
	assert.throws(() => fiseEncrypt("x", throwingOffset), {
		code: "INVALID_PROFILE"
	});
});

import assert from "node:assert/strict";
import test from "node:test";

import {
	defaultBinaryProfile,
	defaultStringProfile,
	defineBinaryProfile,
	defineStringProfile,
	fiseBinaryDecrypt,
	fiseBinaryEncrypt,
	fiseDecrypt,
	fiseEncrypt,
	withBinaryBackend,
	xorBinaryCipher,
	xorCipher
} from "fise";

test("default profiles are frozen atomic compatibility units", () => {
	assert.equal(defaultStringProfile.id, "fise.default.string");
	assert.equal(defaultStringProfile.transform.id, "fise.xor.utf16.v1");
	assert.equal(defaultBinaryProfile.id, "fise.default.binary");
	assert.equal(defaultBinaryProfile.transform.id, "fise.xor.u8.v1");
	assert.ok(Object.isFrozen(defaultStringProfile));
	assert.ok(Object.isFrozen(defaultStringProfile.layout));
	assert.ok(Object.isFrozen(defaultStringProfile.transform));
	assert.ok(Object.isFrozen(xorCipher));
	assert.ok(Object.isFrozen(xorBinaryCipher));
	assert.throws(() => {
		xorCipher.encrypt = value => value;
	}, TypeError);
	assert.throws(() => {
		xorBinaryCipher.id = "test.mutated";
	}, TypeError);
	const bounded = defineStringProfile({
		...defaultStringProfile,
		id: "test.frozen-range",
		layout: {
			...defaultStringProfile.layout,
			saltRange: { min: 10, max: 12 }
		}
	});
	assert.ok(Object.isFrozen(bounded.layout.saltRange));
});

test("reserved string transform IDs require the FISE implementation", () => {
	assert.throws(() => defineStringProfile({
		...defaultStringProfile,
		id: "test.fake-string-transform",
		transform: {
			id: xorCipher.id,
			encrypt(value) { return value; },
			decrypt(value) { return value; }
		}
	}), { code: "TRANSFORM_MISMATCH" });
});

test("string profile owns transform, layout, context and limits", () => {
	const profile = defineStringProfile({
		id: "test.catalog.string",
		representation: "string",
		transform: xorCipher,
		context: {
			timestamp: "required",
			metadata: {
				tenant: { type: "number", required: true }
			}
		},
		limits: { maxEnvelopeLength: 10_000 },
		layout: {
			markerSize: 2,
			saltRange: { min: 10, max: 10 },
			offset(input, ctx) {
				return input.transformedLength + Number(ctx.metadata?.tenant ?? 0);
			},
			createMarker(input, ctx) {
				const tenant = Number(ctx.metadata?.tenant ?? 0);
				return ((input.saltLength + tenant) % 1_296).toString(36).padStart(2, "0");
			}
		}
	});
	const options = { timestamp: 0, metadata: { tenant: 7 } };
	const envelope = fiseEncrypt("profile-owned", profile, options);
	assert.equal(fiseDecrypt(envelope, profile, options), "profile-owned");
	assert.throws(() => fiseDecrypt(envelope, profile, { timestamp: 0 }), {
		code: "INVALID_CONTEXT"
	});
});

test("context contracts reject wrong types and undeclared fields", () => {
	const profile = defineStringProfile({
		...defaultStringProfile,
		id: "test.context",
		context: {
			timestamp: "forbidden",
			metadata: { enabled: { type: "boolean", required: true } }
		}
	});
	assert.throws(() => fiseEncrypt("x", profile), { code: "INVALID_CONTEXT" });
	assert.throws(
		() => fiseEncrypt("x", profile, { metadata: { enabled: "yes" } }),
		{ code: "INVALID_CONTEXT" }
	);
	assert.throws(
		() => fiseEncrypt("x", profile, { metadata: { enabled: true, extra: 1 } }),
		{ code: "INVALID_CONTEXT" }
	);
	assert.throws(
		() => fiseEncrypt("x", profile, { timestamp: 1, metadata: { enabled: true } }),
		{ code: "INVALID_CONTEXT" }
	);
});

test("runtime context snapshots own data properties exactly once", () => {
	let observedTimestamp = "not-called";
	const profile = defineStringProfile({
		...defaultStringProfile,
		id: "test.context-snapshot",
		layout: {
			...defaultStringProfile.layout,
			offset(input, context) {
				observedTimestamp = context.timestamp;
				return input.transformedLength;
			}
		}
	});
	const timestampDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "timestamp");
	const limitDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "maxEnvelopeLength");
	try {
		Object.defineProperty(Object.prototype, "timestamp", {
			configurable: true,
			enumerable: true,
			value: 5
		});
		Object.defineProperty(Object.prototype, "maxEnvelopeLength", {
			configurable: true,
			enumerable: true,
			value: 0
		});
		assert.doesNotThrow(() => fiseEncrypt("prototype-safe", profile));
		assert.equal(observedTimestamp, undefined);
	} finally {
		if (timestampDescriptor) {
			Object.defineProperty(Object.prototype, "timestamp", timestampDescriptor);
		} else {
			delete Object.prototype.timestamp;
		}
		if (limitDescriptor) {
			Object.defineProperty(Object.prototype, "maxEnvelopeLength", limitDescriptor);
		} else {
			delete Object.prototype.maxEnvelopeLength;
		}
	}

	let getterCalls = 0;
	const metadata = {};
	Object.defineProperty(metadata, "value", {
		enumerable: true,
		get() {
			getterCalls++;
			return 7;
		}
	});
	const metadataProfile = defineStringProfile({
		...defaultStringProfile,
		id: "test.context-accessor",
		context: { metadata: { value: { type: "number", required: true } } }
	});
	assert.throws(
		() => fiseEncrypt("x", metadataProfile, { metadata }),
		{ code: "INVALID_CONTEXT" }
	);
	assert.equal(getterCalls, 0);
	assert.throws(
		() => fiseEncrypt("x", defaultStringProfile, {
			metadata: { [Symbol("hidden")]: 42 }
		}),
		{ code: "INVALID_CONTEXT" }
	);
	assert.throws(() => fiseEncrypt("x", defaultStringProfile, null), {
		code: "INVALID_INPUT"
	});
});

test("marker generation replaces the obsolete decodeLength contract", () => {
	const calls = [];
	const profile = defineStringProfile({
		...defaultStringProfile,
		id: "test.marker",
		layout: {
			markerSize: 3,
			saltRange: { min: 12, max: 12 },
			offset(input) {
				calls.push({ operation: "offset", ...input });
				return Math.floor(input.transformedLength / 2);
			},
			createMarker(input) {
				calls.push({ operation: "marker", ...input });
				return input.saltLength.toString(36).padStart(3, "0");
			}
		}
	});
	const envelope = fiseEncrypt("marker", profile);
	assert.equal(fiseDecrypt(envelope, profile), "marker");
	assert.ok(calls.every(call => typeof call.transformedLength === "number"));
	assert.ok(calls.every(call => call.saltLength === 12));
	assert.equal("decodeLength" in profile.layout, false);
});

test("profile validation rejects malformed identities, ranges and marker widths", () => {
	assert.throws(
		() => defineStringProfile({ ...defaultStringProfile, id: "not allowed!" }),
		{ code: "INVALID_PROFILE" }
	);
	assert.throws(
		() => defineStringProfile({
			...defaultStringProfile,
			id: "test.range",
			layout: { ...defaultStringProfile.layout, saltRange: { min: 0, max: 2 } }
		}),
		{ code: "INVALID_PROFILE" }
	);
	for (const saltRange of [
		null,
		Object.create({ min: 10, max: 12 }),
		{ min: 10, max: 12, typo: true }
	]) {
		assert.throws(
			() => defineStringProfile({
				...defaultStringProfile,
				id: "test.range-shape",
				layout: { ...defaultStringProfile.layout, saltRange }
			}),
			{ code: "INVALID_PROFILE" }
		);
	}
	assert.throws(
		() => defineStringProfile({
			...defaultStringProfile,
			id: "test.marker-width",
			layout: { ...defaultStringProfile.layout, markerSize: 0 }
		}),
		{ code: "INVALID_PROFILE" }
	);
	assert.throws(
		() => defineStringProfile({
			...defaultStringProfile,
			id: "test.context-mode",
			context: { timestamp: "sometimes" }
		}),
		{ code: "INVALID_PROFILE" }
	);
	assert.throws(
		() => defineStringProfile({
			...defaultStringProfile,
			id: "test.context-field",
			context: { metadata: { tenant: { type: "integer" } } }
		}),
		{ code: "INVALID_PROFILE" }
	);
	assert.throws(
		() => defineStringProfile({
			...defaultStringProfile,
			id: "test.bad-limits",
			limits: 10
		}),
		{ code: "INVALID_PROFILE" }
	);
	assert.throws(
		() => defineStringProfile({
			...defaultStringProfile,
			id: "test.context-unknown",
			context: { timestamp: "optional", typo: true }
		}),
		{ code: "INVALID_PROFILE" }
	);
	assert.throws(
		() => defineStringProfile({
			...defaultStringProfile,
			id: "test.context-prototype",
			context: {
				metadata: JSON.parse('{"__proto__":{"type":"number"}}')
			}
		}),
		{ code: "INVALID_PROFILE" }
	);
});

test("runtime rejects marker width drift and non-finite offsets", () => {
	const wrongMarker = defineStringProfile({
		...defaultStringProfile,
		id: "test.marker-drift",
		layout: {
			...defaultStringProfile.layout,
			createMarker() { return "x"; }
		}
	});
	assert.throws(() => fiseEncrypt("x", wrongMarker), { code: "INVALID_PROFILE" });

	const wrongOffset = defineStringProfile({
		...defaultStringProfile,
		id: "test.offset",
		layout: {
			...defaultStringProfile.layout,
			offset() { return Number.NaN; }
		}
	});
	assert.throws(() => fiseEncrypt("x", wrongOffset), { code: "INVALID_PROFILE" });
});

test("profile-level and caller envelope limits use the stricter bound", () => {
	const profile = defineStringProfile({
		...defaultStringProfile,
		id: "test.limit",
		limits: { maxEnvelopeLength: 1_000 }
	});
	const envelope = fiseEncrypt("bounded", profile);
	assert.equal(fiseDecrypt(envelope, profile), "bounded");
	assert.throws(
		() => fiseDecrypt(envelope, profile, { maxEnvelopeLength: envelope.length - 1 }),
		{ code: "ENVELOPE_LIMIT" }
	);
});

test("withBinaryBackend accepts only byte-compatible transform identity", () => {
	const backend = {
		id: xorBinaryCipher.id,
		encrypt: xorBinaryCipher.encrypt,
		decrypt: xorBinaryCipher.decrypt
	};
	const profile = withBinaryBackend(defaultBinaryProfile, backend);
	const input = Uint8Array.from([1, 2, 3]);
	assert.deepEqual(
		fiseBinaryDecrypt(fiseBinaryEncrypt(input, profile), profile),
		input
	);
	assert.throws(
		() => withBinaryBackend(defaultBinaryProfile, { ...backend, id: "other.transform" }),
		{ code: "TRANSFORM_MISMATCH" }
	);
	const reversibleButDifferent = {
		id: xorBinaryCipher.id,
		encrypt(input, salt) {
			const output = xorBinaryCipher.encrypt(input, salt);
			for (let index = 0; index < output.length; index++) output[index] ^= 0x5a;
			return output;
		},
		decrypt(input, salt) {
			const output = xorBinaryCipher.decrypt(input, salt);
			for (let index = 0; index < output.length; index++) output[index] ^= 0x5a;
			return output;
		}
	};
	assert.throws(
		() => withBinaryBackend(defaultBinaryProfile, reversibleButDifferent),
		{ code: "TRANSFORM_MISMATCH" }
	);
	const conditionalMismatch = {
		id: xorBinaryCipher.id,
		encrypt(input, salt) {
			if (input.length !== 2) return xorBinaryCipher.encrypt(input, salt);
			return Uint8Array.from([input[0], input[1] ^ salt[1 % salt.length]]);
		},
		decrypt(input, salt) {
			return this.encrypt(input, salt);
		}
	};
	assert.throws(
		() => withBinaryBackend(defaultBinaryProfile, conditionalMismatch),
		{ code: "TRANSFORM_MISMATCH" }
	);
	assert.throws(
		() => fiseBinaryEncrypt(Uint8Array.from([1, 2]), {
			...defaultBinaryProfile,
			transform: conditionalMismatch
		}),
		{ code: "TRANSFORM_MISMATCH" }
	);
});

test("representation mismatch is rejected before transform execution", () => {
	assert.throws(
		() => fiseEncrypt("x", defaultBinaryProfile),
		{ code: "INVALID_PROFILE" }
	);
	assert.throws(
		() => fiseBinaryEncrypt(new Uint8Array(), defaultStringProfile),
		{ code: "INVALID_PROFILE" }
	);
});

test("defineBinaryProfile validates transform ownership", () => {
	assert.throws(
		() => defineBinaryProfile({
			...defaultBinaryProfile,
			id: "test.transform",
			transform: { id: "bad id", encrypt() {}, decrypt() {} }
		}),
		{ code: "INVALID_PROFILE" }
	);
	const inheritedTransform = Object.create(xorBinaryCipher);
	assert.throws(
		() => defineBinaryProfile({
			...defaultBinaryProfile,
			id: "test.inherited-transform",
			transform: inheritedTransform
		}),
		{ code: "INVALID_PROFILE" }
	);
});

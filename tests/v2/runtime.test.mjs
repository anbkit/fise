import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";

import {
	Fise,
	FiseError,
	FISE_WIRE_VERSION,
	Profile
} from "fise";
import profileA from "./profile-a.generated.mjs";
import profileB from "./profile-b.generated.mjs";

test("one generated profile restores structured values and binary data", () => {
	const fise = new Fise(profileA);
	const context = [42, true, false, "ap"];
	const values = [
		null,
		true,
		42.5,
		"plain text and a lone surrogate \ud800",
		[1, "two", null, { ok: true }],
		{ z: 3, a: { y: 2, x: 1 } },
		new Uint8Array(),
		Uint8Array.from([0, 1, 2, 127, 128, 255])
	];

	for (const value of values) {
		const before = value instanceof Uint8Array ? value.slice() : structuredClone(value);
		const envelope = fise.encrypt(value, context);
		assert.ok(envelope instanceof Uint8Array);
		assert.notStrictEqual(envelope, value);
		assert.deepEqual(fise.decrypt(envelope, context), before);
		assert.deepEqual(value, before, "encrypt mutated caller input");
	}
	assert.equal(FISE_WIRE_VERSION.major, 2);
	assert.equal(FISE_WIRE_VERSION.minor, 0);
});

test("context is positional, deterministic, and changes the envelope", () => {
	const fise = new Fise(profileA);
	assert.deepEqual(fise.encrypt("default context"), fise.encrypt("default context", []));
	const value = { answer: 42 };
	const context = [2, "tenant", true];
	const envelope = fise.encrypt(value, context);
	assert.deepEqual(fise.encrypt(value, [...context]), envelope);
	assert.notDeepEqual(fise.encrypt(value, ["tenant", 2, true]), envelope);
	assert.deepEqual(fise.decrypt(envelope, [...context]), value);
	assert.throws(
		() => fise.decrypt(envelope, ["tenant", 2, true]),
		(error) => error instanceof FiseError && error.code === "MARKER_MISMATCH"
	);
});

test("wrong profile and wrong context fail closed", () => {
	const first = new Fise(profileA);
	const second = new Fise(profileB);
	const envelope = first.encrypt("payload", [1]);
	assert.throws(
		() => second.decrypt(envelope, [1]),
		(error) => error instanceof FiseError && error.code === "PROFILE_MISMATCH"
	);
	assert.throws(
		() => first.decrypt(envelope, [2]),
		(error) => error instanceof FiseError && error.code === "MARKER_MISMATCH"
	);
});

test("wire 2.0 rejects legacy versions, truncation, and trailing data", () => {
	const fise = new Fise(profileA);
	const envelope = fise.encrypt("strict");
	const legacy = envelope.slice();
	legacy[4] = 1;
	assert.throws(
		() => fise.decrypt(legacy),
		(error) => error instanceof FiseError && error.code === "UNSUPPORTED_VERSION"
	);
	assert.throws(
		() => fise.decrypt(envelope.slice(0, -1)),
		(error) => error instanceof FiseError && error.code === "LENGTH_MISMATCH"
	);
	const trailing = new Uint8Array(envelope.length + 1);
	trailing.set(envelope);
	assert.throws(
		() => fise.decrypt(trailing),
		(error) => error instanceof FiseError && error.code === "LENGTH_MISMATCH"
	);
});

test("payload metadata versions and data types are strict", () => {
	const passthrough = Profile.generated(
		"00112233445566778899aabbccddeeff",
		8,
		8,
		() => [0, 0, 0, 0],
		() => 0,
		() => 0x1234_5678,
		(input) => input.slice(),
		(input) => input.slice()
	);
	const fise = new Fise(passthrough);
	const envelope = fise.encrypt("metadata");

	const badVersion = envelope.slice();
	badVersion[36] = 99;
	assert.throws(
		() => fise.decrypt(badVersion),
		(error) => error instanceof FiseError && error.code === "INVALID_PAYLOAD"
	);

	const badType = envelope.slice();
	badType[37] = 99;
	assert.throws(
		() => fise.decrypt(badType),
		(error) => error instanceof FiseError && error.code === "INVALID_PAYLOAD"
	);
});

test("structured payloads must retain their canonical JSON representation", () => {
	const passthrough = Profile.generated(
		"ffeeddccbbaa99887766554433221100",
		8,
		8,
		() => [0, 0, 0, 0],
		() => 0,
		() => 0x8765_4321,
		(input) => input.slice(),
		(input) => input.slice()
	);
	const fise = new Fise(passthrough);
	const envelope = fise.encrypt({ a: 1, b: 2 });
	const nonCanonical = new TextEncoder().encode('{"b":2,"a":1}');
	envelope.set(nonCanonical, 38);
	assert.throws(
		() => fise.decrypt(envelope),
		(error) => error instanceof FiseError && error.code === "INVALID_PAYLOAD"
	);
});

test("structured data and positional context reject ambiguous JavaScript values", () => {
	const fise = new Fise(profileA);
	const crossRealmPlainObject = runInNewContext("({ a: 1, nested: { ok: true } })");
	const crossRealmPlainArray = runInNewContext("[1, { ok: true }]");
	assert.deepEqual(
		fise.decrypt(fise.encrypt(crossRealmPlainObject)),
		{ a: 1, nested: { ok: true } }
	);
	assert.deepEqual(fise.decrypt(fise.encrypt(crossRealmPlainArray)), [1, { ok: true }]);
	const cycle = {};
	cycle.self = cycle;
	const withGetter = {};
	Object.defineProperty(withGetter, "value", { enumerable: true, get: () => 1 });

	const inherited = Object.create(null);
	inherited.hidden = "not serialized";
	const customPrototype = Object.create(inherited);
	customPrototype.own = 9;
	const disguisedPrototype = Object.create(null);
	const disguisedConstructor = Object.bind(null);
	Object.defineProperty(disguisedConstructor, "name", { value: "Object" });
	Object.defineProperty(disguisedConstructor, "prototype", { value: disguisedPrototype });
	Object.defineProperty(disguisedPrototype, "constructor", {
		value: disguisedConstructor,
		enumerable: false
	});
	const disguisedObject = Object.create(disguisedPrototype);
	disguisedObject.own = 10;
	const spoofTargetPrototype = Object.create(null);
	spoofTargetPrototype.hidden = "not serialized";
	const spoofTarget = Object.create(spoofTargetPrototype);
	spoofTarget.own = 11;
	const proxySpoof = new Proxy(spoofTarget, {
		getPrototypeOf: () => Object.prototype
	});
	const arrayPrototype = Object.create(Array.prototype);
	arrayPrototype.hidden = "not serialized";
	const customPrototypeArray = [1, 2];
	Object.setPrototypeOf(customPrototypeArray, arrayPrototype);
	for (const value of [
		undefined,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		-0,
		1n,
		new Date(),
		cycle,
		withGetter,
		customPrototype,
		disguisedObject,
		proxySpoof,
		customPrototypeArray
	]) {
		assert.throws(() => fise.encrypt(value), FiseError);
	}
	assert.throws(() => fise.encrypt({ nested: new Uint8Array([1]) }), FiseError);

	const sparse = [];
	sparse.length = 1;
	const accessor = [];
	Object.defineProperty(accessor, "0", { enumerable: true, get: () => 1 });
	accessor.length = 1;
	const customProperty = [1];
	customProperty.label = "hidden semantics";
	const customContextPrototype = Object.create(Array.prototype);
	customContextPrototype.hidden = "not serialized";
	const customPrototypeContext = [1];
	Object.setPrototypeOf(customPrototypeContext, customContextPrototype);
	for (const context of [
		{},
		"tenant",
		1,
		[{}],
		[[1]],
		[Number.NaN],
		[-0],
		sparse,
		accessor,
		customProperty,
		customPrototypeContext,
		withGetter
	]) {
		assert.throws(
			() => fise.encrypt("value", context),
			(error) => error instanceof FiseError && error.code === "INVALID_CONTEXT"
		);
	}
});

test("profile callbacks receive the frozen positional context snapshot", () => {
	const observed = [];
	const observedSegments = [];
	let observedEncoding;
	const capture = (phase, context) => {
		observed.push([phase, context]);
		assert.equal(Object.isFrozen(context), true);
	};
	const profile = Profile.generated(
		"102132435465768798a9bacbdcedfe0f",
		13,
		12,
		(encoded, context) => {
			capture("mix", context);
			observedEncoding = encoded.slice();
			return [0, 0, 0, 0];
		},
		(_layout, _state, segment, context) => {
			capture("offset", context);
			observedSegments.push(segment.slice());
			return 0;
		},
		(_layout, _state, segment, context) => {
			capture("marker", context);
			observedSegments.push(segment.slice());
			return Number(context[0] ?? 0) >>> 0;
		},
		(input, segment, _state, _absoluteOffset, context) => {
			capture("forward", context);
			observedSegments.push(segment.slice());
			return input.map(byte => byte ^ (Number(context[0] ?? 0) & 0xff));
		},
		(input, segment, _state, _absoluteOffset, context) => {
			capture("reverse", context);
			observedSegments.push(segment.slice());
			return input.map(byte => byte ^ (Number(context[0] ?? 0) & 0xff));
		}
	);
	observed.length = 0;
	observedSegments.length = 0;
	observedEncoding = undefined;
	const fise = new Fise(profile);
	const callerContext = [23, "route"];
	const envelope = fise.encrypt("callback", callerContext);
	callerContext[0] = 99;
	assert.equal(fise.decrypt(envelope, [23, "route"]), "callback");
	assert.deepEqual(new Set(observed.map(([phase]) => phase)), new Set([
		"mix",
		"offset",
		"marker",
		"forward",
		"reverse"
	]));
	for (const [, context] of observed) assert.deepEqual(context, [23, "route"]);
	const expectedEncoding = new TextEncoder().encode("WzIzLCJyb3V0ZSJd");
	assert.deepEqual(observedEncoding, expectedEncoding);
	const expectedSegment = Uint8Array.from(
		{ length: 12 },
		(_, index) => expectedEncoding[(13 + index) % expectedEncoding.length]
	);
	for (const segment of observedSegments) assert.deepEqual(segment, expectedSegment);
});

test("Profile and Fise instances are immutable and profile-bound", () => {
	const fise = new Fise(profileA);
	assert.ok(profileA instanceof Profile);
	assert.ok(Object.isFrozen(profileA));
	assert.ok(Object.isFrozen(fise));
	assert.equal(fise.profile, profileA);
	assert.throws(() => new Fise({}), FiseError);
	assert.throws(
		() => new Profile({}),
		(error) => error instanceof FiseError && error.code === "INVALID_PROFILE"
	);
});

test("generated context mixers must return four dense own uint32 lanes", () => {
	const sparseMixer = () => {
		const lanes = new Array(4);
		lanes[0] = 0;
		lanes[1] = 1;
		lanes[3] = 3;
		return lanes;
	};
	assert.throws(
		() => Profile.generated(
			"1234567890abcdef1234567890abcdef",
			0,
			8,
			sparseMixer,
			() => 0,
			() => 0,
			input => input.slice(),
			input => input.slice()
		),
		(error) => error instanceof FiseError && error.code === "INVALID_PROFILE"
	);
});

test("decrypt validates and snapshots the envelope before context callbacks", () => {
	const fise = new Fise(profileA);
	assert.throws(
		() => fise.decrypt(new Uint8Array(), {}),
		(error) => error instanceof FiseError && error.code === "INVALID_ENVELOPE"
	);

	class HostileEnvelope extends Uint8Array {
		get length() {
			throw new Error("caller-owned length getter must not run");
		}

		subarray() {
			throw new Error("caller-owned subarray must not run");
		}
	}
	const envelope = new HostileEnvelope(fise.encrypt("owned bytes"));
	assert.equal(fise.decrypt(envelope), "owned bytes");
	const binary = new HostileEnvelope([1, 2, 3]);
	assert.deepEqual(fise.decrypt(fise.encrypt(binary)), Uint8Array.of(1, 2, 3));
	const framed = new HostileEnvelope(fise.encryptFramed(binary, [], { frameSize: 2 }));
	assert.deepEqual(fise.decryptFramed(framed), Uint8Array.of(1, 2, 3));
});

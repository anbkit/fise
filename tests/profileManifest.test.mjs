import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
	canonicalJson,
	compileFiseProfileManifest,
	createFiseProfileArtifact,
	createFiseProfileRotationArtifact,
	createManifestConformanceVector,
	defaultBinaryProfile,
	defaultStringProfile,
	defineBinaryProfile,
	defineStringProfile,
	fiseBinaryDecrypt,
	fiseBinaryEncrypt,
	fiseDecrypt,
	fiseEncrypt,
	validateFiseProfileContract,
	xorBinaryCipher,
	xorCipher
} from "fise";

const stringManifest = {
	schema: "fise.profile/1",
	name: "example.catalog",
	revision: 1,
	representation: "string",
	transform: "xor-utf16-v1",
	saltRange: { min: 10, max: 12 },
	marker: {
		kind: "base-n",
		alphabet: "0123456789abcdefghijklmnopqrstuvwxyz",
		width: 2
	},
	offset: {
		kind: "affine",
		lengthMultiplier: 7,
		timestampModulo: 11
	}
};

test("manifest compiler creates a deterministic canonical profile", async () => {
	const first = await compileFiseProfileManifest(stringManifest);
	const reordered = await compileFiseProfileManifest({
		offset: { timestampModulo: 11, lengthMultiplier: 7, kind: "affine" },
		marker: { width: 2, alphabet: "0123456789abcdefghijklmnopqrstuvwxyz", kind: "base-n" },
		transform: "xor-utf16-v1",
		representation: "string",
		revision: 1,
		name: "example.catalog",
		saltRange: { max: 12, min: 10 },
		schema: "fise.profile/1"
	});
	assert.equal(first.digest, reordered.digest);
	assert.equal(first.profileId, reordered.profileId);
	assert.match(first.profileId, /^example\.catalog\.v1\.[0-9a-f]{32}$/);
	assert.equal(first.profile.manifestDigest, first.digest);
	const envelope = fiseEncrypt("compiled", first.profile, { timestamp: 3 });
	assert.equal(fiseDecrypt(envelope, first.profile, { timestamp: 3 }), "compiled");
});

test("manifest compiler rejects accessors and invalid public arguments", async () => {
	let revisionReads = 0;
	const accessorManifest = { ...stringManifest };
	Object.defineProperty(accessorManifest, "revision", {
		enumerable: true,
		get() {
			revisionReads++;
			return revisionReads < 3 ? 1 : -5;
		}
	});
	await assert.rejects(
		compileFiseProfileManifest(accessorManifest),
		{ code: "INVALID_PROFILE" }
	);
	assert.equal(revisionReads, 0);
	await assert.rejects(
		compileFiseProfileManifest(stringManifest, null),
		{ code: "INVALID_INPUT" }
	);
	assert.throws(() => validateFiseProfileContract(null), {
		code: "INVALID_PROFILE"
	});

	let canonicalReads = 0;
	const accessorValue = {};
	Object.defineProperty(accessorValue, "value", {
		enumerable: true,
		get() {
			canonicalReads++;
			return 1;
		}
	});
	assert.throws(() => canonicalJson(accessorValue), { code: "INVALID_PROFILE" });
	assert.equal(canonicalReads, 0);
});

test("manifest identity normalizes metadata object and affine-term order", async () => {
	const base = {
		...stringManifest,
		name: "example.order",
		context: {
			metadata: {
				alpha: { type: "number", required: true },
				beta: { type: "number", required: true }
			}
		},
		offset: {
			kind: "affine",
			metadataTerms: [
				{ key: "alpha", multiplier: 3 },
				{ key: "beta", multiplier: 5 }
			]
		}
	};
	const reordered = {
		...base,
		context: {
			metadata: {
				beta: { required: true, type: "number" },
				alpha: { required: true, type: "number" }
			}
		},
		offset: {
			kind: "affine",
			metadataTerms: [...base.offset.metadataTerms].reverse()
		}
	};
	const first = await compileFiseProfileManifest(base);
	const second = await compileFiseProfileManifest(reordered);
	assert.equal(first.canonicalManifest, second.canonicalManifest);
	assert.equal(first.profileId, second.profileId);
});

test("canonical JSON rejects non-JSON values", () => {
	assert.equal(canonicalJson({ z: 1, a: 2 }), '{"a":2,"z":1}');
	for (const value of [
		{ value: Number.NaN },
		new Date(0),
		new Array(1)
	]) {
		assert.throws(() => canonicalJson(value), { code: "INVALID_PROFILE" });
	}
	const cyclic = {};
	cyclic.self = cyclic;
	assert.throws(() => canonicalJson(cyclic), { code: "INVALID_PROFILE" });
});

test("manifest change produces a new identity and rotation artifact", async () => {
	const next = {
		...stringManifest,
		revision: 2,
		offset: { ...stringManifest.offset, lengthMultiplier: 13 }
	};
	const rotation = await createFiseProfileRotationArtifact(stringManifest, next);
	assert.notEqual(rotation.fromProfileId, rotation.toProfileId);
	assert.ok(rotation.changedPaths.includes("revision"));
	assert.ok(rotation.changedPaths.includes("offset.lengthMultiplier"));
	assert.equal(rotation.requiresAtomicRollout, true);
	assert.equal(rotation.legacyFallback, false);
	assert.equal(Object.isFrozen(rotation), true);
	assert.equal(Object.isFrozen(rotation.wireVersion), true);
	assert.equal(Object.isFrozen(rotation.changedPaths), true);
});

test("full contract validation checks every salt length", async () => {
	const compiled = await compileFiseProfileManifest(stringManifest);
	const report = validateFiseProfileContract(compiled.profile);
	assert.deepEqual(report, {
		profileId: compiled.profileId,
		representation: "string",
		transformId: "fise.xor.utf16.v1",
		transformCasesChecked: 4,
		saltLengthsChecked: 3,
		layoutCasesChecked: 12,
		valid: true
	});
});

test("contract validation normalizes layout callback failures", () => {
	const profile = defineStringProfile({
		...defaultStringProfile,
		id: "example.throwing-layout",
		layout: {
			...defaultStringProfile.layout,
			createMarker() {
				throw new Error("callback detail");
			}
		}
	});
	assert.throws(() => validateFiseProfileContract(profile), {
		code: "INVALID_PROFILE"
	});
});

test("manifest artifact and conformance vector are deterministic", async () => {
	const compiled = await compileFiseProfileManifest(stringManifest);
	const artifact = createFiseProfileArtifact(compiled);
	const first = createManifestConformanceVector(compiled);
	const second = createManifestConformanceVector(compiled);
	assert.equal(artifact.schema, "fise.profile-artifact/1");
	assert.equal(artifact.digest, compiled.digest);
	assert.deepEqual(first, second);
});

test("normalized manifests and artifacts are deeply immutable", async () => {
	const input = {
		...stringManifest,
		name: "example.immutable",
		context: {
			metadata: { tenant: { type: "number", required: true } }
		},
		offset: {
			kind: "affine",
			constant: 3,
			metadataTerms: [{ key: "tenant", multiplier: 7 }]
		}
	};
	const compiled = await compileFiseProfileManifest(input);
	const artifact = createFiseProfileArtifact(compiled);
	const options = { metadata: { tenant: 11 } };
	const envelope = fiseEncrypt("immutable", compiled.profile, options);

	for (const value of [
		compiled,
		compiled.manifest,
		compiled.manifest.saltRange,
		compiled.manifest.marker,
		compiled.manifest.offset,
		compiled.manifest.offset.metadataTerms,
		compiled.manifest.offset.metadataTerms[0],
		compiled.manifest.context,
		compiled.manifest.context.metadata,
		compiled.manifest.context.metadata.tenant,
		compiled.manifest.limits,
		artifact,
		artifact.wireVersion
	]) {
		assert.equal(Object.isFrozen(value), true);
	}
	assert.equal(artifact.manifest, compiled.manifest);
	assert.throws(() => {
		compiled.manifest.offset.constant = 99;
	}, TypeError);
	assert.throws(() => {
		artifact.manifest.context.metadata.tenant.required = false;
	}, TypeError);

	input.offset.constant = 99;
	input.offset.metadataTerms[0].multiplier = 99;
	assert.equal(compiled.manifest.offset.constant, 3);
	assert.equal(compiled.manifest.offset.metadataTerms[0].multiplier, 7);
	assert.equal(fiseDecrypt(envelope, compiled.profile, options), "immutable");
});

test("manifest numeric fields reject coercible non-numbers", async () => {
	for (const saltRange of [
		{ min: "10", max: 12 },
		{ min: 10, max: "12" },
		{ min: true, max: 12 }
	]) {
		await assert.rejects(
			compileFiseProfileManifest({ ...stringManifest, saltRange }),
			{ code: "INVALID_PROFILE" }
		);
	}
	for (const width of ["2", true]) {
		await assert.rejects(
			compileFiseProfileManifest({
				...stringManifest,
				marker: { ...stringManifest.marker, width }
			}),
			{ code: "INVALID_PROFILE" }
		);
		await assert.rejects(
			compileFiseProfileManifest({
				schema: "fise.profile/1",
				name: "example.strict-binary",
				revision: 1,
				representation: "binary",
				transform: "xor-u8-v1",
				marker: { kind: "uint-be", width },
				offset: { kind: "affine" }
			}),
			{ code: "INVALID_PROFILE" }
		);
	}
});

test("manifest backends and contract reports certify transform semantics", async () => {
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
	const binaryManifest = {
		schema: "fise.profile/1",
		name: "example.semantic-binary",
		revision: 1,
		representation: "binary",
		transform: "xor-u8-v1",
		marker: { kind: "uint-be", width: 2 },
		offset: { kind: "affine" }
	};
	await assert.rejects(
		compileFiseProfileManifest(binaryManifest, {
			binaryBackend: reversibleButDifferent
		}),
		{ code: "TRANSFORM_MISMATCH" }
	);

	assert.throws(() => defineBinaryProfile({
		...defaultBinaryProfile,
		id: "example.semantic-fake",
		transform: reversibleButDifferent
	}), { code: "TRANSFORM_MISMATCH" });
	const fakeProfile = {
		...defaultBinaryProfile,
		id: "example.semantic-fake",
		transform: reversibleButDifferent
	};
	assert.throws(
		() => validateFiseProfileContract(fakeProfile),
		{ code: "TRANSFORM_MISMATCH" }
	);
});

test("custom transforms are validated within their declared salt range", () => {
	const binaryTransform = {
		id: "example.custom.u8.v1",
		encrypt(input, salt) {
			if (salt.length !== 2) throw new Error("salt length must be two");
			return xorBinaryCipher.encrypt(input, salt);
		},
		decrypt(input, salt) {
			if (salt.length !== 2) throw new Error("salt length must be two");
			return xorBinaryCipher.decrypt(input, salt);
		}
	};
	const binaryProfile = defineBinaryProfile({
		...defaultBinaryProfile,
		id: "example.custom.binary",
		transform: binaryTransform,
		layout: {
			...defaultBinaryProfile.layout,
			saltRange: { min: 2, max: 2 }
		}
	});
	assert.equal(validateFiseProfileContract(binaryProfile).transformCasesChecked, 4);
	const binaryInput = Uint8Array.from([1, 2, 3]);
	assert.deepEqual(
		fiseBinaryDecrypt(fiseBinaryEncrypt(binaryInput, binaryProfile), binaryProfile),
		binaryInput
	);

	const stringTransform = {
		id: "example.custom.utf16.v1",
		encrypt(input, salt) {
			if (salt.length !== 2) throw new Error("salt length must be two");
			return xorCipher.encrypt(input, salt);
		},
		decrypt(input, salt) {
			if (salt.length !== 2) throw new Error("salt length must be two");
			return xorCipher.decrypt(input, salt);
		}
	};
	const stringProfile = defineStringProfile({
		...defaultStringProfile,
		id: "example.custom.string",
		transform: stringTransform,
		layout: {
			...defaultStringProfile.layout,
			saltRange: { min: 2, max: 2 }
		}
	});
	assert.equal(validateFiseProfileContract(stringProfile).transformCasesChecked, 4);
	assert.equal(
		fiseDecrypt(fiseEncrypt("custom", stringProfile), stringProfile),
		"custom"
	);
});

test("binary manifests support uint-be markers", async () => {
	const compiled = await compileFiseProfileManifest({
		schema: "fise.profile/1",
		name: "example.assets",
		revision: 4,
		representation: "binary",
		transform: "xor-u8-v1",
		saltRange: { min: 1, max: 65535 },
		marker: { kind: "uint-be", width: 2 },
		offset: { kind: "affine", lengthMultiplier: 5, saltMultiplier: 3 }
	});
	assert.equal(compiled.profile.representation, "binary");
	const report = validateFiseProfileContract(compiled.profile);
	assert.equal(report.saltLengthsChecked, 65535);
	assert.equal(report.layoutCasesChecked, 262140);
});

test("manifest compiler rejects unknown fields and insufficient marker capacity", async () => {
	await assert.rejects(
		compileFiseProfileManifest({ ...stringManifest, surprise: true }),
		{ code: "INVALID_PROFILE" }
	);
	await assert.rejects(
		compileFiseProfileManifest({
			...stringManifest,
			saltRange: { min: 10, max: 99 },
			marker: { kind: "base-n", alphabet: "01", width: 2 }
		}),
		{ code: "INVALID_PROFILE" }
	);
});

test("required numeric context can drive a compiled offset", async () => {
	const compiled = await compileFiseProfileManifest({
		...stringManifest,
		name: "example.context",
		context: {
			timestamp: "required",
			metadata: { tenant: { type: "number", required: true } }
		},
		offset: {
			kind: "affine",
			lengthMultiplier: 7,
			timestampModulo: 11,
			metadataTerms: [{ key: "tenant", multiplier: 3, modulo: 17 }]
		}
	});
	const options = { timestamp: 9, metadata: { tenant: 5 } };
	const envelope = fiseEncrypt("context", compiled.profile, options);
	assert.equal(fiseDecrypt(envelope, compiled.profile, options), "context");
	assert.throws(
		() => fiseDecrypt(envelope, compiled.profile, { timestamp: 9, metadata: { tenant: 6 } }),
		{ code: "MARKER_MISMATCH" }
	);
});

test("CLI validates, builds, vectors and diffs fixture manifests", () => {
	const cli = new URL("../dist/cli.js", import.meta.url).pathname;
	const first = new URL("./fixtures/profile-string-v1.json", import.meta.url).pathname;
	const second = new URL("./fixtures/profile-string-v2.json", import.meta.url).pathname;
	for (const [command, args] of [
		["validate", [first]],
		["build", [first]],
		["vectors", [first]],
		["diff", [first, second]]
	]) {
		const result = spawnSync(process.execPath, [cli, "profile", command, ...args], {
			encoding: "utf8"
		});
		assert.equal(result.status, 0, result.stderr);
		assert.doesNotThrow(() => JSON.parse(result.stdout));
	}
});

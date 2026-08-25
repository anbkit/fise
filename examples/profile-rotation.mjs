import assert from "node:assert/strict";

import {
	compileFiseProfileManifest,
	createFiseProfileArtifact,
	createFiseProfileRotationArtifact,
	createManifestConformanceVector
} from "fise/profiles";

const deployedManifest = {
	schema: "fise.profile/1",
	name: "example.catalog",
	revision: 1,
	representation: "binary",
	transform: "xor-u8-v1",
	saltRange: { min: 16, max: 24 },
	marker: { kind: "uint-be", width: 2 },
	offset: {
		kind: "affine",
		lengthMultiplier: 7,
		saltMultiplier: 3
	},
	limits: { maxEnvelopeLength: 1_000_000 }
};
const nextManifest = {
	...deployedManifest,
	revision: 2,
	offset: {
		...deployedManifest.offset,
		lengthMultiplier: 13
	}
};

const deployed = await compileFiseProfileManifest(deployedManifest);
const next = await compileFiseProfileManifest(nextManifest);
const rotation = await createFiseProfileRotationArtifact(
	deployedManifest,
	nextManifest
);
const artifact = createFiseProfileArtifact(next);
const vector = createManifestConformanceVector(next);

assert.notEqual(deployed.profileId, next.profileId);
assert.equal(artifact.profileId, next.profileId);
assert.equal(vector.profileId, next.profileId);
assert.equal(rotation.requiresAtomicRollout, true);
assert.equal(rotation.legacyFallback, false);
assert.ok(rotation.changedPaths.includes("revision"));
assert.ok(rotation.changedPaths.includes("offset.lengthMultiplier"));

console.log("PASS profile-rotation: artifact + vector + atomic no-fallback diff");

import {
	validateBinaryProfileDefinition,
	validateSaltRange,
	validateStringProfileDefinition
} from "./core/profileValidation.js";
import { assertBinaryCipherCompatibility } from "./core/transformConformance.js";
import {
	assertBuiltInBinaryCipherImplementation,
	snapshotBinaryCipher
} from "./core/transformRegistry.js";
import { FiseError } from "./errors.js";
import {
	FiseBinaryCipher,
	FiseBinaryProfile,
	FiseStringProfile
} from "./types.js";
import {
	snapshotBinaryProfile,
	snapshotStringProfile
} from "./core/profileSnapshot.js";

/** Validates and freezes a string profile as one compatibility unit. */
export function defineStringProfile(profile: FiseStringProfile): FiseStringProfile {
	validateStringProfileDefinition(profile);
	const ownedProfile = snapshotStringProfile(profile);
	if (ownedProfile !== profile) validateStringProfileDefinition(ownedProfile);
	return ownedProfile;
}

/** Validates and freezes a binary profile as one compatibility unit. */
export function defineBinaryProfile(profile: FiseBinaryProfile): FiseBinaryProfile {
	validateBinaryProfileDefinition(profile);
	const ownedProfile = snapshotBinaryProfile(profile);
	if (ownedProfile !== profile) validateBinaryProfileDefinition(ownedProfile);
	return ownedProfile;
}

/**
 * Selects a byte-compatible implementation backend without changing profile
 * identity. A backend with different transform semantics is rejected.
 */
export function withBinaryBackend(
	profile: FiseBinaryProfile,
	backend: FiseBinaryCipher
): FiseBinaryProfile {
	validateBinaryProfileDefinition(profile);
	if (!backend || typeof backend !== "object" || backend.id !== profile.transform.id) {
		throw new FiseError(
			"TRANSFORM_MISMATCH",
			`FISE: backend transform '${backend?.id ?? "unknown"}' does not match profile transform '${profile.transform.id}'.`
		);
	}
	const backendSnapshot = snapshotBinaryCipher(backend);
	assertBuiltInBinaryCipherImplementation(backendSnapshot);
	assertBinaryCipherCompatibility(
		profile.transform,
		backendSnapshot,
		validateSaltRange(profile.layout.saltRange)
	);
	return defineBinaryProfile({
		...profile,
		transform: backendSnapshot
	});
}

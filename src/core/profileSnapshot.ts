import {
	FiseBinaryProfile,
	FiseContextContract,
	FiseStringProfile
} from "../types.js";

const ownedStringProfiles = new WeakSet<object>();
const ownedBinaryProfiles = new WeakSet<object>();

/** Captures an immutable operational owner for one string-profile call. */
export function snapshotStringProfile(
	profile: FiseStringProfile
): FiseStringProfile {
	if (ownedStringProfiles.has(profile)) return profile;
	const layout = profile.layout;
	const transform = profile.transform;
	const saltRange = layout.saltRange;
	const limits = profile.limits;
	const ownedProfile = Object.freeze({
		id: profile.id,
		representation: "string" as const,
		layout: Object.freeze({
			markerSize: layout.markerSize,
			saltRange: saltRange
				? Object.freeze({
					min: saltRange.min,
					max: saltRange.max
				})
				: undefined,
			offset: layout.offset,
			createMarker: layout.createMarker
		}),
		transform: Object.freeze({
			id: transform.id,
			encrypt: transform.encrypt,
			decrypt: transform.decrypt
		}),
		context: snapshotContext(profile.context),
		limits: limits
			? Object.freeze({ maxEnvelopeLength: limits.maxEnvelopeLength })
			: undefined,
		manifestDigest: profile.manifestDigest
	});
	ownedStringProfiles.add(ownedProfile);
	return ownedProfile;
}

/** Captures an immutable operational owner for one binary-profile call. */
export function snapshotBinaryProfile(
	profile: FiseBinaryProfile
): FiseBinaryProfile {
	if (ownedBinaryProfiles.has(profile)) return profile;
	const layout = profile.layout;
	const transform = profile.transform;
	const saltRange = layout.saltRange;
	const limits = profile.limits;
	const ownedProfile = Object.freeze({
		id: profile.id,
		representation: "binary" as const,
		layout: Object.freeze({
			markerSize: layout.markerSize,
			saltRange: saltRange
				? Object.freeze({
					min: saltRange.min,
					max: saltRange.max
				})
				: undefined,
			offset: layout.offset,
			createMarker: layout.createMarker
		}),
		transform: Object.freeze({
			id: transform.id,
			encrypt: transform.encrypt,
			decrypt: transform.decrypt
		}),
		context: snapshotContext(profile.context),
		limits: limits
			? Object.freeze({ maxEnvelopeLength: limits.maxEnvelopeLength })
			: undefined,
		manifestDigest: profile.manifestDigest
	});
	ownedBinaryProfiles.add(ownedProfile);
	return ownedProfile;
}

function snapshotContext(
	context: FiseContextContract | undefined
): FiseContextContract | undefined {
	if (!context) return context;
	const timestamp = context.timestamp;
	const metadataSource = context.metadata;
	const allowAdditionalMetadata = context.allowAdditionalMetadata;
	const metadata = metadataSource
		? Object.freeze(Object.fromEntries(
			Object.entries(metadataSource).map(([key, field]) => [
				key,
				Object.freeze({ type: field.type, required: field.required })
			])
		))
		: undefined;
	return Object.freeze({
		timestamp,
		metadata,
		allowAdditionalMetadata
	});
}

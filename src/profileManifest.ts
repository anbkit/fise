import { FISE_WIRE_VERSION } from "./core/constants.js";
import {
	assertBuiltInBinaryCipherImplementation,
	snapshotBinaryCipher
} from "./core/transformRegistry.js";
import { normalizeOffset } from "./core/normalizeOffset.js";
import {
	normalizeBinaryProfile,
	normalizeStringProfile,
	validateMarkerSize,
	validateProfileId,
	validateSaltRange
} from "./core/profileValidation.js";
import { xorBinaryCipher } from "./core/xorBinaryCipher.js";
import { xorCipher } from "./core/xorCipher.js";
import {
	assertBinaryCipherCompatibility,
	validateProfileTransform
} from "./core/transformConformance.js";
import { FiseError } from "./errors.js";
import { fiseBinaryEncryptWithSalt } from "./fiseBinaryEncrypt.js";
import { fiseEncryptWithSalt } from "./fiseEncrypt.js";
import { defineBinaryProfile, defineStringProfile } from "./profile.js";
import { isUint8ArrayValue } from "./core/valueValidation.js";
import {
	EncryptOptions,
	FiseBinaryCipher,
	FiseBinaryProfile,
	FiseContext,
	FiseContextContract,
	FiseContextFieldContract,
	FiseLayoutInput,
	FiseProfile,
	FiseStringProfile
} from "./types.js";

export const FISE_PROFILE_MANIFEST_SCHEMA = "fise.profile/1" as const;
export const FISE_PROFILE_ARTIFACT_SCHEMA = "fise.profile-artifact/1" as const;
export const FISE_PROFILE_ROTATION_SCHEMA = "fise.profile-rotation/1" as const;

export type FiseManifestTransform = "xor-utf16-v1" | "xor-u8-v1";

export interface FiseBaseNMarkerManifest {
	readonly kind: "base-n";
	readonly alphabet: string;
	readonly width: number;
}

export interface FiseUnsignedMarkerManifest {
	readonly kind: "uint-be";
	readonly width: number;
}

export type FiseMarkerManifest =
	| FiseBaseNMarkerManifest
	| FiseUnsignedMarkerManifest;

export interface FiseOffsetMetadataTermManifest {
	readonly key: string;
	readonly multiplier: number;
	readonly modulo?: number;
}

export interface FiseAffineOffsetManifest {
	readonly kind: "affine";
	readonly lengthMultiplier?: number;
	readonly saltMultiplier?: number;
	readonly constant?: number;
	readonly timestampModulo?: number;
	readonly metadataTerms?: readonly FiseOffsetMetadataTermManifest[];
}

export interface FiseProfileManifest {
	readonly schema: typeof FISE_PROFILE_MANIFEST_SCHEMA;
	readonly name: string;
	readonly revision: number;
	readonly representation: "string" | "binary";
	readonly transform: FiseManifestTransform;
	readonly saltRange?: Readonly<{ min: number; max: number }>;
	readonly marker: FiseMarkerManifest;
	readonly offset: FiseAffineOffsetManifest;
	readonly context?: FiseContextContract;
	readonly limits?: Readonly<{ maxEnvelopeLength?: number }>;
}

export interface NormalizedFiseProfileManifest {
	readonly schema: typeof FISE_PROFILE_MANIFEST_SCHEMA;
	readonly name: string;
	readonly revision: number;
	readonly representation: "string" | "binary";
	readonly transform: FiseManifestTransform;
	readonly saltRange: Readonly<{ min: number; max: number }>;
	readonly marker:
		| Readonly<{ kind: "base-n"; alphabet: string; width: number }>
		| Readonly<{ kind: "uint-be"; width: number }>;
	readonly offset: Readonly<{
		kind: "affine";
		lengthMultiplier: number;
		saltMultiplier: number;
		constant: number;
		timestampModulo: number | null;
		metadataTerms: readonly Readonly<{
			key: string;
			multiplier: number;
			modulo: number | null;
		}>[];
	}>;
	readonly context: Readonly<{
		timestamp: "optional" | "required" | "forbidden";
		metadata: Readonly<Record<string, Readonly<{
			type: "string" | "number" | "boolean";
			required: boolean;
		}>>>;
		allowAdditionalMetadata: boolean;
	}>;
	readonly limits: Readonly<{ maxEnvelopeLength: number | null }>;
}

export interface CompiledFiseProfile {
	readonly profile: FiseProfile;
	readonly manifest: NormalizedFiseProfileManifest;
	readonly canonicalManifest: string;
	readonly digest: string;
	readonly profileId: string;
}

export interface FiseProfileArtifact {
	readonly schema: typeof FISE_PROFILE_ARTIFACT_SCHEMA;
	readonly wireVersion: Readonly<{ major: number; minor: number }>;
	readonly profileId: string;
	readonly digestAlgorithm: "sha256";
	readonly digest: string;
	readonly manifest: NormalizedFiseProfileManifest;
}

export interface FiseProfileValidationReport {
	readonly profileId: string;
	readonly representation: "string" | "binary";
	readonly transformId: string;
	readonly transformCasesChecked: number;
	readonly saltLengthsChecked: number;
	readonly layoutCasesChecked: number;
	readonly valid: true;
}

export interface FiseProfileRotationArtifact {
	readonly schema: typeof FISE_PROFILE_ROTATION_SCHEMA;
	readonly wireVersion: Readonly<{ major: number; minor: number }>;
	readonly fromProfileId: string;
	readonly toProfileId: string;
	readonly fromDigest: string;
	readonly toDigest: string;
	readonly changedPaths: readonly string[];
	readonly representationCompatible: boolean;
	readonly profileCompatible: boolean;
	readonly requiresAtomicRollout: boolean;
	readonly legacyFallback: false;
}

export interface CompileFiseProfileOptions {
	readonly binaryBackend?: FiseBinaryCipher;
}

export async function compileFiseProfileManifest(
	input: unknown,
	options: CompileFiseProfileOptions = {}
): Promise<CompiledFiseProfile> {
	const ownedOptions = normalizeCompileOptions(options);
	const manifest = normalizeFiseProfileManifest(input);
	const canonicalManifest = canonicalJson(manifest);
	const digest = await sha256Hex(canonicalManifest);
	const profileId = createCompiledProfileId(manifest.name, manifest.revision, digest);
	const profile = createProfileFromManifest(manifest, profileId, digest, ownedOptions);
	return Object.freeze({ profile, manifest, canonicalManifest, digest, profileId });
}

export function normalizeFiseProfileManifest(
	input: unknown
): NormalizedFiseProfileManifest {
	const source = asRecord(input, "manifest");
	assertKnownKeys(source, [
		"schema",
		"name",
		"revision",
		"representation",
		"transform",
		"saltRange",
		"marker",
		"offset",
		"context",
		"limits"
	], "manifest");
	if (source.schema !== FISE_PROFILE_MANIFEST_SCHEMA) {
		throw invalidManifest(`schema must be '${FISE_PROFILE_MANIFEST_SCHEMA}'`);
	}
	if (typeof source.name !== "string") throw invalidManifest("name must be a string");
	validateProfileId(source.name);
	if (!Number.isSafeInteger(source.revision) || Number(source.revision) < 1) {
		throw invalidManifest("revision must be a positive safe integer");
	}
	if (source.representation !== "string" && source.representation !== "binary") {
		throw invalidManifest("representation must be 'string' or 'binary'");
	}
	if (source.transform !== "xor-utf16-v1" && source.transform !== "xor-u8-v1") {
		throw invalidManifest("transform is not supported by the profile compiler");
	}
	if (
		(source.representation === "string" && source.transform !== "xor-utf16-v1") ||
		(source.representation === "binary" && source.transform !== "xor-u8-v1")
	) {
		throw invalidManifest("transform does not match representation");
	}

	const saltRange = normalizeSaltRange(source.saltRange);
	const context = normalizeContextContract(source.context);
	const marker = normalizeMarker(source.marker, source.representation, saltRange.max);
	const offset = normalizeOffsetManifest(source.offset, context);
	const limits = normalizeLimits(source.limits);

	return freezeNormalizedManifest({
		schema: FISE_PROFILE_MANIFEST_SCHEMA,
		name: source.name,
		revision: Number(source.revision),
		representation: source.representation,
		transform: source.transform,
		saltRange,
		marker,
		offset,
		context,
		limits
	});
}

function freezeNormalizedManifest(
	manifest: NormalizedFiseProfileManifest
): NormalizedFiseProfileManifest {
	Object.freeze(manifest.saltRange);
	Object.freeze(manifest.marker);
	for (const term of manifest.offset.metadataTerms) Object.freeze(term);
	Object.freeze(manifest.offset.metadataTerms);
	Object.freeze(manifest.offset);
	for (const field of Object.values(manifest.context.metadata)) Object.freeze(field);
	Object.freeze(manifest.context.metadata);
	Object.freeze(manifest.context);
	Object.freeze(manifest.limits);
	return Object.freeze(manifest);
}

export async function validateFiseProfileManifest(
	input: unknown,
	options: CompileFiseProfileOptions = {}
): Promise<FiseProfileValidationReport> {
	const compiled = await compileFiseProfileManifest(input, options);
	return validateFiseProfileContract(compiled.profile);
}

export function validateFiseProfileContract(
	profile: FiseProfile
): FiseProfileValidationReport {
	if (!profile || typeof profile !== "object") {
		throw new FiseError("INVALID_PROFILE", "FISE: profile must be an object.");
	}
	const representation = profile.representation;
	if (representation !== "string" && representation !== "binary") {
		throw new FiseError(
			"INVALID_PROFILE",
			"FISE: profile representation must be 'string' or 'binary'."
		);
	}
	const options = contextFixture(profile.context);
	const normalized = representation === "string"
		? normalizeStringProfile(profile, options)
		: normalizeBinaryProfile(profile, options);
	const ownedProfile = normalized.profile;
	const transformedLengths = [0, 1, 255, 65_536];
	const transformCasesChecked = validateProfileTransform(
		ownedProfile,
		normalized.saltRange
	);
	let layoutCasesChecked = 0;
	for (
		let saltLength = normalized.saltRange.min;
		saltLength <= normalized.saltRange.max;
		saltLength++
	) {
		for (const transformedLength of transformedLengths) {
			const layoutInput = { transformedLength, saltLength };
			const marker = validateLayoutMarker(
				ownedProfile,
				layoutInput,
				normalized.context
			);
			if (ownedProfile.representation === "string") {
				if (typeof marker !== "string" || marker.length !== normalized.markerSize) {
					throw invalidManifest("string marker contract changed width or type");
				}
			} else if (!isUint8ArrayValue(marker) || marker.length !== normalized.markerSize) {
				throw invalidManifest("binary marker contract changed width or type");
			}
			validateLayoutOffset(ownedProfile, layoutInput, normalized.context);
			layoutCasesChecked++;
		}
	}
	return {
		profileId: ownedProfile.id,
		representation: ownedProfile.representation,
		transformId: ownedProfile.transform.id,
		transformCasesChecked,
		saltLengthsChecked: normalized.saltRange.max - normalized.saltRange.min + 1,
		layoutCasesChecked,
		valid: true
	};
}

export function createFiseProfileArtifact(
	compiled: CompiledFiseProfile
): FiseProfileArtifact {
	return Object.freeze({
		schema: FISE_PROFILE_ARTIFACT_SCHEMA,
		wireVersion: Object.freeze({ ...FISE_WIRE_VERSION }),
		profileId: compiled.profileId,
		digestAlgorithm: "sha256",
		digest: compiled.digest,
		manifest: compiled.manifest
	});
}

export async function createFiseProfileRotationArtifact(
	fromInput: unknown,
	toInput: unknown
): Promise<FiseProfileRotationArtifact> {
	const from = await compileFiseProfileManifest(fromInput);
	const to = await compileFiseProfileManifest(toInput);
	const changedPaths: string[] = [];
	collectChangedPaths(from.manifest, to.manifest, "", changedPaths);
	const profileCompatible = from.profileId === to.profileId;
	return Object.freeze({
		schema: FISE_PROFILE_ROTATION_SCHEMA,
		wireVersion: Object.freeze({ ...FISE_WIRE_VERSION }),
		fromProfileId: from.profileId,
		toProfileId: to.profileId,
		fromDigest: from.digest,
		toDigest: to.digest,
		changedPaths: Object.freeze(changedPaths),
		representationCompatible:
			from.manifest.representation === to.manifest.representation,
		profileCompatible,
		requiresAtomicRollout: !profileCompatible,
		legacyFallback: false
	});
}

export function createManifestConformanceVector(
	compiled: CompiledFiseProfile
): Record<string, unknown> {
	const options = contextFixture(compiled.profile.context);
	const saltLength = compiled.manifest.saltRange.min;
	if (compiled.profile.representation === "string") {
		const plaintext = "FISE profile vector";
		const salt = deterministicStringSalt(saltLength);
		return {
			profileId: compiled.profileId,
			digest: compiled.digest,
			representation: "string",
			context: options,
			plaintext,
			salt,
			envelope: fiseEncryptWithSalt(
				plaintext,
				salt,
				compiled.profile,
				options
			)
		};
	}
	const plaintext = Uint8Array.from([0, 1, 2, 3, 254, 255]);
	const salt = Uint8Array.from(
		{ length: saltLength },
		(_, index) => (index * 29 + 17) & 0xff
	);
	return {
		profileId: compiled.profileId,
		digest: compiled.digest,
		representation: "binary",
		context: options,
		plaintextHex: bytesToHex(plaintext),
		saltHex: bytesToHex(salt),
		envelopeHex: bytesToHex(fiseBinaryEncryptWithSalt(
			plaintext,
			salt,
			compiled.profile,
			options
		))
	};
}

export function canonicalJson(value: unknown): string {
	try {
		return JSON.stringify(sortJsonValue(value));
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw invalidManifest("canonical JSON serialization failed", error);
	}
}

function createProfileFromManifest(
	manifest: NormalizedFiseProfileManifest,
	profileId: string,
	digest: string,
	options: CompileFiseProfileOptions
): FiseProfile {
	const context = toContextContract(manifest.context);
	const limits = manifest.limits.maxEnvelopeLength === null
		? undefined
		: { maxEnvelopeLength: manifest.limits.maxEnvelopeLength };
	if (manifest.representation === "string") {
		const profile: FiseStringProfile = {
			id: profileId,
			representation: "string",
			transform: xorCipher,
			manifestDigest: digest,
			context,
			limits,
			layout: {
				markerSize: manifest.marker.width,
				saltRange: { ...manifest.saltRange },
				offset: createOffset(manifest.offset),
				createMarker: createStringMarker(manifest.marker)
			}
		};
		return defineStringProfile(profile);
	}

	const backend = snapshotBinaryCipher(options.binaryBackend ?? xorBinaryCipher);
	if (backend.id !== xorBinaryCipher.id) {
		throw new FiseError(
			"TRANSFORM_MISMATCH",
			`FISE: binary backend '${backend.id}' is incompatible with manifest transform '${manifest.transform}'.`
		);
	}
	assertBuiltInBinaryCipherImplementation(backend);
	assertBinaryCipherCompatibility(xorBinaryCipher, backend, manifest.saltRange);
	const profile: FiseBinaryProfile = {
		id: profileId,
		representation: "binary",
		transform: backend,
		manifestDigest: digest,
		context,
		limits,
		layout: {
			markerSize: manifest.marker.width,
			saltRange: { ...manifest.saltRange },
			offset: createOffset(manifest.offset),
			createMarker: createBinaryMarker(manifest.marker)
		}
	};
	return defineBinaryProfile(profile);
}

function validateLayoutMarker(
	profile: FiseProfile,
	input: FiseLayoutInput,
	context: FiseContext
): string | Uint8Array {
	try {
		return profile.layout.createMarker(input, context);
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw invalidManifest("profile marker validation failed", error);
	}
}

function validateLayoutOffset(
	profile: FiseProfile,
	input: FiseLayoutInput,
	context: FiseContext
): void {
	try {
		normalizeOffset(
			profile.layout.offset(input, context),
			input.transformedLength
		);
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw invalidManifest("profile offset validation failed", error);
	}
}

function createOffset(offset: NormalizedFiseProfileManifest["offset"]) {
	const {
		lengthMultiplier,
		saltMultiplier,
		constant,
		timestampModulo
	} = offset;
	const metadataTerms = offset.metadataTerms.map(term => ({ ...term }));
	return (input: FiseLayoutInput, ctx: FiseContext): number => {
		const domain = BigInt(input.transformedLength || 1);
		let value =
			BigInt(input.transformedLength) * BigInt(lengthMultiplier) +
			BigInt(input.saltLength) * BigInt(saltMultiplier) +
			BigInt(constant);
		if (timestampModulo !== null) {
			value += BigInt(ctx.timestamp ?? 0) % BigInt(timestampModulo);
		}
		for (const term of metadataTerms) {
			const raw = ctx.metadata?.[term.key];
			if (typeof raw !== "number" || !Number.isSafeInteger(raw)) {
				throw new FiseError(
					"INVALID_CONTEXT",
					`FISE: offset metadata '${term.key}' must be a safe integer.`
				);
			}
			const rawValue = BigInt(raw);
			const contribution = term.modulo === null
				? rawValue
				: rawValue % BigInt(term.modulo);
			value += contribution * BigInt(term.multiplier);
		}
		return Number(((value % domain) + domain) % domain);
	};
}

function createStringMarker(marker: NormalizedFiseProfileManifest["marker"]) {
	if (marker.kind !== "base-n") {
		throw invalidManifest("string profiles require a base-n marker");
	}
	const { alphabet, width } = marker;
	return (input: FiseLayoutInput): string =>
		encodeBaseN(input.saltLength, alphabet, width);
}

function createBinaryMarker(marker: NormalizedFiseProfileManifest["marker"]) {
	if (marker.kind === "base-n") {
		const encoder = new TextEncoder();
		const { alphabet, width } = marker;
		return (input: FiseLayoutInput): Uint8Array =>
			encoder.encode(encodeBaseN(input.saltLength, alphabet, width));
	}
	const { width } = marker;
	return (input: FiseLayoutInput): Uint8Array =>
		encodeUnsignedBigEndian(input.saltLength, width);
}

function normalizeSaltRange(value: unknown): { min: number; max: number } {
	if (value === undefined) return validateSaltRange(undefined);
	const range = asRecord(value, "saltRange");
	assertKnownKeys(range, ["min", "max"], "saltRange");
	if (typeof range.min !== "number" || typeof range.max !== "number") {
		throw invalidManifest("saltRange min and max must be numbers");
	}
	return validateSaltRange({ min: range.min, max: range.max });
}

function normalizeMarker(
	value: unknown,
	representation: "string" | "binary",
	maximumSaltLength: number
): NormalizedFiseProfileManifest["marker"] {
	const marker = asRecord(value, "marker");
	if (marker.kind === "base-n") {
		assertKnownKeys(marker, ["kind", "alphabet", "width"], "marker");
		if (typeof marker.alphabet !== "string") {
			throw invalidManifest("base-n marker alphabet must be a string");
		}
		if (
			marker.alphabet.length < 2 ||
			!/^[\x21-\x7e]+$/.test(marker.alphabet) ||
			new Set(marker.alphabet).size !== marker.alphabet.length
		) {
			throw invalidManifest("base-n alphabet must contain unique printable ASCII characters");
		}
		if (typeof marker.width !== "number") {
			throw invalidManifest("base-n marker width must be a number");
		}
		const width = marker.width;
		validateMarkerSize(width);
		assertMarkerCapacity(BigInt(marker.alphabet.length), width, maximumSaltLength);
		return { kind: "base-n", alphabet: marker.alphabet, width };
	}
	if (marker.kind === "uint-be") {
		assertKnownKeys(marker, ["kind", "width"], "marker");
		if (representation !== "binary") {
			throw invalidManifest("uint-be markers require binary representation");
		}
		if (typeof marker.width !== "number") {
			throw invalidManifest("uint-be marker width must be a number");
		}
		const width = marker.width;
		if (!Number.isInteger(width) || width < 1 || width > 4) {
			throw invalidManifest("uint-be marker width must be an integer from 1 through 4");
		}
		assertMarkerCapacity(256n, width, maximumSaltLength);
		return { kind: "uint-be", width };
	}
	throw invalidManifest("marker kind must be 'base-n' or 'uint-be'");
}

function normalizeOffsetManifest(
	value: unknown,
	context: NormalizedFiseProfileManifest["context"]
): NormalizedFiseProfileManifest["offset"] {
	const offset = asRecord(value, "offset");
	assertKnownKeys(offset, [
		"kind",
		"lengthMultiplier",
		"saltMultiplier",
		"constant",
		"timestampModulo",
		"metadataTerms"
	], "offset");
	if (offset.kind !== "affine") {
		throw invalidManifest("offset kind must be 'affine'");
	}
	const lengthMultiplier = boundedInteger(offset.lengthMultiplier ?? 1, "lengthMultiplier");
	const saltMultiplier = boundedInteger(offset.saltMultiplier ?? 0, "saltMultiplier");
	const constant = boundedInteger(offset.constant ?? 0, "constant");
	const timestampModulo = offset.timestampModulo === undefined
		? null
		: positiveInteger(offset.timestampModulo, "timestampModulo");
	if (timestampModulo !== null && context.timestamp === "forbidden") {
		throw invalidManifest("timestampModulo conflicts with forbidden timestamp context");
	}
	const termsInput = offset.metadataTerms ?? [];
	if (!Array.isArray(termsInput)) throw invalidManifest("metadataTerms must be an array");
	const keys = new Set<string>();
	const metadataTerms = termsInput.map((item, index) => {
		const term = asRecord(item, `metadataTerms[${index}]`);
		assertKnownKeys(term, ["key", "multiplier", "modulo"], `metadataTerms[${index}]`);
		if (typeof term.key !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(term.key)) {
			throw invalidManifest(`metadataTerms[${index}].key is invalid`);
		}
		if (keys.has(term.key)) throw invalidManifest(`metadata term '${term.key}' is duplicated`);
		keys.add(term.key);
		const field = context.metadata[term.key];
		if (!field || field.type !== "number" || !field.required) {
			throw invalidManifest(`metadata term '${term.key}' must reference a required number field`);
		}
		return {
			key: term.key,
			multiplier: boundedInteger(term.multiplier, `metadataTerms[${index}].multiplier`),
			modulo: term.modulo === undefined
				? null
				: positiveInteger(term.modulo, `metadataTerms[${index}].modulo`)
		};
	}).sort((left, right) => {
		if (left.key < right.key) return -1;
		if (left.key > right.key) return 1;
		return 0;
	});
	return {
		kind: "affine",
		lengthMultiplier,
		saltMultiplier,
		constant,
		timestampModulo,
		metadataTerms
	};
}

function normalizeContextContract(
	value: unknown
): NormalizedFiseProfileManifest["context"] {
	if (value === undefined) {
		return {
			timestamp: "optional",
			metadata: {},
			allowAdditionalMetadata: false
		};
	}
	const context = asRecord(value, "context");
	assertKnownKeys(context, ["timestamp", "metadata", "allowAdditionalMetadata"], "context");
	const timestamp = context.timestamp ?? "optional";
	if (timestamp !== "optional" && timestamp !== "required" && timestamp !== "forbidden") {
		throw invalidManifest("context.timestamp is invalid");
	}
	const metadataInput = context.metadata === undefined
		? {}
		: asRecord(context.metadata, "context.metadata");
	const metadata: Record<string, {
		type: "string" | "number" | "boolean";
		required: boolean;
	}> = {};
	for (const key of Object.keys(metadataInput).sort()) {
		const rawField = metadataInput[key];
		if (
			!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
			["__proto__", "constructor", "prototype"].includes(key)
		) {
			throw invalidManifest(`context metadata key '${key}' is invalid`);
		}
		const field = asRecord(rawField, `context.metadata.${key}`);
		assertKnownKeys(field, ["type", "required"], `context.metadata.${key}`);
		if (field.type !== "string" && field.type !== "number" && field.type !== "boolean") {
			throw invalidManifest(`context metadata '${key}' has an invalid type`);
		}
		if (field.required !== undefined && typeof field.required !== "boolean") {
			throw invalidManifest(`context metadata '${key}'.required must be boolean`);
		}
		metadata[key] = { type: field.type, required: field.required === true };
	}
	if (
		context.allowAdditionalMetadata !== undefined &&
		typeof context.allowAdditionalMetadata !== "boolean"
	) {
		throw invalidManifest("context.allowAdditionalMetadata must be boolean");
	}
	return {
		timestamp,
		metadata,
		allowAdditionalMetadata: context.allowAdditionalMetadata === true
	};
}

function normalizeLimits(value: unknown): { maxEnvelopeLength: number | null } {
	if (value === undefined) return { maxEnvelopeLength: null };
	const limits = asRecord(value, "limits");
	assertKnownKeys(limits, ["maxEnvelopeLength"], "limits");
	if (limits.maxEnvelopeLength === undefined) return { maxEnvelopeLength: null };
	if (!Number.isSafeInteger(limits.maxEnvelopeLength) || Number(limits.maxEnvelopeLength) < 0) {
		throw invalidManifest("limits.maxEnvelopeLength must be a non-negative safe integer");
	}
	return { maxEnvelopeLength: Number(limits.maxEnvelopeLength) };
}

function toContextContract(
	context: NormalizedFiseProfileManifest["context"]
): FiseContextContract {
	const metadata: Record<string, FiseContextFieldContract> = {};
	for (const [key, field] of Object.entries(context.metadata)) {
		metadata[key] = { ...field };
	}
	return {
		timestamp: context.timestamp,
		metadata,
		allowAdditionalMetadata: context.allowAdditionalMetadata
	};
}

function contextFixture(contract: FiseContextContract | undefined): EncryptOptions {
	const metadata: Record<string, unknown> = {};
	for (const [key, field] of Object.entries(contract?.metadata ?? {})) {
		if (!field.required) continue;
		metadata[key] = field.type === "number"
			? 0
			: field.type === "boolean"
				? false
				: "fixture";
	}
	return {
		timestamp: contract?.timestamp === "forbidden" ? undefined : 0,
		metadata
	};
}

function createCompiledProfileId(name: string, revision: number, digest: string): string {
	// The wire identifier carries a 128-bit digest prefix for compact routing.
	// Artifacts retain the full SHA-256 digest for exact verification.
	const profileId = `${name}.v${revision}.${digest.slice(0, 32)}`;
	try {
		validateProfileId(profileId);
	} catch (error) {
		throw invalidManifest("compiled profile id exceeds the 63-character wire limit; shorten name", error);
	}
	return profileId;
}

function encodeBaseN(value: number, alphabet: string, width: number): string {
	let remaining = value;
	let encoded = "";
	do {
		encoded = alphabet[remaining % alphabet.length] + encoded;
		remaining = Math.floor(remaining / alphabet.length);
	} while (remaining > 0);
	return encoded.padStart(width, alphabet[0]);
}

function encodeUnsignedBigEndian(value: number, width: number): Uint8Array {
	const marker = new Uint8Array(width);
	let remaining = value;
	for (let index = width - 1; index >= 0; index--) {
		marker[index] = remaining & 0xff;
		remaining = Math.floor(remaining / 256);
	}
	return marker;
}

function assertMarkerCapacity(base: bigint, width: number, maximum: number): void {
	if ((base ** BigInt(width)) - 1n < BigInt(maximum)) {
		throw invalidManifest("marker width cannot represent the maximum salt length");
	}
}

function boundedInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Math.abs(Number(value)) > 1_000_000) {
		throw invalidManifest(`${label} must be a safe integer with absolute value at most 1000000`);
	}
	return Number(value);
}

function positiveInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > 1_000_000) {
		throw invalidManifest(`${label} must be an integer from 1 through 1000000`);
	}
	return Number(value);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw invalidManifest(`${label} must be an object`);
	}
	try {
		const prototype = Object.getPrototypeOf(value);
		if (
			(prototype !== Object.prototype && prototype !== null) ||
			Object.getOwnPropertySymbols(value).length > 0
		) {
			throw invalidManifest(`${label} must be a plain object with string keys`);
		}
		const snapshot = Object.create(null) as Record<string, unknown>;
		const descriptors = Object.getOwnPropertyDescriptors(value);
		for (const key of Object.getOwnPropertyNames(value)) {
			const descriptor = descriptors[key];
			if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
				throw invalidManifest(`${label}.${key} must be an enumerable data property`);
			}
			snapshot[key] = descriptor.value;
		}
		return snapshot;
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw invalidManifest(`unable to inspect ${label}`, error);
	}
}

function normalizeCompileOptions(
	options: unknown
): CompileFiseProfileOptions {
	if (!options || typeof options !== "object" || Array.isArray(options)) {
		throw new FiseError("INVALID_INPUT", "FISE: profile compile options must be an object.");
	}
	try {
		const prototype = Object.getPrototypeOf(options);
		if (
			(prototype !== Object.prototype && prototype !== null) ||
			Object.getOwnPropertySymbols(options).length > 0
		) {
			throw new FiseError(
				"INVALID_INPUT",
				"FISE: profile compile options must be a plain object with string keys."
			);
		}
		const names = Object.getOwnPropertyNames(options);
		for (const key of names) {
			if (key !== "binaryBackend") {
				throw new FiseError(
					"INVALID_INPUT",
					`FISE: profile compile options contain unknown field '${key}'.`
				);
			}
		}
		const descriptor = Object.getOwnPropertyDescriptor(options, "binaryBackend");
		if (descriptor && (!("value" in descriptor) || !descriptor.enumerable)) {
			throw new FiseError(
				"INVALID_INPUT",
				"FISE: profile compile options.binaryBackend must be an enumerable data property."
			);
		}
		return Object.freeze({
			binaryBackend: descriptor?.value as FiseBinaryCipher | undefined
		});
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError(
			"INVALID_INPUT",
			"FISE: unable to inspect profile compile options.",
			error
		);
	}
}

function assertKnownKeys(
	value: Record<string, unknown>,
	known: readonly string[],
	label: string
): void {
	const allowed = new Set(known);
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) throw invalidManifest(`${label} contains unknown field '${key}'`);
	}
}

function sortJsonValue(value: unknown): unknown {
	if (value === null || typeof value === "string" || typeof value === "boolean") {
		return value;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw invalidManifest("canonical JSON cannot contain non-finite numbers");
		return value;
	}
	if (Array.isArray(value)) {
		if (Object.keys(value).length !== value.length) {
			throw invalidManifest("canonical JSON arrays must be dense and contain no extra fields");
		}
		return value.map(sortJsonValue);
	}
	if (value && typeof value === "object") {
		const source = asRecord(value, "canonical JSON object");
		const sorted = Object.create(null) as Record<string, unknown>;
		for (const key of Object.keys(source).sort()) {
			const child = source[key];
			if (child === undefined) throw invalidManifest("canonical JSON cannot contain undefined");
			sorted[key] = sortJsonValue(child);
		}
		return sorted;
	}
	throw invalidManifest("canonical JSON contains a non-JSON value");
}

async function sha256Hex(value: string): Promise<string> {
	const cryptoApi = globalThis.crypto;
	if (!cryptoApi?.subtle || typeof cryptoApi.subtle.digest !== "function") {
		throw new FiseError(
			"RUNTIME_UNAVAILABLE",
			"FISE: Web Crypto SubtleCrypto is required to compile profile manifests."
		);
	}
	try {
		const digest = await cryptoApi.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(value)
		);
		return bytesToHex(new Uint8Array(digest));
	} catch (error) {
		throw new FiseError(
			"RUNTIME_UNAVAILABLE",
			"FISE: unable to compute the profile manifest SHA-256 digest.",
			error
		);
	}
}

function collectChangedPaths(
	left: unknown,
	right: unknown,
	path: string,
	result: string[]
): void {
	if (canonicalJson(left) === canonicalJson(right)) return;
	if (
		left && right &&
		typeof left === "object" && typeof right === "object" &&
		!Array.isArray(left) && !Array.isArray(right)
	) {
		const keys = new Set([
			...Object.keys(left as Record<string, unknown>),
			...Object.keys(right as Record<string, unknown>)
		]);
		for (const key of Array.from(keys).sort()) {
			collectChangedPaths(
				(left as Record<string, unknown>)[key],
				(right as Record<string, unknown>)[key],
				path ? `${path}.${key}` : key,
				result
			);
		}
		return;
	}
	result.push(path || "$");
}

function deterministicStringSalt(length: number): string {
	const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
	let salt = "";
	for (let index = 0; index < length; index++) {
		salt += alphabet[index % alphabet.length];
	}
	return salt;
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

function invalidManifest(message: string, cause?: unknown): FiseError {
	return new FiseError("INVALID_PROFILE", `FISE profile manifest: ${message}.`, cause);
}

import {
	DEFAULT_SALT_RANGE,
	MAX_MARKER_SIZE,
	MAX_PROFILE_ID_LENGTH,
	MAX_SALT_LENGTH
} from "./constants.js";
import { FiseError } from "../errors.js";
import {
	assertBuiltInBinaryCipherImplementation,
	assertBuiltInStringCipherImplementation
} from "./transformRegistry.js";
import {
	DecryptOptions,
	EncryptOptions,
	FiseBinaryProfile,
	FiseContext,
	FiseContextContract,
	FiseProfile,
	FiseStringProfile
} from "../types.js";
import {
	snapshotBinaryProfile,
	snapshotStringProfile
} from "./profileSnapshot.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CONTEXT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FORBIDDEN_CONTEXT_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const EMPTY_METADATA = Object.freeze(
	Object.create(null)
) as Readonly<Record<string, unknown>>;

interface NormalizedRuntimeOptions {
	readonly timestamp?: number;
	readonly metadata: Readonly<Record<string, unknown>>;
	readonly maxEnvelopeLength?: number;
}

export interface NormalizedProfileBase {
	id: string;
	saltRange: { min: number; max: number };
	markerSize: number;
	context: FiseContext;
	maxEnvelopeLength?: number;
}

export interface NormalizedStringProfile extends NormalizedProfileBase {
	profile: FiseStringProfile;
}

export interface NormalizedBinaryProfile extends NormalizedProfileBase {
	profile: FiseBinaryProfile;
}

export function validateStringProfileDefinition(profile: FiseStringProfile): void {
	validateProfileSurface(profile, "string");
}

export function validateBinaryProfileDefinition(profile: FiseBinaryProfile): void {
	validateProfileSurface(profile, "binary");
}

export function normalizeStringProfile(
	profile: FiseStringProfile,
	options: EncryptOptions | DecryptOptions = {}
): NormalizedStringProfile {
	validateProfileSurface(profile, "string");
	const ownedProfile = snapshotStringProfile(profile);
	if (ownedProfile !== profile) validateProfileSurface(ownedProfile, "string");
	return {
		profile: ownedProfile,
		...normalizeBase(ownedProfile, options)
	};
}

export function normalizeBinaryProfile(
	profile: FiseBinaryProfile,
	options: EncryptOptions | DecryptOptions = {}
): NormalizedBinaryProfile {
	validateProfileSurface(profile, "binary");
	const ownedProfile = snapshotBinaryProfile(profile);
	if (ownedProfile !== profile) validateProfileSurface(ownedProfile, "binary");
	return {
		profile: ownedProfile,
		...normalizeBase(ownedProfile, options)
	};
}

export function validateProfileId(profileId: string): void {
	validateIdentifier(profileId, "profile id");
}

export function validateTransformId(transformId: string): void {
	validateIdentifier(transformId, "transform id");
}

export function validateMarkerSize(size: number): void {
	if (!Number.isInteger(size) || size < 1 || size > MAX_MARKER_SIZE) {
		throw new FiseError(
			"INVALID_PROFILE",
			`FISE: markerSize must be an integer from 1 through ${MAX_MARKER_SIZE}.`
		);
	}
}

export function validateSaltRange(
	range: Readonly<{ min: number; max: number }> | undefined
): { min: number; max: number } {
	if (range === undefined) return { ...DEFAULT_SALT_RANGE };
	if (!range || typeof range !== "object" || Array.isArray(range)) {
		throw invalidSaltRange();
	}
	for (const field of ["min", "max"] as const) {
		if (!Object.prototype.hasOwnProperty.call(range, field)) {
			throw invalidSaltRange();
		}
	}
	for (const field of Object.keys(range)) {
		if (field !== "min" && field !== "max") throw invalidSaltRange();
	}
	if (
		!Number.isInteger(range.min) ||
		!Number.isInteger(range.max) ||
		range.min < 1 ||
		range.max > MAX_SALT_LENGTH ||
		range.min > range.max
	) {
		throw invalidSaltRange();
	}
	return { min: range.min, max: range.max };
}

export function validateEnvelopeBound(
	value: number | undefined,
	owner: "profile" | "caller"
): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new FiseError(
			owner === "profile" ? "INVALID_PROFILE" : "INVALID_INPUT",
			`FISE: ${owner} maxEnvelopeLength must be a non-negative safe integer.`
		);
	}
	return value;
}

export function resolveEnvelopeBound(
	profileMaximum: number | undefined,
	callerMaximum: number | undefined
): number | undefined {
	const profileBound = validateEnvelopeBound(profileMaximum, "profile");
	const callerBound = validateEnvelopeBound(callerMaximum, "caller");
	if (profileBound === undefined) return callerBound;
	if (callerBound === undefined) return profileBound;
	return Math.min(profileBound, callerBound);
}

function normalizeBase(
	profile: FiseProfile,
	options: EncryptOptions | DecryptOptions
): NormalizedProfileBase {
	const saltRange = validateSaltRange(profile.layout.saltRange);
	validateMarkerSize(profile.layout.markerSize);
	const ownedOptions = snapshotRuntimeOptions(options);
	const context = validateContext(profile.context, ownedOptions);
	return {
		id: profile.id,
		saltRange,
		markerSize: profile.layout.markerSize,
		context,
		maxEnvelopeLength: resolveEnvelopeBound(
			profile.limits?.maxEnvelopeLength,
			ownedOptions.maxEnvelopeLength
		)
	};
}

function snapshotRuntimeOptions(
	options: EncryptOptions | DecryptOptions
): NormalizedRuntimeOptions {
	const source = snapshotDataRecord(options, "options", "INVALID_INPUT");
	for (const key of Object.keys(source)) {
		if (key !== "timestamp" && key !== "metadata" && key !== "maxEnvelopeLength") {
			throw new FiseError(
				"INVALID_INPUT",
				`FISE: options contain unknown field '${key}'.`
			);
		}
	}
	const metadata = source.metadata === undefined
		? EMPTY_METADATA
		: snapshotDataRecord(source.metadata, "metadata", "INVALID_CONTEXT");
	return Object.freeze({
		timestamp: source.timestamp as number | undefined,
		metadata,
		maxEnvelopeLength: source.maxEnvelopeLength as number | undefined
	});
}

function validateProfileSurface(
	profile: FiseProfile,
	representation: "string" | "binary"
): void {
	if (!profile || typeof profile !== "object") {
		throw new FiseError("INVALID_PROFILE", "FISE: profile must be an object.");
	}
	for (const field of ["id", "representation", "layout", "transform"] as const) {
		requireOwnProperty(profile, field, "profile");
	}
	for (const field of ["context", "limits", "manifestDigest"] as const) {
		if (
			profile[field] !== undefined &&
			!Object.prototype.hasOwnProperty.call(profile, field)
		) {
			throw new FiseError(
				"INVALID_PROFILE",
				`FISE: profile.${field} must be an own property.`
			);
		}
	}
	if (profile.representation !== representation) {
		throw new FiseError(
			"INVALID_PROFILE",
			`FISE: expected a ${representation} profile.`
		);
	}
	validateProfileId(profile.id);
	if (!profile.layout || typeof profile.layout !== "object") {
		throw new FiseError("INVALID_PROFILE", "FISE: profile.layout must be an object.");
	}
	requireOwnProperty(profile.layout, "markerSize", "profile.layout");
	if (
		profile.layout.saltRange !== undefined &&
		!Object.prototype.hasOwnProperty.call(profile.layout, "saltRange")
	) {
		throw new FiseError(
			"INVALID_PROFILE",
			"FISE: profile.layout.saltRange must be an own property."
		);
	}
	for (const operation of ["offset", "createMarker"] as const) {
		requireOwnProperty(profile.layout, operation, "profile.layout");
		if (typeof profile.layout[operation] !== "function") {
			throw new FiseError(
				"INVALID_PROFILE",
				`FISE: profile.layout.${operation} must be a function.`
			);
		}
	}
	if (!profile.transform || typeof profile.transform !== "object") {
		throw new FiseError("INVALID_PROFILE", "FISE: profile.transform must be an object.");
	}
	requireOwnProperty(profile.transform, "id", "profile.transform");
	validateTransformId(profile.transform.id);
	for (const operation of ["encrypt", "decrypt"] as const) {
		requireOwnProperty(profile.transform, operation, "profile.transform");
		if (typeof profile.transform[operation] !== "function") {
			throw new FiseError(
				"INVALID_PROFILE",
				`FISE: profile.transform.${operation} must be a function.`
			);
		}
	}
	if (representation === "binary") {
		assertBuiltInBinaryCipherImplementation(profile.transform as FiseBinaryProfile["transform"]);
	} else {
		assertBuiltInStringCipherImplementation(profile.transform as FiseStringProfile["transform"]);
	}
	if (
		profile.limits !== undefined &&
		(!profile.limits || typeof profile.limits !== "object" || Array.isArray(profile.limits))
	) {
		throw new FiseError("INVALID_PROFILE", "FISE: profile.limits must be an object.");
	}
	if (
		profile.limits?.maxEnvelopeLength !== undefined &&
		!Object.prototype.hasOwnProperty.call(profile.limits, "maxEnvelopeLength")
	) {
		throw new FiseError(
			"INVALID_PROFILE",
			"FISE: profile.limits.maxEnvelopeLength must be an own property."
		);
	}
	for (const key of Object.keys(profile.limits ?? {})) {
		if (key !== "maxEnvelopeLength") {
			throw new FiseError(
				"INVALID_PROFILE",
				`FISE: profile.limits contains unknown field '${key}'.`
			);
		}
	}
	if (
		profile.manifestDigest !== undefined &&
		(typeof profile.manifestDigest !== "string" || !/^[0-9a-f]{64}$/.test(profile.manifestDigest))
	) {
		throw new FiseError(
			"INVALID_PROFILE",
			"FISE: manifestDigest must be a lowercase SHA-256 hexadecimal digest."
		);
	}
	validateSaltRange(profile.layout.saltRange);
	validateMarkerSize(profile.layout.markerSize);
	validateEnvelopeBound(profile.limits?.maxEnvelopeLength, "profile");
	validateContextContract(profile.context);
}

function validateContextContract(contract: FiseContextContract | undefined): void {
	if (contract === undefined) return;
	if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
		throw new FiseError("INVALID_PROFILE", "FISE: profile.context must be an object.");
	}
	for (const key of Object.keys(contract)) {
		if (!["timestamp", "metadata", "allowAdditionalMetadata"].includes(key)) {
			throw new FiseError(
				"INVALID_PROFILE",
				`FISE: profile.context contains unknown field '${key}'.`
			);
		}
	}
	for (const key of ["timestamp", "metadata", "allowAdditionalMetadata"] as const) {
		if (
			contract[key] !== undefined &&
			!Object.prototype.hasOwnProperty.call(contract, key)
		) {
			throw new FiseError(
				"INVALID_PROFILE",
				`FISE: profile.context.${key} must be an own property.`
			);
		}
	}
	const timestampMode = contract.timestamp ?? "optional";
	if (!["required", "optional", "forbidden"].includes(timestampMode)) {
		throw new FiseError(
			"INVALID_PROFILE",
			"FISE: context timestamp must be required, optional, or forbidden."
		);
	}
	if (
		contract.allowAdditionalMetadata !== undefined &&
		typeof contract.allowAdditionalMetadata !== "boolean"
	) {
		throw new FiseError(
			"INVALID_PROFILE",
			"FISE: allowAdditionalMetadata must be a boolean."
		);
	}
	if (
		contract.metadata !== undefined &&
		(!contract.metadata || typeof contract.metadata !== "object" || Array.isArray(contract.metadata))
	) {
		throw new FiseError("INVALID_PROFILE", "FISE: context metadata contract must be an object.");
	}
	for (const [key, field] of Object.entries(contract.metadata ?? {})) {
		validateContextKey(key);
		if (!field || typeof field !== "object" || Array.isArray(field) || !isFieldType(field.type)) {
			throw new FiseError(
				"INVALID_PROFILE",
				`FISE: context metadata contract for '${key}' is invalid.`
			);
		}
		requireOwnProperty(field, "type", `profile.context.metadata.${key}`);
		if (
			field.required !== undefined &&
			!Object.prototype.hasOwnProperty.call(field, "required")
		) {
			throw new FiseError(
				"INVALID_PROFILE",
				`FISE: context metadata contract for '${key}'.required must be an own property.`
			);
		}
		for (const fieldKey of Object.keys(field)) {
			if (fieldKey !== "type" && fieldKey !== "required") {
				throw new FiseError(
					"INVALID_PROFILE",
					`FISE: context metadata contract for '${key}' contains unknown field '${fieldKey}'.`
				);
			}
		}
		if (field.required !== undefined && typeof field.required !== "boolean") {
			throw new FiseError(
				"INVALID_PROFILE",
				`FISE: context metadata contract for '${key}' has an invalid required flag.`
			);
		}
	}
}

function validateContext(
	contract: FiseContextContract | undefined,
	options: NormalizedRuntimeOptions
): FiseContext {
	validateContextContract(contract);
	const timestampMode = contract?.timestamp ?? "optional";
	const timestamp = options.timestamp;
	if (timestampMode === "required" && timestamp === undefined) {
		throw new FiseError("INVALID_CONTEXT", "FISE: this profile requires timestamp context.");
	}
	if (timestampMode === "forbidden" && timestamp !== undefined) {
		throw new FiseError("INVALID_CONTEXT", "FISE: this profile forbids timestamp context.");
	}
	if (timestamp !== undefined && !Number.isSafeInteger(timestamp)) {
		throw new FiseError("INVALID_CONTEXT", "FISE: timestamp must be a safe integer.");
	}

	const schema = contract?.metadata ?? {};
	const metadata = options.metadata;
	for (const key of Object.keys(metadata)) validateContextKeyValue(key);

	for (const [key, field] of Object.entries(schema)) {
		if (!field || typeof field !== "object" || !isFieldType(field.type)) {
			throw new FiseError(
				"INVALID_PROFILE",
				`FISE: context metadata contract for '${key}' is invalid.`
			);
		}
		const value = metadata[key];
		if (value === undefined) {
			if (field.required) {
				throw new FiseError(
					"INVALID_CONTEXT",
					`FISE: context metadata '${key}' is required.`
				);
			}
			continue;
		}
		if (typeof value !== field.type || (field.type === "number" && !Number.isSafeInteger(value))) {
			throw new FiseError(
				"INVALID_CONTEXT",
				`FISE: context metadata '${key}' must be a ${field.type}${field.type === "number" ? " safe integer" : ""}.`
			);
		}
	}

	if (!(contract?.allowAdditionalMetadata ?? false)) {
		for (const key of Object.keys(metadata)) {
			if (!Object.prototype.hasOwnProperty.call(schema, key)) {
				throw new FiseError(
					"INVALID_CONTEXT",
					`FISE: context metadata '${key}' is not declared by this profile.`
				);
			}
		}
	}

	return Object.freeze({
		timestamp,
		metadata
	});
}

function snapshotDataRecord(
	value: unknown,
	label: string,
	code: "INVALID_INPUT" | "INVALID_CONTEXT"
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new FiseError(code, `FISE: ${label} must be an object.`);
	}
	try {
		const prototype = Object.getPrototypeOf(value);
		const symbols = Object.getOwnPropertySymbols(value);
		if ((prototype !== Object.prototype && prototype !== null) || symbols.length > 0) {
			throw new FiseError(code, `FISE: ${label} must be a plain object with string keys.`);
		}
		const snapshot = Object.create(null) as Record<string, unknown>;
		for (const key of Object.getOwnPropertyNames(value)) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
				throw new FiseError(
					code,
					`FISE: ${label}.${key} must be an enumerable data property.`
				);
			}
			snapshot[key] = descriptor.value;
		}
		return Object.freeze(snapshot);
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError(code, `FISE: unable to inspect ${label}.`, error);
	}
}

function validateIdentifier(value: string, label: string): void {
	if (
		typeof value !== "string" ||
		value.length < 1 ||
		value.length > MAX_PROFILE_ID_LENGTH ||
		!IDENTIFIER_PATTERN.test(value)
	) {
		throw new FiseError(
			"INVALID_PROFILE",
			`FISE: ${label} must be 1-${MAX_PROFILE_ID_LENGTH} ASCII letters, digits, dots, underscores, or hyphens.`
		);
	}
}

function isFieldType(value: unknown): value is "string" | "number" | "boolean" {
	return value === "string" || value === "number" || value === "boolean";
}

function validateContextKey(key: string): void {
	if (!CONTEXT_KEY_PATTERN.test(key) || FORBIDDEN_CONTEXT_KEYS.has(key)) {
		throw new FiseError(
			"INVALID_PROFILE",
			`FISE: context metadata key '${key}' is invalid.`
		);
	}
}

function validateContextKeyValue(key: string): void {
	if (!CONTEXT_KEY_PATTERN.test(key) || FORBIDDEN_CONTEXT_KEYS.has(key)) {
		throw new FiseError(
			"INVALID_CONTEXT",
			`FISE: context metadata key '${key}' is invalid.`
		);
	}
}

function requireOwnProperty(
	value: object,
	key: PropertyKey,
	owner: string
): void {
	if (!Object.prototype.hasOwnProperty.call(value, key)) {
		throw new FiseError(
			"INVALID_PROFILE",
			`FISE: ${owner}.${String(key)} must be an own property.`
		);
	}
}

function invalidSaltRange(): FiseError {
	return new FiseError(
		"INVALID_PROFILE",
		`FISE: saltRange must contain only own integer min/max fields from 1 through ${MAX_SALT_LENGTH}.`
	);
}

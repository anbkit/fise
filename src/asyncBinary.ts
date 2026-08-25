import {
	assembleBinaryEnvelopeFromTransformed,
	extractBinaryEnvelopePayload
} from "./fiseBinaryEncrypt.js";
import {
	NormalizedBinaryProfile,
	normalizeBinaryProfile
} from "./core/profileValidation.js";
import { snapshotAsyncBinaryCipher } from "./core/transformRegistry.js";
import {
	optionalAbortSignal,
	snapshotOperationOptions,
	throwIfAborted
} from "./core/operationOptions.js";
import { randomIntegerInclusive, randomSaltBinary } from "./core/utils.js";
import { assertUint8ArrayValue } from "./core/valueValidation.js";
import { FiseError } from "./errors.js";
import {
	DecryptOptions,
	EncryptOptions,
	FiseAsyncBinaryCipher,
	FiseAsyncBinaryDecryptOptions,
	FiseAsyncBinaryEncryptOptions,
	FiseBinaryProfile
} from "./types.js";

const ASYNC_ENCRYPT_KEYS = new Set([
	"timestamp",
	"metadata",
	"backend",
	"signal"
]);
const ASYNC_DECRYPT_KEYS = new Set([
	...ASYNC_ENCRYPT_KEYS,
	"maxEnvelopeLength"
]);

export interface OwnedAsyncBinaryOptions {
	readonly runtimeOptions: EncryptOptions | DecryptOptions;
	readonly backend?: FiseAsyncBinaryCipher;
	readonly signal?: AbortSignal;
}

/**
 * Creates a byte-identical FISE 1.1 envelope through an asynchronous backend.
 * The default path uses the profile's synchronous transform; pass a compatible
 * backend such as `createParallelXorBinaryCipher()` for worker execution.
 */
export async function fiseBinaryEncryptAsync(
	input: Uint8Array,
	profile: FiseBinaryProfile,
	options: FiseAsyncBinaryEncryptOptions = {}
): Promise<Uint8Array> {
	const ownedInput = snapshotBytes(input, "binary input", "INVALID_INPUT");
	const ownedOptions = snapshotAsyncBinaryOptions(options, "encrypt");
	const normalized = normalizeBinaryProfile(profile, ownedOptions.runtimeOptions);
	const backend = resolveAsyncBinaryBackend(normalized, ownedOptions.backend);
	throwIfAborted(ownedOptions.signal);
	const saltLength = randomIntegerInclusive(
		normalized.saltRange.min,
		normalized.saltRange.max
	);
	return fiseBinaryEncryptAsyncNormalizedWithSalt(
		ownedInput,
		randomSaltBinary(saltLength),
		normalized,
		backend,
		ownedOptions.signal
	);
}

/** Validates and reverses one ordinary FISE 1.1 envelope asynchronously. */
export async function fiseBinaryDecryptAsync(
	envelope: Uint8Array,
	profile: FiseBinaryProfile,
	options: FiseAsyncBinaryDecryptOptions = {}
): Promise<Uint8Array> {
	const ownedEnvelope = snapshotBytes(
		envelope,
		"binary envelope",
		"INVALID_ENVELOPE"
	);
	const ownedOptions = snapshotAsyncBinaryOptions(options, "decrypt");
	const normalized = normalizeBinaryProfile(profile, ownedOptions.runtimeOptions);
	const backend = resolveAsyncBinaryBackend(normalized, ownedOptions.backend);
	throwIfAborted(ownedOptions.signal);
	return fiseBinaryDecryptAsyncNormalized(
		ownedEnvelope,
		normalized,
		backend,
		ownedOptions.signal
	);
}

/** @internal Async frame encryption with one normalized profile and fixed salt. */
export async function fiseBinaryEncryptAsyncNormalizedWithSalt(
	input: Uint8Array,
	salt: Uint8Array,
	normalized: NormalizedBinaryProfile,
	backend: FiseAsyncBinaryCipher | undefined,
	signal: AbortSignal | undefined
): Promise<Uint8Array> {
	assertUint8ArrayValue(input, "binary input", "INVALID_INPUT");
	assertUint8ArrayValue(salt, "binary salt", "INVALID_SALT");
	const transformed = await runAsyncBinaryTransform(
		"encrypt",
		normalized,
		backend,
		input,
		salt,
		signal
	);
	return assembleBinaryEnvelopeFromTransformed(
		transformed,
		salt,
		normalized
	);
}

/** @internal Async frame decryption with one normalized profile snapshot. */
export async function fiseBinaryDecryptAsyncNormalized(
	envelope: Uint8Array,
	normalized: NormalizedBinaryProfile,
	backend: FiseAsyncBinaryCipher | undefined,
	signal: AbortSignal | undefined
): Promise<Uint8Array> {
	throwIfAborted(signal);
	const { transformed, salt } = extractBinaryEnvelopePayload(
		envelope,
		normalized
	);
	return runAsyncBinaryTransform(
		"decrypt",
		normalized,
		backend,
		transformed,
		salt,
		signal
	);
}

/** @internal Strictly snapshots the shared async operation fields. */
export function snapshotAsyncBinaryOptions(
	options: unknown,
	operation: "encrypt" | "decrypt",
	additionalKeys: ReadonlySet<string> = new Set()
): OwnedAsyncBinaryOptions & { readonly source: Readonly<Record<string, unknown>> } {
	const base = operation === "encrypt" ? ASYNC_ENCRYPT_KEYS : ASYNC_DECRYPT_KEYS;
	const allowed = additionalKeys.size === 0
		? base
		: new Set([...base, ...additionalKeys]);
	const source = snapshotOperationOptions(options, allowed);
	const runtimeOptions = Object.create(null) as Record<string, unknown>;
	for (const key of ["timestamp", "metadata", "maxEnvelopeLength"] as const) {
		if (Object.prototype.hasOwnProperty.call(source, key)) {
			runtimeOptions[key] = source[key];
		}
	}
	const backendValue = source.backend;
	const backend = backendValue === undefined
		? undefined
		: snapshotAsyncBinaryCipher(backendValue as FiseAsyncBinaryCipher);
	return Object.freeze({
		source,
		runtimeOptions: Object.freeze(runtimeOptions) as EncryptOptions | DecryptOptions,
		backend,
		signal: optionalAbortSignal(source.signal)
	});
}

/** @internal Matches one async execution backend to the atomic profile. */
export function resolveAsyncBinaryBackend(
	normalized: NormalizedBinaryProfile,
	backend: FiseAsyncBinaryCipher | undefined
): FiseAsyncBinaryCipher | undefined {
	if (!backend) return undefined;
	if (backend.id !== normalized.profile.transform.id) {
		throw new FiseError(
			"TRANSFORM_MISMATCH",
			`FISE: async backend transform '${backend.id}' does not match profile transform '${normalized.profile.transform.id}'.`
		);
	}
	return backend;
}

async function runAsyncBinaryTransform(
	operation: "encrypt" | "decrypt",
	normalized: NormalizedBinaryProfile,
	backend: FiseAsyncBinaryCipher | undefined,
	input: Uint8Array,
	salt: Uint8Array,
	signal: AbortSignal | undefined
): Promise<Uint8Array> {
	throwIfAborted(signal);
	let output: Uint8Array;
	try {
		if (backend) {
			output = await backend[operation](
				input.slice(),
				salt.slice(),
				{ signal }
			);
		} else {
			output = normalized.profile.transform[operation](input, salt);
		}
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError(
			"INVALID_CIPHERTEXT",
			`FISE: async binary transform ${operation} operation failed.`,
			error
		);
	}
	throwIfAborted(signal);
	assertUint8ArrayValue(output, "async binary transform output", "INVALID_CIPHERTEXT");
	return output;
}

function snapshotBytes(
	value: Uint8Array,
	label: string,
	code: "INVALID_INPUT" | "INVALID_ENVELOPE"
): Uint8Array {
	assertUint8ArrayValue(value, label, code);
	try {
		const snapshot = new Uint8Array(value.length);
		snapshot.set(value);
		return snapshot;
	} catch (error) {
		throw new FiseError(
			"ENVELOPE_LIMIT",
			`FISE: unable to snapshot ${label} of length ${value.length}.`,
			error
		);
	}
}

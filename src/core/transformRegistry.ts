import { FiseError } from "../errors.js";
import {
	FiseAsyncBinaryCipher,
	FiseBinaryCipher,
	FiseCipher
} from "../types.js";

type BinaryOperation = FiseBinaryCipher["encrypt"];
type AsyncBinaryOperation = FiseAsyncBinaryCipher["encrypt"];
type StringOperation = FiseCipher["encrypt"];

const BUILT_IN_BINARY_TRANSFORM_IDS = new Set(["fise.xor.u8.v1"]);
const BUILT_IN_STRING_TRANSFORM_IDS = new Set(["fise.xor.utf16.v1"]);
const registeredBinaryImplementations = new WeakMap<
	BinaryOperation,
	WeakMap<BinaryOperation, Set<string>>
>();
const registeredStringImplementations = new WeakMap<
	StringOperation,
	WeakMap<StringOperation, Set<string>>
>();
const registeredAsyncBinaryImplementations = new WeakMap<
	AsyncBinaryOperation,
	WeakMap<AsyncBinaryOperation, Set<string>>
>();

/** Registers and freezes binary identities owned by FISE for a reserved ID. */
export function registerBuiltInBinaryCipher<T extends FiseBinaryCipher>(
	cipher: T
): T {
	let decryptions = registeredBinaryImplementations.get(cipher.encrypt);
	if (!decryptions) {
		decryptions = new WeakMap();
		registeredBinaryImplementations.set(cipher.encrypt, decryptions);
	}
	let identifiers = decryptions.get(cipher.decrypt);
	if (!identifiers) {
		identifiers = new Set();
		decryptions.set(cipher.decrypt, identifiers);
	}
	identifiers.add(cipher.id);
	return Object.freeze(cipher) as T;
}

/** Registers and freezes function identities owned by FISE for a string ID. */
export function registerBuiltInStringCipher<T extends FiseCipher>(
	cipher: T
): T {
	let decryptions = registeredStringImplementations.get(cipher.encrypt);
	if (!decryptions) {
		decryptions = new WeakMap();
		registeredStringImplementations.set(cipher.encrypt, decryptions);
	}
	let identifiers = decryptions.get(cipher.decrypt);
	if (!identifiers) {
		identifiers = new Set();
		decryptions.set(cipher.decrypt, identifiers);
	}
	identifiers.add(cipher.id);
	return Object.freeze(cipher) as T;
}

/** Registers an async execution backend for a FISE-owned binary identity. */
export function registerBuiltInAsyncBinaryCipher<T extends FiseAsyncBinaryCipher>(
	cipher: T
): T {
	let decryptions = registeredAsyncBinaryImplementations.get(cipher.encrypt);
	if (!decryptions) {
		decryptions = new WeakMap();
		registeredAsyncBinaryImplementations.set(cipher.encrypt, decryptions);
	}
	let identifiers = decryptions.get(cipher.decrypt);
	if (!identifiers) {
		identifiers = new Set();
		decryptions.set(cipher.decrypt, identifiers);
	}
	identifiers.add(cipher.id);
	return Object.freeze(cipher) as T;
}

/**
 * Built-in semantic IDs are reserved for implementations shipped by FISE.
 * Custom IDs remain an application-owned trusted-code boundary.
 */
export function assertBuiltInBinaryCipherImplementation(
	cipher: FiseBinaryCipher
): void {
	if (!BUILT_IN_BINARY_TRANSFORM_IDS.has(cipher.id)) return;
	const registered = registeredBinaryImplementations
		.get(cipher.encrypt)
		?.get(cipher.decrypt)
		?.has(cipher.id) === true;
	if (!registered) {
		throw new FiseError(
			"TRANSFORM_MISMATCH",
			`FISE: transform ID '${cipher.id}' requires a registered FISE implementation.`
		);
	}
}

/** Enforces the implementation owned by a reserved built-in string ID. */
export function assertBuiltInStringCipherImplementation(
	cipher: FiseCipher
): void {
	if (!BUILT_IN_STRING_TRANSFORM_IDS.has(cipher.id)) return;
	const registered = registeredStringImplementations
		.get(cipher.encrypt)
		?.get(cipher.decrypt)
		?.has(cipher.id) === true;
	if (!registered) {
		throw new FiseError(
			"TRANSFORM_MISMATCH",
			`FISE: transform ID '${cipher.id}' requires a registered FISE implementation.`
		);
	}
}

/** Enforces FISE ownership of async backends using a reserved transform ID. */
export function assertBuiltInAsyncBinaryCipherImplementation(
	cipher: FiseAsyncBinaryCipher
): void {
	if (!BUILT_IN_BINARY_TRANSFORM_IDS.has(cipher.id)) return;
	const registered = registeredAsyncBinaryImplementations
		.get(cipher.encrypt)
		?.get(cipher.decrypt)
		?.has(cipher.id) === true;
	if (!registered) {
		throw new FiseError(
			"TRANSFORM_MISMATCH",
			`FISE: async transform ID '${cipher.id}' requires a registered FISE implementation.`
		);
	}
}

/** Captures one stable function pair before compatibility checks and freezing. */
export function snapshotBinaryCipher(cipher: FiseBinaryCipher): FiseBinaryCipher {
	const id = cipher?.id;
	const encrypt = cipher?.encrypt;
	const decrypt = cipher?.decrypt;
	if (
		typeof id !== "string" ||
		typeof encrypt !== "function" ||
		typeof decrypt !== "function"
	) {
		throw new FiseError(
			"TRANSFORM_MISMATCH",
			"FISE: binary backend must provide an ID plus encrypt and decrypt functions."
		);
	}
	return Object.freeze({ id, encrypt, decrypt });
}

/** Captures one async backend function pair without retaining mutable fields. */
export function snapshotAsyncBinaryCipher(
	cipher: FiseAsyncBinaryCipher
): FiseAsyncBinaryCipher {
	if (!cipher || typeof cipher !== "object") {
		throw invalidAsyncBackend();
	}
	let id: unknown;
	let encrypt: unknown;
	let decrypt: unknown;
	try {
		id = ownDataValue(cipher, "id");
		encrypt = ownDataValue(cipher, "encrypt");
		decrypt = ownDataValue(cipher, "decrypt");
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError(
			"TRANSFORM_MISMATCH",
			"FISE: unable to inspect async binary backend.",
			error
		);
	}
	if (
		typeof id !== "string" ||
		typeof encrypt !== "function" ||
		typeof decrypt !== "function"
	) {
		throw invalidAsyncBackend();
	}
	const snapshot = Object.freeze({
		id,
		encrypt: encrypt as FiseAsyncBinaryCipher["encrypt"],
		decrypt: decrypt as FiseAsyncBinaryCipher["decrypt"]
	});
	assertBuiltInAsyncBinaryCipherImplementation(snapshot);
	return snapshot;
}

function ownDataValue(value: object, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
		throw invalidAsyncBackend();
	}
	return descriptor.value;
}

function invalidAsyncBackend(): FiseError {
	return new FiseError(
		"TRANSFORM_MISMATCH",
		"FISE: async binary backend must provide own enumerable ID, encrypt, and decrypt data properties."
	);
}

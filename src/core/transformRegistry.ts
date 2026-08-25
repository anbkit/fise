import { FiseError } from "../errors.js";
import { FiseBinaryCipher, FiseCipher } from "../types.js";

type BinaryOperation = FiseBinaryCipher["encrypt"];
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

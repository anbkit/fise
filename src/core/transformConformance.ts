import { FiseError } from "../errors.js";
import {
	FiseBinaryCipher,
	FiseCipher,
	FiseProfile
} from "../types.js";
import { xorBinaryCipher } from "./xorBinaryCipher.js";
import { xorCipher } from "./xorCipher.js";
import { isUint8ArrayValue } from "./valueValidation.js";

const BINARY_INPUT_LENGTHS = [0, 1, 257, 4_097] as const;

const STRING_INPUTS = [
	"",
	"a",
	"FISE\u0000safe",
	"Unicode 👋 tiếng Việt"
] as const;

/**
 * Confirms that a replacement binary backend implements the same observable
 * transform as the profile-owned backend. This is deterministic certification
 * against representative inputs, not a proof about hostile native code.
 */
export function assertBinaryCipherCompatibility(
	reference: FiseBinaryCipher,
	candidate: FiseBinaryCipher,
	saltRange: Readonly<{ min: number; max: number }>
): number {
	try {
		const saltLengths = conformanceSaltLengths(saltRange);
		for (let index = 0; index < BINARY_INPUT_LENGTHS.length; index++) {
			const plaintext = deterministicBytes(BINARY_INPUT_LENGTHS[index], 31, 17);
			const salt = deterministicBytes(saltLengths[index], 13, 29);
			const expectedCiphertext = runBinaryOperation(
				reference,
				"encrypt",
				plaintext,
				salt
			);
			const actualCiphertext = runBinaryOperation(
				candidate,
				"encrypt",
				plaintext,
				salt
			);
			assertEqualBytes(actualCiphertext, expectedCiphertext, index, "encrypt");

			const expectedPlaintext = runBinaryOperation(
				reference,
				"decrypt",
				expectedCiphertext,
				salt
			);
			const actualPlaintext = runBinaryOperation(
				candidate,
				"decrypt",
				expectedCiphertext,
				salt
			);
			assertEqualBytes(expectedPlaintext, plaintext, index, "reference roundtrip");
			assertEqualBytes(actualPlaintext, expectedPlaintext, index, "decrypt");
		}
	} catch (error) {
		if (error instanceof FiseError && error.code === "TRANSFORM_MISMATCH") {
			throw error;
		}
		throw transformMismatch("binary", error);
	}
	return BINARY_INPUT_LENGTHS.length;
}

/** Exercises a profile transform and checks known built-in semantic IDs. */
export function validateProfileTransform(
	profile: FiseProfile,
	saltRange: Readonly<{ min: number; max: number }>
): number {
	if (profile.representation === "binary") {
		const reference = profile.transform.id === xorBinaryCipher.id
			? xorBinaryCipher
			: profile.transform;
		return assertBinaryCipherCompatibility(reference, profile.transform, saltRange);
	}
	const reference = profile.transform.id === xorCipher.id
		? xorCipher
		: profile.transform;
	return assertStringCipherCompatibility(reference, profile.transform, saltRange);
}

function assertStringCipherCompatibility(
	reference: FiseCipher,
	candidate: FiseCipher,
	saltRange: Readonly<{ min: number; max: number }>
): number {
	try {
		const saltLengths = conformanceSaltLengths(saltRange);
		for (let index = 0; index < STRING_INPUTS.length; index++) {
			const input = STRING_INPUTS[index];
			const salt = deterministicStringSalt(saltLengths[index]);
			const expectedCiphertext = runStringOperation(reference, "encrypt", input, salt);
			const actualCiphertext = runStringOperation(candidate, "encrypt", input, salt);
			if (actualCiphertext !== expectedCiphertext) {
				throw transformMismatch("string", undefined, index, "encrypt");
			}
			const expectedPlaintext = runStringOperation(
				reference,
				"decrypt",
				expectedCiphertext,
				salt
			);
			const actualPlaintext = runStringOperation(
				candidate,
				"decrypt",
				expectedCiphertext,
				salt
			);
			if (expectedPlaintext !== input) {
				throw transformMismatch("string", undefined, index, "reference roundtrip");
			}
			if (actualPlaintext !== expectedPlaintext) {
				throw transformMismatch("string", undefined, index, "decrypt");
			}
		}
	} catch (error) {
		if (error instanceof FiseError && error.code === "TRANSFORM_MISMATCH") {
			throw error;
		}
		throw transformMismatch("string", error);
	}
	return STRING_INPUTS.length;
}

function runBinaryOperation(
	cipher: FiseBinaryCipher,
	operation: "encrypt" | "decrypt",
	input: Uint8Array,
	salt: Uint8Array
): Uint8Array {
	const ownedInput = input.slice();
	const ownedSalt = salt.slice();
	const inputBefore = ownedInput.slice();
	const saltBefore = ownedSalt.slice();
	const output = cipher[operation](ownedInput, ownedSalt);
	if (!isUint8ArrayValue(output)) {
		throw transformMismatch("binary", undefined, undefined, `${operation} output type`);
	}
	if (!equalBytes(ownedInput, inputBefore) || !equalBytes(ownedSalt, saltBefore)) {
		throw transformMismatch("binary", undefined, undefined, `${operation} input mutation`);
	}
	if (
		output.buffer === ownedInput.buffer ||
		output.buffer === ownedSalt.buffer
	) {
		throw transformMismatch("binary", undefined, undefined, `${operation} output aliasing`);
	}
	return output.slice();
}

function runStringOperation(
	cipher: FiseCipher,
	operation: "encrypt" | "decrypt",
	input: string,
	salt: string
): string {
	const output = cipher[operation](input, salt);
	if (typeof output !== "string") {
		throw transformMismatch("string", undefined, undefined, `${operation} output type`);
	}
	return output;
}

function assertEqualBytes(
	actual: Uint8Array,
	expected: Uint8Array,
	caseIndex: number,
	operation: string
): void {
	if (!equalBytes(actual, expected)) {
		throw transformMismatch("binary", undefined, caseIndex, operation);
	}
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

function deterministicBytes(length: number, factor: number, addend: number): Uint8Array {
	return Uint8Array.from(
		{ length },
		(_, index) => (index * factor + addend) & 0xff
	);
}

function deterministicStringSalt(length: number): string {
	const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
	let salt = "";
	for (let index = 0; index < length; index++) {
		salt += alphabet[(index * 17 + 11) % alphabet.length];
	}
	return salt;
}

function conformanceSaltLengths(
	range: Readonly<{ min: number; max: number }>
): [number, number, number, number] {
	const span = range.max - range.min;
	return [
		range.min,
		range.min + Math.floor(span / 3),
		range.min + Math.floor((span * 2) / 3),
		range.max
	];
}

function transformMismatch(
	representation: "string" | "binary",
	cause?: unknown,
	caseIndex?: number,
	operation?: string
): FiseError {
	const caseDetail = caseIndex === undefined ? "" : ` case ${caseIndex + 1}`;
	const operationDetail = operation ? ` (${operation})` : "";
	return new FiseError(
		"TRANSFORM_MISMATCH",
		`FISE: ${representation} transform failed semantic conformance${caseDetail}${operationDetail}.`,
		cause
	);
}

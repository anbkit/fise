import { FiseError } from "../errors.js";

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "length")?.get ??
	missingTypedArrayIntrinsic("length");
const typedArrayTag = Object.getOwnPropertyDescriptor(
	typedArrayPrototype,
	Symbol.toStringTag
)?.get ?? missingTypedArrayIntrinsic("Symbol.toStringTag");

export function isBytes(value: unknown): value is Uint8Array {
	if (value === null || typeof value !== "object") return false;
	try {
		return Reflect.apply(typedArrayTag, value, []) === "Uint8Array";
	} catch {
		return false;
	}
}

export function assertBytes(
	value: unknown,
	label: string,
	code:
		| "INVALID_INPUT"
		| "INVALID_ENVELOPE"
		| "INVALID_PROFILE"
		| "INVALID_PAYLOAD"
): asserts value is Uint8Array {
	if (!isBytes(value)) {
		throw new FiseError(code, `FISE: ${label} must be a Uint8Array.`);
	}
}

export function copyBytes(value: Uint8Array): Uint8Array {
	const output = new Uint8Array(byteLengthOf(value));
	Uint8Array.prototype.set.call(output, value);
	return output;
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	const length = byteLengthOf(left);
	if (length !== byteLengthOf(right)) return false;
	let difference = 0;
	for (let index = 0; index < length; index++) {
		difference |= left[index] ^ right[index];
	}
	return difference === 0;
}

export function byteLengthOf(value: Uint8Array): number {
	return Reflect.apply(typedArrayLength, value, []) as number;
}

function missingTypedArrayIntrinsic(name: string): never {
	throw new Error(`FISE: runtime does not expose typed-array ${name}.`);
}

export function hexToBytes(hex: string): Uint8Array {
	if (!/^[0-9a-f]{32}$/.test(hex)) {
		throw new FiseError(
			"INVALID_PROFILE",
			"FISE: generated profile fingerprint must be 32 lowercase hexadecimal characters."
		);
	}
	const output = new Uint8Array(16);
	for (let index = 0; index < output.length; index++) {
		output[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
	}
	return output;
}

export function bytesToHex(bytes: Uint8Array): string {
	let output = "";
	for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
	return output;
}

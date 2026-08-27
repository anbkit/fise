import { FiseError, type FiseErrorCode } from "../errors.js";

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "length")?.get ??
	missingTypedArrayIntrinsic("length");
const typedArrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get ??
	missingTypedArrayIntrinsic("buffer");
const typedArrayByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")?.get ??
	missingTypedArrayIntrinsic("byteOffset");
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
	code: FiseErrorCode
): asserts value is Uint8Array {
	if (!isBytes(value)) {
		throw new FiseError(code, `FISE: ${label} must be a Uint8Array.`);
	}
}

export function checkedByteLength(
	value: unknown,
	label: string,
	code: FiseErrorCode
): number {
	assertBytes(value, label, code);
	try {
		return byteLengthOf(value);
	} catch (error) {
		throw new FiseError(code, `FISE: ${label} is not readable byte data.`, error);
	}
}

export function snapshotBytes(
	value: unknown,
	label: string,
	code: FiseErrorCode
): Uint8Array {
	const length = checkedByteLength(value, label, code);
	return snapshotBytesAtLength(value, length, label, code);
}

export function snapshotBytesAtLength(
	value: unknown,
	expectedLength: number,
	label: string,
	code: FiseErrorCode
): Uint8Array {
	assertBytes(value, label, code);
	if (checkedByteLength(value, label, code) !== expectedLength) {
		throw new FiseError(code, `FISE: ${label} changed before it could be snapshotted.`);
	}
	try {
		const output = new Uint8Array(expectedLength);
		Uint8Array.prototype.set.call(output, value);
		if (byteLengthOf(value) !== expectedLength) {
			throw new FiseError(code, `FISE: ${label} changed while it was being snapshotted.`);
		}
		return output;
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError(code, `FISE: unable to snapshot ${label}.`, error);
	}
}

export function snapshotBytePrefix(
	value: unknown,
	prefixLength: number,
	label: string,
	code: FiseErrorCode
): Uint8Array {
	const length = checkedByteLength(value, label, code);
	if (!Number.isSafeInteger(prefixLength) || prefixLength < 0 || prefixLength > length) {
		throw new FiseError(code, `FISE: ${label} is shorter than the required prefix.`);
	}
	try {
		const buffer = Reflect.apply(typedArrayBuffer, value, []) as ArrayBufferLike;
		const byteOffset = Reflect.apply(typedArrayByteOffset, value, []) as number;
		const source = new Uint8Array(buffer, byteOffset, prefixLength);
		const output = new Uint8Array(prefixLength);
		Uint8Array.prototype.set.call(output, source);
		if (byteLengthOf(value as Uint8Array) !== length) {
			throw new FiseError(code, `FISE: ${label} changed while its prefix was snapshotted.`);
		}
		return output;
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError(code, `FISE: unable to snapshot ${label} prefix.`, error);
	}
}

export function snapshotByteRangeAtLength(
	value: unknown,
	expectedLength: number,
	start: number,
	endExclusive: number,
	label: string,
	code: FiseErrorCode
): Uint8Array {
	const output = new Uint8Array(assertByteRange(
		value,
		expectedLength,
		start,
		endExclusive,
		label,
		code
	));
	copyByteRangeAtLength(
		value,
		expectedLength,
		start,
		endExclusive,
		output,
		0,
		label,
		code
	);
	return output;
}

export function copyByteRangeAtLength(
	value: unknown,
	expectedLength: number,
	start: number,
	endExclusive: number,
	output: Uint8Array,
	outputOffset: number,
	label: string,
	code: FiseErrorCode
): void {
	const rangeLength = assertByteRange(
		value,
		expectedLength,
		start,
		endExclusive,
		label,
		code
	);
	if (
		!Number.isSafeInteger(outputOffset) ||
		outputOffset < 0 ||
		outputOffset > output.length - rangeLength
	) {
		throw new FiseError(code, `FISE: ${label} copy destination is invalid.`);
	}
	try {
		const buffer = Reflect.apply(typedArrayBuffer, value, []) as ArrayBufferLike;
		const byteOffset = Reflect.apply(typedArrayByteOffset, value, []) as number;
		const source = new Uint8Array(buffer, byteOffset + start, rangeLength);
		Uint8Array.prototype.set.call(output, source, outputOffset);
		if (byteLengthOf(value as Uint8Array) !== expectedLength) {
			throw new FiseError(code, `FISE: ${label} changed while its range was copied.`);
		}
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError(code, `FISE: unable to copy ${label} range.`, error);
	}
}

export function canBorrowBytesForSynchronousRead(value: unknown): value is Uint8Array {
	if (!isBytes(value)) return false;
	try {
		const buffer = Reflect.apply(typedArrayBuffer, value, []) as ArrayBufferLike;
		return Object.getPrototypeOf(value) === Uint8Array.prototype && buffer instanceof ArrayBuffer;
	} catch {
		return false;
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

function assertByteRange(
	value: unknown,
	expectedLength: number,
	start: number,
	endExclusive: number,
	label: string,
	code: FiseErrorCode
): number {
	assertBytes(value, label, code);
	if (checkedByteLength(value, label, code) !== expectedLength) {
		throw new FiseError(code, `FISE: ${label} changed before its range could be copied.`);
	}
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(endExclusive) ||
		start < 0 ||
		endExclusive < start ||
		endExclusive > expectedLength
	) {
		throw new FiseError(code, `FISE: ${label} range is invalid.`);
	}
	return endExclusive - start;
}

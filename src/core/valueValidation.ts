import { FiseError, type FiseErrorCode } from "../errors.js";

export function assertStringValue(
	value: unknown,
	label: string,
	code: FiseErrorCode
): asserts value is string {
	if (typeof value !== "string") {
		throw new FiseError(code, `FISE: ${label} must be a string.`);
	}
}

export function assertUint8ArrayValue(
	value: unknown,
	label: string,
	code: FiseErrorCode
): asserts value is Uint8Array {
	if (!isUint8ArrayValue(value)) {
		throw new FiseError(code, `FISE: ${label} must be a Uint8Array.`);
	}
}

/** Accepts byte arrays created by another same-origin realm or VM context. */
export function isUint8ArrayValue(value: unknown): value is Uint8Array {
	return (
		value instanceof Uint8Array ||
		(ArrayBuffer.isView(value) &&
			Object.prototype.toString.call(value) === "[object Uint8Array]")
	);
}

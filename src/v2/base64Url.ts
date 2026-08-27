import { FiseError } from "../errors.js";
import { checkedByteLength } from "./bytes.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const decoder = new TextDecoder();

/** Encodes an envelope as canonical unpadded Base64URL for JSON-safe transport. */
export function encodeBase64Url(input: Uint8Array): string {
	const inputLength = checkedByteLength(input, "envelope", "INVALID_ENVELOPE");
	const outputLength = Math.floor((inputLength * 4 + 2) / 3);
	let output: Uint8Array;
	try {
		output = new Uint8Array(outputLength);
	} catch (error) {
		throw new FiseError("ENVELOPE_LIMIT", "FISE: unable to encode envelope transport.", error);
	}

	let inputOffset = 0;
	let outputOffset = 0;
	while (inputOffset + 2 < inputLength) {
		const value =
			(input[inputOffset] << 16) |
			(input[inputOffset + 1] << 8) |
			input[inputOffset + 2];
		output[outputOffset++] = ALPHABET.charCodeAt((value >>> 18) & 63);
		output[outputOffset++] = ALPHABET.charCodeAt((value >>> 12) & 63);
		output[outputOffset++] = ALPHABET.charCodeAt((value >>> 6) & 63);
		output[outputOffset++] = ALPHABET.charCodeAt(value & 63);
		inputOffset += 3;
	}

	const remaining = inputLength - inputOffset;
	if (remaining === 1) {
		const value = input[inputOffset] << 16;
		output[outputOffset++] = ALPHABET.charCodeAt((value >>> 18) & 63);
		output[outputOffset] = ALPHABET.charCodeAt((value >>> 12) & 63);
	} else if (remaining === 2) {
		const value = (input[inputOffset] << 16) | (input[inputOffset + 1] << 8);
		output[outputOffset++] = ALPHABET.charCodeAt((value >>> 18) & 63);
		output[outputOffset++] = ALPHABET.charCodeAt((value >>> 12) & 63);
		output[outputOffset] = ALPHABET.charCodeAt((value >>> 6) & 63);
	}

	try {
		return decoder.decode(output);
	} catch (error) {
		throw new FiseError("INVALID_ENVELOPE", "FISE: unable to encode envelope transport.", error);
	}
}

/** Decodes only canonical unpadded Base64URL and enforces the binary envelope cap. */
export function decodeBase64Url(input: string, maximumOutputBytes: number): Uint8Array {
	if (typeof input !== "string") {
		throw invalidBase64Url();
	}
	const remainder = input.length % 4;
	if (remainder === 1) throw invalidBase64Url();
	const outputLength = Math.floor(input.length / 4) * 3 + (remainder === 0 ? 0 : remainder - 1);
	if (!Number.isSafeInteger(outputLength) || outputLength > maximumOutputBytes) {
		throw new FiseError("ENVELOPE_LIMIT", "FISE: encoded envelope exceeds the runtime limit.");
	}

	for (let index = 0; index < input.length; index++) {
		if (sextet(input.charCodeAt(index)) < 0) throw invalidBase64Url();
	}
	if (remainder === 2 && (sextet(input.charCodeAt(input.length - 1)) & 0x0f) !== 0) {
		throw invalidBase64Url();
	}
	if (remainder === 3 && (sextet(input.charCodeAt(input.length - 1)) & 0x03) !== 0) {
		throw invalidBase64Url();
	}

	let output: Uint8Array;
	try {
		output = new Uint8Array(outputLength);
	} catch (error) {
		throw new FiseError("ENVELOPE_LIMIT", "FISE: unable to decode envelope transport.", error);
	}
	let inputOffset = 0;
	let outputOffset = 0;
	while (inputOffset + 3 < input.length) {
		const value =
			(sextet(input.charCodeAt(inputOffset)) << 18) |
			(sextet(input.charCodeAt(inputOffset + 1)) << 12) |
			(sextet(input.charCodeAt(inputOffset + 2)) << 6) |
			sextet(input.charCodeAt(inputOffset + 3));
		output[outputOffset++] = value >>> 16;
		output[outputOffset++] = value >>> 8;
		output[outputOffset++] = value;
		inputOffset += 4;
	}
	if (remainder === 2) {
		const value =
			(sextet(input.charCodeAt(inputOffset)) << 18) |
			(sextet(input.charCodeAt(inputOffset + 1)) << 12);
		output[outputOffset] = value >>> 16;
	} else if (remainder === 3) {
		const value =
			(sextet(input.charCodeAt(inputOffset)) << 18) |
			(sextet(input.charCodeAt(inputOffset + 1)) << 12) |
			(sextet(input.charCodeAt(inputOffset + 2)) << 6);
		output[outputOffset++] = value >>> 16;
		output[outputOffset] = value >>> 8;
	}
	return output;
}

function sextet(code: number): number {
	if (code >= 0x41 && code <= 0x5a) return code - 0x41;
	if (code >= 0x61 && code <= 0x7a) return code - 0x61 + 26;
	if (code >= 0x30 && code <= 0x39) return code - 0x30 + 52;
	if (code === 0x2d) return 62;
	if (code === 0x5f) return 63;
	return -1;
}

function invalidBase64Url(): FiseError {
	return new FiseError(
		"INVALID_ENVELOPE",
		"FISE: string envelopes must use canonical unpadded Base64URL."
	);
}

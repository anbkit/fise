import { FiseError } from "../errors.js";

const MIN_MATCH = 4;
const LAST_LITERALS = 5;
const MATCH_FIND_LIMIT = 12;
const MAX_DISTANCE = 0xffff;
const HASH_BITS = 16;
const HASH_SIZE = 1 << HASH_BITS;
const HASH_SHIFT = 32 - HASH_BITS;
const HASH_MULTIPLIER = 0x9e37_79b1;

/** Encodes one deterministic independent LZ4 block. */
export function compressLz4Block(input: Uint8Array): Uint8Array {
	const output = new Uint8Array(compressBound(input.length));
	const positions = new Int32Array(HASH_SIZE);
	positions.fill(-1);
	let inputOffset = 0;
	let anchor = 0;
	let outputOffset = 0;
	const matchFindLimit = input.length - MATCH_FIND_LIMIT;
	const matchLimit = input.length - LAST_LITERALS;

	while (inputOffset <= matchFindLimit) {
		const sequence = readUint32(input, inputOffset);
		const hash = Math.imul(sequence, HASH_MULTIPLIER) >>> HASH_SHIFT;
		const candidate = positions[hash];
		positions[hash] = inputOffset;
		if (
			candidate < 0 ||
			inputOffset - candidate > MAX_DISTANCE ||
			readUint32(input, candidate) !== sequence
		) {
			inputOffset++;
			continue;
		}

		const matchStart = inputOffset;
		let candidateOffset = candidate + MIN_MATCH;
		inputOffset += MIN_MATCH;
		while (
			inputOffset < matchLimit &&
			input[inputOffset] === input[candidateOffset]
		) {
			inputOffset++;
			candidateOffset++;
		}
		const literalLength = matchStart - anchor;
		const matchLength = inputOffset - matchStart;
		const tokenOffset = outputOffset++;
		output[tokenOffset] =
			(Math.min(literalLength, 15) << 4) |
			Math.min(matchLength - MIN_MATCH, 15);
		if (literalLength >= 15) {
			outputOffset = writeExtendedLength(output, outputOffset, literalLength - 15);
		}
		output.set(input.subarray(anchor, matchStart), outputOffset);
		outputOffset += literalLength;
		const distance = matchStart - candidate;
		output[outputOffset++] = distance & 0xff;
		output[outputOffset++] = distance >>> 8;
		const encodedMatchLength = matchLength - MIN_MATCH;
		if (encodedMatchLength >= 15) {
			outputOffset = writeExtendedLength(
				output,
				outputOffset,
				encodedMatchLength - 15
			);
		}
		anchor = inputOffset;
	}

	const literalLength = input.length - anchor;
	const tokenOffset = outputOffset++;
	output[tokenOffset] = Math.min(literalLength, 15) << 4;
	if (literalLength >= 15) {
		outputOffset = writeExtendedLength(output, outputOffset, literalLength - 15);
	}
	output.set(input.subarray(anchor), outputOffset);
	outputOffset += literalLength;
	return output.slice(0, outputOffset);
}

/** Restores one independent LZ4 block into an exact bounded output. */
export function decompressLz4Block(
	input: Uint8Array,
	expectedLength: number
): Uint8Array {
	if (!Number.isSafeInteger(expectedLength) || expectedLength < 0) {
		throw invalidBlock("declared output length is invalid");
	}
	const output = new Uint8Array(expectedLength);
	let inputOffset = 0;
	let outputOffset = 0;
	let finalLiteralLength = -1;
	let lastMatchStart = -1;

	while (inputOffset < input.length) {
		const token = input[inputOffset++];
		let literalLength = token >>> 4;
		if (literalLength === 15) {
			[literalLength, inputOffset] = readExtendedLength(
				input,
				inputOffset,
				15,
				expectedLength - outputOffset
			);
		}
		if (
			literalLength > expectedLength - outputOffset ||
			literalLength > input.length - inputOffset
		) {
			throw invalidBlock("literal run exceeds its input or output boundary");
		}
		output.set(input.subarray(inputOffset, inputOffset + literalLength), outputOffset);
		inputOffset += literalLength;
		outputOffset += literalLength;

		if (inputOffset === input.length) {
			finalLiteralLength = literalLength;
			break;
		}
		if (input.length - inputOffset < 2) {
			throw invalidBlock("match offset is truncated");
		}
		const distance = input[inputOffset] | (input[inputOffset + 1] << 8);
		inputOffset += 2;
		if (distance === 0 || distance > outputOffset) {
			throw invalidBlock("match offset points outside restored data");
		}

		let encodedMatchLength = token & 0x0f;
		if (encodedMatchLength === 15) {
			[encodedMatchLength, inputOffset] = readExtendedLength(
				input,
				inputOffset,
				15,
				expectedLength - outputOffset - MIN_MATCH
			);
		}
		const matchLength = encodedMatchLength + MIN_MATCH;
		if (matchLength > expectedLength - outputOffset) {
			throw invalidBlock("match run exceeds the declared output length");
		}
		lastMatchStart = outputOffset;
		const sourceOffset = outputOffset - distance;
		for (let index = 0; index < matchLength; index++) {
			output[outputOffset + index] = output[sourceOffset + index];
		}
		outputOffset += matchLength;
	}

	if (inputOffset !== input.length || outputOffset !== expectedLength || finalLiteralLength < 0) {
		throw invalidBlock("block does not restore the declared output length");
	}
	if (
		lastMatchStart >= 0 &&
		(finalLiteralLength < LAST_LITERALS || lastMatchStart > expectedLength - MATCH_FIND_LIMIT)
	) {
		throw invalidBlock("block violates the LZ4 terminal sequence boundary");
	}
	return output;
}

function readUint32(input: Uint8Array, offset: number): number {
	return (
		input[offset] |
		(input[offset + 1] << 8) |
		(input[offset + 2] << 16) |
		(input[offset + 3] << 24)
	) >>> 0;
}

function writeExtendedLength(
	output: Uint8Array,
	offset: number,
	length: number
): number {
	while (length >= 255) {
		output[offset++] = 255;
		length -= 255;
	}
	output[offset++] = length;
	return offset;
}

function readExtendedLength(
	input: Uint8Array,
	offset: number,
	base: number,
	maximum: number
): [number, number] {
	let length = base;
	while (true) {
		if (offset >= input.length) throw invalidBlock("extended length is truncated");
		const value = input[offset++];
		if (length > maximum - value) throw invalidBlock("extended length exceeds its boundary");
		length += value;
		if (value !== 255) return [length, offset];
	}
}

function compressBound(length: number): number {
	if (!Number.isSafeInteger(length) || length < 0) {
		throw new FiseError("INVALID_INPUT", "FISE: structured payload length is invalid.");
	}
	const bound = length + Math.floor(length / 255) + 16;
	if (!Number.isSafeInteger(bound)) {
		throw new FiseError("ENVELOPE_LIMIT", "FISE: structured payload is too large.");
	}
	return bound;
}

function invalidBlock(reason: string): FiseError {
	return new FiseError("INVALID_PAYLOAD", `FISE: invalid compressed structured payload; ${reason}.`);
}

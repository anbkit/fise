import { FiseError } from "../errors.js";

const ALPHABET =
	"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const BASE64_PATTERN =
	/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const MAX_RANDOM_SALT_LENGTH = 64 * 1024 * 1024;

/**
 * Generate random salt string of specified length
 * @param len - Length of salt to generate
 * @returns Random salt string using alphanumeric characters
 */
export function randomSalt(len: number): string {
	validateRandomLength(len);

	let out = "";
	const unbiasedByteLimit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

	while (out.length < len) {
		const remaining = len - out.length;
		const candidateLength = Math.min(
			65_536,
			Math.max(16, remaining > 32_768 ? 65_536 : remaining * 2)
		);
		const candidates = randomBytes(candidateLength);
		for (const candidate of candidates) {
			if (candidate >= unbiasedByteLimit) continue;
			out += ALPHABET[candidate % ALPHABET.length];
			if (out.length === len) break;
		}
	}
	return out;
}

/**
 * Generate random binary salt of specified length
 * @param len - Length of salt to generate
 * @returns Random salt as Uint8Array
 */
export function randomSaltBinary(len: number): Uint8Array {
	return randomBytes(len);
}

export function randomIntegerInclusive(min: number, max: number): number {
	if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
		throw new FiseError("INVALID_PROFILE", "FISE: random integer range must contain valid integers.");
	}

	const range = max - min + 1;
	if (!Number.isSafeInteger(range) || range > 0x1_0000_0000) {
		throw new FiseError("INVALID_PROFILE", "FISE: random integer range is too large.");
	}
	if (range === 1) return min;

	const cryptoApi = requireWebCrypto();
	const values = new Uint32Array(1);
	const unbiasedLimit = Math.floor(0x1_0000_0000 / range) * range;
	do {
		fillRandomValues(cryptoApi, values);
	} while (values[0] >= unbiasedLimit);
	return min + (values[0] % range);
}

function randomBytes(len: number): Uint8Array {
	validateRandomLength(len);

	let bytes: Uint8Array;
	try {
		bytes = new Uint8Array(len);
	} catch (error) {
		throw new FiseError(
			"INVALID_SALT",
			`FISE: unable to allocate ${len} random salt bytes.`,
			error
		);
	}
	const cryptoApi = requireWebCrypto();
	// Web Crypto limits each getRandomValues call to 65,536 bytes.
	for (let offset = 0; offset < bytes.length; offset += 65_536) {
		fillRandomValues(cryptoApi, bytes.subarray(offset, offset + 65_536));
	}
	return bytes;
}

function validateRandomLength(len: number): void {
	if (
		!Number.isSafeInteger(len) ||
		len < 0 ||
		len > MAX_RANDOM_SALT_LENGTH
	) {
		throw new FiseError(
			"INVALID_SALT",
			`FISE: random salt length must be a safe integer from 0 through ${MAX_RANDOM_SALT_LENGTH}.`
		);
	}
}

function requireWebCrypto(): Crypto {
	const cryptoApi = globalThis.crypto;
	if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
		throw new FiseError(
			"RANDOM_UNAVAILABLE",
			"FISE: Web Crypto getRandomValues() is required for salt generation."
		);
	}
	return cryptoApi;
}

function fillRandomValues<T extends Uint8Array | Uint32Array>(cryptoApi: Crypto, values: T): T {
	try {
		return cryptoApi.getRandomValues(values);
	} catch (error) {
		throw new FiseError(
			"RANDOM_UNAVAILABLE",
			"FISE: Web Crypto failed to generate random values.",
			error
		);
	}
}

export function toBase64(str: string): string {
	return bytesToBase64(new TextEncoder().encode(str));
}

export function fromBase64(str: string): string {
	const bytes = base64ToBytes(str);
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch (error) {
		throw new FiseError("INVALID_CIPHERTEXT", "FISE: base64 data is not valid UTF-8.", error);
	}
}

export function bytesToBase64(bytes: Uint8Array): string {
	if (typeof Buffer !== "undefined") {
		return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
	}
	if (typeof btoa === "function") {
		let binary = "";
		const chunkSize = 0x8000;
		for (let offset = 0; offset < bytes.length; offset += chunkSize) {
			binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
		}
		return btoa(binary);
	}
	throw new FiseError("RUNTIME_UNAVAILABLE", "FISE: no base64 encoder is available.");
}

export function base64ToBytes(encoded: string): Uint8Array {
	if (typeof encoded !== "string" || !BASE64_PATTERN.test(encoded)) {
		throw new FiseError("INVALID_CIPHERTEXT", "FISE: ciphertext is not canonical base64.");
	}

	let bytes: Uint8Array;
	try {
		if (typeof Buffer !== "undefined") {
			bytes = new Uint8Array(Buffer.from(encoded, "base64"));
		} else if (typeof atob === "function") {
			const binary = atob(encoded);
			bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
		} else {
			throw new FiseError("RUNTIME_UNAVAILABLE", "FISE: no base64 decoder is available.");
		}
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError("INVALID_CIPHERTEXT", "FISE: ciphertext is not valid base64.", error);
	}

	if (bytesToBase64(bytes) !== encoded) {
		throw new FiseError("INVALID_CIPHERTEXT", "FISE: ciphertext is not canonical base64.");
	}
	return bytes;
}

import { FISE_WIRE_VERSION } from "./core/constants.js";
import {
	NormalizedBinaryProfile,
	normalizeBinaryProfile
} from "./core/profileValidation.js";
import { FiseError } from "./errors.js";
import {
	fiseBinaryDecrypt,
	fiseBinaryDecryptNormalized,
	fiseBinaryEncrypt,
	fiseBinaryEncryptNormalized
} from "./fiseBinaryEncrypt.js";
import {
	DecryptOptions,
	EncryptOptions,
	FiseBinaryProfile
} from "./types.js";
import { isUint8ArrayValue } from "./core/valueValidation.js";

export const FISE_MEDIA_TYPE = "application/vnd.fise";

/**
 * Encodes UTF-8 text through the reversible binary envelope path.
 *
 * @remarks Built-in profiles do not provide cryptographic confidentiality,
 * authenticity, or integrity.
 */
export function fiseUtf8Encrypt(
	text: string,
	profile: FiseBinaryProfile,
	options: EncryptOptions = {}
): Uint8Array {
	if (typeof text !== "string") {
		throw new FiseError("INVALID_INPUT", "FISE: UTF-8 plaintext must be a string.");
	}
	return fiseBinaryEncrypt(new TextEncoder().encode(text), profile, options);
}

/** Restores UTF-8 text after validating a reversible binary FISE envelope. */
export function fiseUtf8Decrypt(
	envelope: Uint8Array,
	profile: FiseBinaryProfile,
	options: DecryptOptions = {}
): string {
	const plaintext = fiseBinaryDecrypt(envelope, profile, options);
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
	} catch (error) {
		throw new FiseError(
			"INVALID_PAYLOAD",
			"FISE: restored payload is not valid UTF-8.",
			error
		);
	}
}

/**
 * Serializes JSON as UTF-8 and uses the reversible binary envelope path.
 *
 * @remarks Built-in profiles do not provide cryptographic confidentiality,
 * authenticity, or integrity.
 */
export function fiseJsonEncrypt(
	value: unknown,
	profile: FiseBinaryProfile,
	options: EncryptOptions = {}
): Uint8Array {
	return fiseUtf8Encrypt(serializeJson(value), profile, options);
}

/** Parses JSON after binary-envelope and UTF-8 validation. */
export function fiseJsonDecrypt<T = unknown>(
	envelope: Uint8Array,
	profile: FiseBinaryProfile,
	options: DecryptOptions = {}
): T {
	const json = fiseUtf8Decrypt(envelope, profile, options);
	try {
		return JSON.parse(json) as T;
	} catch (error) {
		throw new FiseError(
			"INVALID_PAYLOAD",
			"FISE: restored UTF-8 payload is not valid JSON.",
			error
		);
	}
}

/** Creates a standards-based Response carrying a binary FISE envelope. */
export function createFiseResponse(
	payload: Uint8Array,
	profile: FiseBinaryProfile,
	options: EncryptOptions = {},
	init: ResponseInit = {}
): Response {
	if (typeof Response !== "function" || typeof Headers !== "function") {
		throw new FiseError(
			"RUNTIME_UNAVAILABLE",
			"FISE: Response and Headers APIs are unavailable in this runtime."
		);
	}
	const normalized = normalizeBinaryProfile(profile, options);
	const envelope = fiseBinaryEncryptNormalized(payload, normalized);
	const headers = new Headers(init.headers);
	headers.set("content-type", contentTypeFor(normalized.id));
	headers.delete("content-length");
	headers.delete("content-encoding");
	return new Response(toResponseBody(envelope), {
		...init,
		headers
	});
}

/** Creates a Response from JSON using UTF-8 plus the binary FISE envelope. */
export function createFiseJsonResponse(
	value: unknown,
	profile: FiseBinaryProfile,
	options: EncryptOptions = {},
	init: ResponseInit = {}
): Response {
	if (typeof Response !== "function" || typeof Headers !== "function") {
		throw new FiseError(
			"RUNTIME_UNAVAILABLE",
			"FISE: Response and Headers APIs are unavailable in this runtime."
		);
	}
	const normalized = normalizeBinaryProfile(profile, options);
	const envelope = fiseBinaryEncryptNormalized(
		new TextEncoder().encode(serializeJson(value)),
		normalized
	);
	const headers = new Headers(init.headers);
	headers.set("content-type", contentTypeFor(normalized.id));
	headers.delete("content-length");
	headers.delete("content-encoding");
	return new Response(toResponseBody(envelope), {
		...init,
		headers
	});
}

/** Consumes and restores a Response after checking its FISE media type. */
export async function readFiseResponse(
	response: Response,
	profile: FiseBinaryProfile,
	options: DecryptOptions = {}
): Promise<Uint8Array> {
	const normalized = normalizeBinaryProfile(profile, options);
	const metadata = assertFiseResponse(
		response,
		normalized.id,
		normalized.maxEnvelopeLength
	);
	const envelope = await readResponseEnvelope(
		response,
		normalized.maxEnvelopeLength
	);
	assertActualResponseLength(envelope.length, metadata);
	return fiseBinaryDecryptNormalized(envelope, normalized);
}

/** JSON equivalent of readFiseResponse. Application schema validation remains required. */
export async function readFiseJsonResponse<T = unknown>(
	response: Response,
	profile: FiseBinaryProfile,
	options: DecryptOptions = {}
): Promise<T> {
	const normalized = normalizeBinaryProfile(profile, options);
	const metadata = assertFiseResponse(
		response,
		normalized.id,
		normalized.maxEnvelopeLength
	);
	const envelope = await readResponseEnvelope(
		response,
		normalized.maxEnvelopeLength
	);
	assertActualResponseLength(envelope.length, metadata);
	return parseJson<T>(decodeUtf8WithProfile(envelope, normalized));
}

function contentTypeFor(profileId: string): string {
	return (
		`${FISE_MEDIA_TYPE}; version=${FISE_WIRE_VERSION.major}.${FISE_WIRE_VERSION.minor}; ` +
		`profile="${profileId}"`
	);
}

function serializeJson(value: unknown): string {
	let json: string | undefined;
	try {
		json = JSON.stringify(value);
	} catch (error) {
		throw new FiseError("INVALID_INPUT", "FISE: value is not JSON-serializable.", error);
	}
	if (json === undefined) {
		throw new FiseError("INVALID_INPUT", "FISE: value has no JSON representation.");
	}
	return json;
}

function decodeUtf8WithProfile(
	envelope: Uint8Array,
	normalized: NormalizedBinaryProfile
): string {
	const plaintext = fiseBinaryDecryptNormalized(envelope, normalized);
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
	} catch (error) {
		throw new FiseError(
			"INVALID_PAYLOAD",
			"FISE: restored payload is not valid UTF-8.",
			error
		);
	}
}

function parseJson<T>(json: string): T {
	try {
		return JSON.parse(json) as T;
	} catch (error) {
		throw new FiseError(
			"INVALID_PAYLOAD",
			"FISE: restored UTF-8 payload is not valid JSON.",
			error
		);
	}
}

function toResponseBody(bytes: Uint8Array): ArrayBuffer {
	return new Uint8Array(bytes).buffer;
}

function assertFiseResponse(
	response: Response,
	expectedProfileId: string,
	maximumEnvelopeLength: number | undefined
): FiseResponseMetadata {
	if (!response || typeof response.arrayBuffer !== "function") {
		throw new FiseError("INVALID_INPUT", "FISE: response must implement arrayBuffer().");
	}
	const contentType = response.headers?.get("content-type") ?? "";
	const parsed = parseContentType(contentType);
	if (parsed.mediaType !== FISE_MEDIA_TYPE) {
		throw new FiseError(
			"INVALID_PAYLOAD",
			`FISE: response Content-Type must be '${FISE_MEDIA_TYPE}'.`
		);
	}
	const expectedVersion = `${FISE_WIRE_VERSION.major}.${FISE_WIRE_VERSION.minor}`;
	if (parsed.parameters.version !== expectedVersion) {
		throw new FiseError(
			"UNSUPPORTED_VERSION",
			`FISE: response media version '${parsed.parameters.version ?? "missing"}' does not match '${expectedVersion}'.`
		);
	}
	if (parsed.parameters.profile !== expectedProfileId) {
		throw new FiseError(
			"PROFILE_MISMATCH",
			`FISE: response media profile '${parsed.parameters.profile ?? "missing"}' does not match '${expectedProfileId}'.`
		);
	}
	const contentEncoded = hasTransportContentEncoding(
		response.headers?.get("content-encoding")
	);
	return {
		contentEncoded,
		declaredLength: parseDeclaredResponseLength(
			response.headers?.get("content-length"),
			contentEncoded ? undefined : maximumEnvelopeLength
		)
	};
}

interface FiseResponseMetadata {
	readonly contentEncoded: boolean;
	readonly declaredLength: number | undefined;
}

function parseContentType(value: string): {
	mediaType: string;
	parameters: Record<string, string>;
} {
	const segments = value.split(";");
	const mediaType = (segments.shift() ?? "").trim().toLowerCase();
	const parameters: Record<string, string> = {};
	for (const rawSegment of segments) {
		const segment = rawSegment.trim();
		const separator = segment.indexOf("=");
		if (separator < 1) {
			throw new FiseError("INVALID_PAYLOAD", "FISE: malformed response Content-Type parameter.");
		}
		const key = segment.slice(0, separator).trim().toLowerCase();
		let parameterValue = segment.slice(separator + 1).trim();
		if (
			parameterValue.length >= 2 &&
			parameterValue.startsWith('"') &&
			parameterValue.endsWith('"')
		) {
			parameterValue = parameterValue.slice(1, -1);
		}
		if (
			(key !== "version" && key !== "profile") ||
			key in parameters ||
			parameterValue.length === 0
		) {
			throw new FiseError("INVALID_PAYLOAD", "FISE: unsupported or duplicate response Content-Type parameter.");
		}
		parameters[key] = parameterValue;
	}
	return { mediaType, parameters };
}

function hasTransportContentEncoding(
	contentEncoding: string | null | undefined
): boolean {
	if (contentEncoding === null || contentEncoding === undefined) return false;
	const encodings = contentEncoding.split(",").map(value => value.trim().toLowerCase());
	if (encodings.some(value => value.length === 0)) {
		throw new FiseError("INVALID_PAYLOAD", "FISE: response Content-Encoding is malformed.");
	}
	return encodings.some(value => value !== "identity");
}

function parseDeclaredResponseLength(
	contentLength: string | null | undefined,
	maximum: number | undefined
): number | undefined {
	if (contentLength === null || contentLength === undefined) return undefined;
	if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) {
		throw new FiseError("INVALID_PAYLOAD", "FISE: response Content-Length is malformed.");
	}
	const declared = Number(contentLength);
	if (!Number.isSafeInteger(declared)) {
		throw new FiseError("INVALID_PAYLOAD", "FISE: response Content-Length is too large.");
	}
	if (maximum !== undefined && declared > maximum) {
		throw new FiseError(
			"ENVELOPE_LIMIT",
			`FISE: declared response length ${declared} exceeds configured maximum ${maximum}.`
		);
	}
	return declared;
}

function assertActualResponseLength(
	actual: number,
	metadata: FiseResponseMetadata
): void {
	if (
		metadata.contentEncoded ||
		metadata.declaredLength === undefined ||
		metadata.declaredLength === actual
	) {
		return;
	}
	throw new FiseError(
		"LENGTH_MISMATCH",
		`FISE: response body length ${actual} does not match Content-Length ${metadata.declaredLength}.`
	);
}

async function readResponseEnvelope(
	response: Response,
	maximumEnvelopeLength: number | undefined
): Promise<Uint8Array> {
	if (maximumEnvelopeLength === undefined) {
		try {
			return new Uint8Array(await response.arrayBuffer());
		} catch (error) {
			throw responseReadFailure(error);
		}
	}

	if (response.body === null) return new Uint8Array();
	if (!response.body || typeof response.body.getReader !== "function") {
		throw new FiseError(
			"RUNTIME_UNAVAILABLE",
			"FISE: bounded response reads require a readable response body."
		);
	}

	let reader: ReadableStreamDefaultReader<Uint8Array>;
	try {
		reader = response.body.getReader();
	} catch (error) {
		throw responseReadFailure(error);
	}
	const chunks: Uint8Array[] = [];
	let totalLength = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!isUint8ArrayValue(value)) {
				throw new FiseError(
					"INVALID_PAYLOAD",
					"FISE: response body stream produced a non-byte chunk."
				);
			}
			totalLength += value.length;
			if (!Number.isSafeInteger(totalLength) || totalLength > maximumEnvelopeLength) {
				try {
					void reader
						.cancel("FISE envelope length limit exceeded")
						.catch(() => undefined);
				} catch {
					// Cancellation is best-effort; the typed limit error remains primary.
				}
				throw new FiseError(
					"ENVELOPE_LIMIT",
					`FISE: response body exceeds configured maximum ${maximumEnvelopeLength}.`
				);
			}
			chunks.push(value.slice());
		}
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw responseReadFailure(error);
	} finally {
		try {
			reader.releaseLock();
		} catch {
			// Lock release is best-effort and must not hide the primary result.
		}
	}

	const envelope = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		envelope.set(chunk, offset);
		offset += chunk.length;
	}
	return envelope;
}

function responseReadFailure(cause: unknown): FiseError {
	return new FiseError(
		"INVALID_PAYLOAD",
		"FISE: unable to read the response body.",
		cause
	);
}

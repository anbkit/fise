import { FiseError } from "../errors.js";
import { assertBytes, copyBytes, isBytes } from "./bytes.js";
import type {
	FiseContext,
	FiseContextValue,
	FiseJsonValue,
	FiseValue
} from "./types.js";

const METADATA_VERSION = 1;
const STRUCTURED_DATA = 1;
const BINARY_DATA = 2;
const METADATA_LENGTH = 2;
const MAX_NESTING_DEPTH = 64;
const MAX_CONTEXT_BYTES = 64 * 1024;
const BASE64_URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const encoder = new TextEncoder();

export function encodeValue(value: unknown): Uint8Array {
	if (isBytes(value)) {
		const bytes = copyBytes(value);
		const output = new Uint8Array(METADATA_LENGTH + bytes.length);
		output[0] = METADATA_VERSION;
		output[1] = BINARY_DATA;
		output.set(bytes, METADATA_LENGTH);
		return output;
	}

	const canonical = canonicalJson(value, "input");
	const content = encoder.encode(canonical);
	const output = new Uint8Array(METADATA_LENGTH + content.length);
	output[0] = METADATA_VERSION;
	output[1] = STRUCTURED_DATA;
	output.set(content, METADATA_LENGTH);
	return output;
}

export function decodeValue(payload: Uint8Array): FiseValue {
	assertBytes(payload, "restored payload", "INVALID_PAYLOAD");
	if (payload.length < METADATA_LENGTH) {
		throw new FiseError("INVALID_PAYLOAD", "FISE: restored payload is missing metadata.");
	}
	if (payload[0] !== METADATA_VERSION) {
		throw new FiseError(
			"INVALID_PAYLOAD",
			`FISE: unsupported payload metadata version ${payload[0]}.`
		);
	}
	const content = payload.subarray(METADATA_LENGTH);
	if (payload[1] === BINARY_DATA) return copyBytes(content);
	if (payload[1] !== STRUCTURED_DATA) {
		throw new FiseError("INVALID_PAYLOAD", `FISE: unknown data type ${payload[1]}.`);
	}

	let source: string;
	try {
		source = new TextDecoder("utf-8", { fatal: true }).decode(content);
	} catch (error) {
		throw new FiseError("INVALID_PAYLOAD", "FISE: structured payload is not valid UTF-8.", error);
	}
	let value: unknown;
	try {
		value = JSON.parse(source);
	} catch (error) {
		throw new FiseError("INVALID_PAYLOAD", "FISE: structured payload is not valid JSON.", error);
	}
	let canonical: string;
	try {
		canonical = canonicalJson(value, "restored payload");
	} catch (error) {
		throw new FiseError("INVALID_PAYLOAD", "FISE: restored JSON is outside the data contract.", error);
	}
	if (source !== canonical) {
		throw new FiseError("INVALID_PAYLOAD", "FISE: structured payload is not canonical JSON.");
	}
	return value as FiseJsonValue;
}

export interface PreparedContext {
	readonly value: FiseContext;
	readonly encoded: Uint8Array;
}

export function prepareContext(context: unknown): PreparedContext {
	const source = canonicalJson(context === undefined ? [] : context, "context");
	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch (error) {
		throw new FiseError("INVALID_CONTEXT", "FISE: unable to snapshot context.", error);
	}
	if (!Array.isArray(parsed)) {
		throw invalidValue("context", "must be a positional array");
	}
	const values: FiseContextValue[] = [];
	for (let index = 0; index < parsed.length; index++) {
		const value = parsed[index];
		if (
			value !== null &&
			typeof value !== "boolean" &&
			typeof value !== "number" &&
			typeof value !== "string"
		) {
			throw invalidValue(`context[${index}]`, "must be a JSON scalar");
		}
		values.push(value as FiseContextValue);
	}
	const canonicalBytes = encoder.encode(source);
	if (canonicalBytes.length > MAX_CONTEXT_BYTES) {
		throw new FiseError(
			"INVALID_CONTEXT",
			`FISE: canonical context exceeds ${MAX_CONTEXT_BYTES} bytes.`
		);
	}
	return Object.freeze({
		value: Object.freeze(values),
		encoded: encodeBase64Url(canonicalBytes)
	});
}

function encodeBase64Url(input: Uint8Array): Uint8Array {
	const outputLength = Math.floor((input.length * 4 + 2) / 3);
	const output = new Uint8Array(outputLength);
	let inputOffset = 0;
	let outputOffset = 0;
	while (inputOffset + 2 < input.length) {
		const value =
			(input[inputOffset] << 16) |
			(input[inputOffset + 1] << 8) |
			input[inputOffset + 2];
		output[outputOffset++] = BASE64_URL_ALPHABET.charCodeAt((value >>> 18) & 63);
		output[outputOffset++] = BASE64_URL_ALPHABET.charCodeAt((value >>> 12) & 63);
		output[outputOffset++] = BASE64_URL_ALPHABET.charCodeAt((value >>> 6) & 63);
		output[outputOffset++] = BASE64_URL_ALPHABET.charCodeAt(value & 63);
		inputOffset += 3;
	}
	const remaining = input.length - inputOffset;
	if (remaining === 1) {
		const value = input[inputOffset] << 16;
		output[outputOffset++] = BASE64_URL_ALPHABET.charCodeAt((value >>> 18) & 63);
		output[outputOffset] = BASE64_URL_ALPHABET.charCodeAt((value >>> 12) & 63);
	} else if (remaining === 2) {
		const value = (input[inputOffset] << 16) | (input[inputOffset + 1] << 8);
		output[outputOffset++] = BASE64_URL_ALPHABET.charCodeAt((value >>> 18) & 63);
		output[outputOffset++] = BASE64_URL_ALPHABET.charCodeAt((value >>> 12) & 63);
		output[outputOffset] = BASE64_URL_ALPHABET.charCodeAt((value >>> 6) & 63);
	}
	return output;
}

export function canonicalJson(value: unknown, label = "value"): string {
	const ancestors = new Set<object>();
	try {
		const canonical = encodeCanonical(value, label, 0, ancestors);
		assertNativePlainGraph(value, label);
		return canonical;
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError("INVALID_INPUT", `FISE: unable to canonicalize ${label}.`, error);
	}
}

function encodeCanonical(
	value: unknown,
	label: string,
	depth: number,
	ancestors: Set<object>
): string {
	if (depth > MAX_NESTING_DEPTH) {
		throw invalidValue(label, `nesting exceeds ${MAX_NESTING_DEPTH}`);
	}
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") {
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value) || Object.is(value, -0)) {
			throw invalidValue(label, "numbers must be finite and must not be negative zero");
		}
		return JSON.stringify(value);
	}
	if (typeof value !== "object") {
		throw invalidValue(label, "must contain only JSON-safe values");
	}
	if (isBytes(value)) {
		throw invalidValue(label, "may contain Uint8Array only as the top-level input");
	}
	if (ancestors.has(value)) throw invalidValue(label, "must not contain cycles");
	ancestors.add(value);
	try {
		if (Array.isArray(value)) {
			return encodeArray(value, label, depth, ancestors);
		}
		return encodeObject(value, label, depth, ancestors);
	} finally {
		ancestors.delete(value);
	}
}

function encodeArray(
	value: readonly unknown[],
	label: string,
	depth: number,
	ancestors: Set<object>
): string {
	if (!isSupportedArrayPrototype(Object.getPrototypeOf(value))) {
		throw invalidValue(label, "arrays must have Array.prototype");
	}
	const keys = Reflect.ownKeys(value);
	for (const key of keys) {
		if (typeof key === "symbol") throw invalidValue(label, "must not contain symbol keys");
		if (key === "length") continue;
		if (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
			throw invalidValue(label, "arrays must not contain custom properties");
		}
	}
	const parts: string[] = [];
	for (let index = 0; index < value.length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor || !("value" in descriptor)) {
			throw invalidValue(label, "arrays must be dense and must not contain accessors");
		}
		if (!descriptor.enumerable) {
			throw invalidValue(label, "array elements must be enumerable");
		}
		parts.push(encodeCanonical(descriptor.value, `${label}[${index}]`, depth + 1, ancestors));
	}
	return `[${parts.join(",")}]`;
}

function encodeObject(
	value: object,
	label: string,
	depth: number,
	ancestors: Set<object>
): string {
	const prototype = Object.getPrototypeOf(value);
	if (!isSupportedObjectPrototype(prototype)) {
		throw invalidValue(label, "objects must have Object.prototype or null prototype");
	}
	const ownKeys = Reflect.ownKeys(value);
	if (ownKeys.some(key => typeof key === "symbol")) {
		throw invalidValue(label, "must not contain symbol keys");
	}
	const keys = (ownKeys as string[]).sort();
	const parts: string[] = [];
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !("value" in descriptor)) {
			throw invalidValue(label, "must not contain accessors");
		}
		if (!descriptor.enumerable) {
			throw invalidValue(label, "must contain only enumerable properties");
		}
		parts.push(
			`${JSON.stringify(key)}:${encodeCanonical(descriptor.value, `${label}.${key}`, depth + 1, ancestors)}`
		);
	}
	return `{${parts.join(",")}}`;
}

function isSupportedObjectPrototype(prototype: object | null): boolean {
	if (prototype === null || prototype === Object.prototype) return true;
	if (Object.getPrototypeOf(prototype) !== null) return false;

	const constructorDescriptor = Object.getOwnPropertyDescriptor(prototype, "constructor");
	if (
		!constructorDescriptor ||
		!("value" in constructorDescriptor) ||
		constructorDescriptor.enumerable ||
		typeof constructorDescriptor.value !== "function"
	) {
		return false;
	}
	const constructor = constructorDescriptor.value;
	if (constructor.name !== "Object" || constructor.prototype !== prototype) return false;
	try {
		const source = Function.prototype.toString.call(constructor);
		if (!/^function Object\(\)\s*\{\s*\[native code\]\s*\}$/.test(source)) return false;
	} catch {
		return false;
	}
	for (const key of Reflect.ownKeys(prototype)) {
		if (Object.getOwnPropertyDescriptor(prototype, key)?.enumerable !== false) return false;
	}
	return true;
}

function isSupportedArrayPrototype(prototype: object | null): boolean {
	if (prototype === Array.prototype) return true;
	if (prototype === null || !isSupportedObjectPrototype(Object.getPrototypeOf(prototype))) {
		return false;
	}
	const constructorDescriptor = Object.getOwnPropertyDescriptor(prototype, "constructor");
	if (
		!constructorDescriptor ||
		!("value" in constructorDescriptor) ||
		constructorDescriptor.enumerable ||
		typeof constructorDescriptor.value !== "function"
	) {
		return false;
	}
	const constructor = constructorDescriptor.value;
	if (constructor.name !== "Array" || constructor.prototype !== prototype) return false;
	try {
		const source = Function.prototype.toString.call(constructor);
		if (!/^function Array\(\)\s*\{\s*\[native code\]\s*\}$/.test(source)) return false;
	} catch {
		return false;
	}
	for (const key of Reflect.ownKeys(prototype)) {
		if (Object.getOwnPropertyDescriptor(prototype, key)?.enumerable !== false) return false;
	}
	return true;
}

function assertNativePlainGraph(value: unknown, label: string): void {
	if (value === null || typeof value !== "object") return;
	try {
		structuredClone(value);
	} catch (error) {
		throw new FiseError(
			label === "context" ? "INVALID_CONTEXT" : "INVALID_INPUT",
			`FISE: ${label} must not contain Proxy or non-cloneable wrapper objects.`,
			error
		);
	}
}

function invalidValue(label: string, detail: string): FiseError {
	const code = label === "context" || label.startsWith("context.") || label.startsWith("context[")
		? "INVALID_CONTEXT"
		: "INVALID_INPUT";
	return new FiseError(code, `FISE: ${label} ${detail}.`);
}

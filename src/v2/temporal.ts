import { FiseError } from "../errors.js";

export type FiseClock = () => number;

export const NO_EXPIRY_SECONDS = 0n;
export const MAX_TTL_SECONDS = 0xffff_ffff;

const MAX_UINT64 = 0xffff_ffff_ffff_ffffn;
const EXPIRY_BINDING_PREFIX = Object.freeze([
	0x00,
	0x46,
	0x49,
	0x53,
	0x45,
	0x2d,
	0x54,
	0x54,
	0x4c,
	0x01
]);

export const systemFiseClock: FiseClock = () => Date.now();

export function normalizeTtlSeconds(value: unknown): number | undefined {
	if (value === undefined) return undefined;
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < 1 ||
		value > MAX_TTL_SECONDS
	) {
		throw new FiseError("INVALID_INPUT", "FISE: ttlSeconds must be a positive uint32.");
	}
	return value;
}

export function captureExpiresAtSeconds(
	ttlSeconds: number | undefined,
	clock: FiseClock
): bigint {
	if (ttlSeconds === undefined) return NO_EXPIRY_SECONDS;
	const currentMilliseconds = readCurrentTimeMilliseconds(clock);
	const currentSeconds = BigInt(Math.floor(currentMilliseconds / 1000));
	const partialSecond = currentMilliseconds % 1000 === 0 ? 0n : 1n;
	const expiresAtSeconds = currentSeconds + partialSecond + BigInt(ttlSeconds);
	if (expiresAtSeconds > MAX_UINT64) {
		throw new FiseError("CLOCK_UNAVAILABLE", "FISE: envelope expiry exceeds uint64.");
	}
	return expiresAtSeconds;
}

export function assertEnvelopeFresh(expiresAtSeconds: bigint, clock: FiseClock): void {
	assertExpiresAtSeconds(expiresAtSeconds);
	if (expiresAtSeconds === NO_EXPIRY_SECONDS) return;
	if (BigInt(Math.floor(readCurrentTimeMilliseconds(clock) / 1000)) >= expiresAtSeconds) {
		throw new FiseError("ENVELOPE_EXPIRED", "FISE: envelope has expired.");
	}
}

export function bindExpiryToEncodedContext(
	encodedContext: Uint8Array,
	expiresAtSeconds: bigint
): Uint8Array {
	assertExpiresAtSeconds(expiresAtSeconds);
	if (expiresAtSeconds === NO_EXPIRY_SECONDS) return encodedContext;
	const output = new Uint8Array(
		encodedContext.length + EXPIRY_BINDING_PREFIX.length + BigUint64Array.BYTES_PER_ELEMENT
	);
	output.set(encodedContext, 0);
	output.set(EXPIRY_BINDING_PREFIX, encodedContext.length);
	new DataView(output.buffer, output.byteOffset, output.byteLength).setBigUint64(
		encodedContext.length + EXPIRY_BINDING_PREFIX.length,
		expiresAtSeconds,
		false
	);
	return output;
}

export function assertExpiresAtSeconds(value: bigint): void {
	if (typeof value !== "bigint" || value < NO_EXPIRY_SECONDS || value > MAX_UINT64) {
		throw new FiseError("INVALID_ENVELOPE", "FISE: envelope expiry must fit uint64.");
	}
}

function readCurrentTimeMilliseconds(clock: FiseClock): number {
	let milliseconds: unknown;
	try {
		milliseconds = clock();
	} catch (error) {
		throw new FiseError("CLOCK_UNAVAILABLE", "FISE: unable to read the system clock.", error);
	}
	if (
		typeof milliseconds !== "number" ||
		!Number.isFinite(milliseconds) ||
		milliseconds < 0 ||
		!Number.isSafeInteger(milliseconds)
	) {
		throw new FiseError("CLOCK_UNAVAILABLE", "FISE: system clock returned an invalid value.");
	}
	return milliseconds;
}

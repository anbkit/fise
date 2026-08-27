import { FiseError } from "../errors.js";
import { decodeBase64Url, encodeBase64Url } from "./base64Url.js";
import {
	decryptBinaryProgressive,
	decryptBinaryProgressiveAsync,
	decryptBinaryRange,
	decryptBinaryRangeAsync
} from "./binary.js";
import { checkedByteLength, isBytes } from "./bytes.js";
import { decodeValue, encodeValue } from "./codec.js";
import {
	normalizeBinaryOptions,
	resolveEncryptCoverage,
	type FiseBinaryOptions,
	type ResolvedFiseBinaryOptions
} from "./coverage.js";
import {
	FISE_MAX_ENVELOPE_LENGTH,
	assertBinaryContentEnvelopeCapacity,
	openPayload,
	openPayloadAsync,
	sealPayload,
	sealPayloadAsync
} from "./envelope.js";
import { snapshotOwnDataProperties } from "./options.js";
import {
	createParallelKernelRuntime,
	type ParallelOptions
} from "./parallel.js";
import {
	Profile,
	runProfileKernel,
	runtimeOf,
	type ProfileKernelRunner
} from "./profile.js";
import {
	captureExpiresAtSeconds,
	normalizeTtlSeconds,
	systemFiseClock,
	type FiseClock
} from "./temporal.js";
import type {
	FiseContext,
	FiseEncrypted,
	FiseEncryptedResult,
	FiseProgressiveOptions,
	FiseRange,
	FiseValue,
	FiseValueInput
} from "./types.js";
import { createWasmKernelRunner } from "./wasm.js";

const executions = new WeakMap<object, ProfileKernelRunner>();
const clocks = new WeakMap<object, FiseClock>();
const binaryPolicies = new WeakMap<object, ResolvedFiseBinaryOptions | undefined>();

/** Controls instance-level fallback, lifetime, and binary coverage policy. */
export interface FiseOptions<Strict extends boolean = boolean> {
	/** Defaults to true. False enables explicit raw pass-through on recoverable errors. */
	readonly strict?: Strict;
	/** Optional lifetime applied to every envelope encrypted by this instance. */
	readonly ttlSeconds?: number;
	/** Optional producer policy for top-level binary data. Full coverage is the default. */
	readonly binary?: FiseBinaryOptions;
}

type EncryptInput<Strict extends boolean, Data> = Strict extends true
	? Data & FiseValueInput<Data>
	: Data;

type EncryptOutput<Strict extends boolean, Data> = Strict extends true
	? FiseEncryptedResult<Data>
	: FiseEncryptedResult<Data> | Data;

type DecryptInput<Strict extends boolean, Data> = Strict extends true
	? FiseEncrypted
	: Data;

type DecryptOutput<Strict extends boolean, Data> = Strict extends true
	? FiseValue
	: FiseValue | Data;

/** Runtime bound to one generated FISE 2.0 profile. */
export class Fise<Strict extends boolean = true> {
	readonly profile: Profile;
	readonly strict: Strict;
	readonly ttlSeconds: number | undefined;

	constructor(profile: Profile, options: FiseOptions<Strict> = {}) {
		runtimeOf(profile);
		const normalized = normalizeFiseOptions(options);
		this.profile = profile;
		this.strict = normalized.strict as Strict;
		this.ttlSeconds = normalized.ttlSeconds;
		executions.set(this, runProfileKernel);
		clocks.set(this, systemFiseClock);
		binaryPolicies.set(this, normalized.binary);
		Object.freeze(this);
	}

	/** Encrypts structured data to Base64URL or top-level binary to bytes. */
	encrypt<const Data>(
		data: EncryptInput<Strict, Data>,
		context?: FiseContext
	): EncryptOutput<Strict, Data>;
	encrypt<const Data>(
		data: EncryptInput<Strict, Data>,
		context?: FiseContext,
		...unexpected: readonly unknown[]
	): EncryptOutput<Strict, Data> {
		try {
			assertNoEncryptOptions(unexpected);
			const binaryInput = preflightEncryptInput(data);
			const payload = encodeValue(data);
			const coverage = resolveEncryptCoverage(
				binaryPolicyOf(this),
				binaryInput,
				payload.length - 2
			);
			const envelope = sealPayload(
				payload,
				this.profile,
				context,
				executionOf(this),
				captureExpiresAtSeconds(this.ttlSeconds, clockOf(this)),
				coverage
			);
			return representEnvelope(data, envelope) as EncryptOutput<Strict, Data>;
		} catch (error) {
			return recoverInput(this.strict, data, error) as EncryptOutput<Strict, Data>;
		}
	}

	/** Restores a Base64URL or binary FISE envelope. */
	decrypt<const Data>(
		envelope: DecryptInput<Strict, Data>,
		context?: FiseContext
	): DecryptOutput<Strict, Data> {
		try {
			return decodeValue(openPayload(
				readEnvelope(envelope),
				this.profile,
				context,
				executionOf(this),
				clockOf(this)
			)) as DecryptOutput<Strict, Data>;
		} catch (error) {
			return recoverInput(this.strict, envelope, error) as DecryptOutput<Strict, Data>;
		}
	}

	/** Restores one half-open plaintext range from a binary FISE envelope. */
	decryptRange(
		envelope: Uint8Array,
		range: FiseRange,
		context?: FiseContext
	): Uint8Array {
		return decryptBinaryRange(
			envelope,
			this.profile,
			range,
			context,
			executionOf(this),
			clockOf(this)
		);
	}

	/** Lazily restores plaintext chunks from a binary FISE envelope. */
	decryptProgressive(
		envelope: Uint8Array,
		options?: FiseProgressiveOptions
	): AsyncGenerator<Uint8Array, void, void>;
	decryptProgressive(
		envelope: Uint8Array,
		context: FiseContext | undefined,
		options?: FiseProgressiveOptions
	): AsyncGenerator<Uint8Array, void, void>;
	decryptProgressive(
		envelope: Uint8Array,
		contextOrOptions?: FiseContext | FiseProgressiveOptions,
		options?: FiseProgressiveOptions
	): AsyncGenerator<Uint8Array, void, void> {
		const resolved = resolveProgressiveArguments(contextOrOptions, options);
		return decryptBinaryProgressive(
			envelope,
			this.profile,
			resolved.context,
			resolved.options,
			executionOf(this),
			clockOf(this)
		);
	}

	/** Compiles this generated profile's matching WASM kernel once. */
	async withWasm(): Promise<Fise<Strict>> {
		const instance = new Fise<Strict>(this.profile, {
			strict: this.strict,
			ttlSeconds: this.ttlSeconds,
			binary: binaryPolicyOf(this)
		});
		clocks.set(instance, clockOf(this));
		executions.set(instance, await createWasmKernelRunner(this.profile));
		return instance;
	}

	/** Creates a retained worker runtime for large asynchronous operations. */
	async parallel(options: ParallelOptions = {}): Promise<ParallelFise<Strict>> {
		const runtime = await createParallelKernelRuntime(this.profile, options);
		const profile = this.profile;
		const strict = this.strict;
		const ttlSeconds = this.ttlSeconds;
		const binary = binaryPolicyOf(this);
		const clock = clockOf(this);
		const instance: ParallelFise<Strict> = Object.freeze({
			profile,
			strict,
			ttlSeconds,
			workerCount: runtime.workerCount,
			minimumParallelBytes: runtime.minimumParallelBytes,
			encrypt: async <const Data>(
				data: EncryptInput<Strict, Data>,
				context?: FiseContext,
				...unexpected: readonly unknown[]
			): Promise<EncryptOutput<Strict, Data>> => {
				runtime.assertOpen();
				try {
					assertNoEncryptOptions(unexpected);
					const binaryInput = preflightEncryptInput(data);
					const payload = encodeValue(data);
					const coverage = resolveEncryptCoverage(
						binary,
						binaryInput,
						payload.length - 2
					);
					const envelope = await sealPayloadAsync(
						payload,
						profile,
						context,
						runtime.run,
						captureExpiresAtSeconds(ttlSeconds, clock),
						coverage
					);
					return representEnvelope(data, envelope) as EncryptOutput<Strict, Data>;
				} catch (error) {
					return recoverInput(strict, data, error) as EncryptOutput<Strict, Data>;
				}
			},
			decrypt: async <const Data>(
				envelope: DecryptInput<Strict, Data>,
				context?: FiseContext
			): Promise<DecryptOutput<Strict, Data>> => {
				runtime.assertOpen();
				try {
					return decodeValue(await openPayloadAsync(
						readEnvelope(envelope),
						profile,
						context,
						runtime.run,
						clock
					)) as DecryptOutput<Strict, Data>;
				} catch (error) {
					return recoverInput(strict, envelope, error) as DecryptOutput<Strict, Data>;
				}
			},
			decryptRange: async (
				envelope: Uint8Array,
				range: FiseRange,
				context?: FiseContext
			) => {
				runtime.assertOpen();
				return decryptBinaryRangeAsync(
					envelope,
					profile,
					range,
					context,
					runtime.run,
					clock
				);
			},
			decryptProgressive: (
				envelope: Uint8Array,
				contextOrOptions?: FiseContext | FiseProgressiveOptions,
				progressiveOptions?: FiseProgressiveOptions
			) => {
				runtime.assertOpen();
				const resolved = resolveProgressiveArguments(
					contextOrOptions,
					progressiveOptions
				);
				return decryptBinaryProgressiveAsync(
					envelope,
					profile,
					resolved.context,
					resolved.options,
					runtime.run,
					clock
				);
			},
			close: () => runtime.close()
		});
		return instance;
	}
}

export interface ParallelFise<Strict extends boolean = true> {
	readonly profile: Profile;
	readonly strict: Strict;
	readonly ttlSeconds: number | undefined;
	readonly workerCount: number;
	readonly minimumParallelBytes: number;
	encrypt<const Data>(
		data: EncryptInput<Strict, Data>,
		context?: FiseContext
	): Promise<EncryptOutput<Strict, Data>>;
	decrypt<const Data>(
		envelope: DecryptInput<Strict, Data>,
		context?: FiseContext
	): Promise<DecryptOutput<Strict, Data>>;
	decryptRange(
		envelope: Uint8Array,
		range: FiseRange,
		context?: FiseContext
	): Promise<Uint8Array>;
	decryptProgressive(
		envelope: Uint8Array,
		options?: FiseProgressiveOptions
	): AsyncGenerator<Uint8Array, void, void>;
	decryptProgressive(
		envelope: Uint8Array,
		context: FiseContext | undefined,
		options?: FiseProgressiveOptions
	): AsyncGenerator<Uint8Array, void, void>;
	close(): Promise<void>;
}

function representEnvelope<Data>(data: Data, envelope: Uint8Array): FiseEncryptedResult<Data> {
	return (isBytes(data) ? envelope : encodeBase64Url(envelope)) as FiseEncryptedResult<Data>;
}

function resolveProgressiveArguments(
	contextOrOptions: FiseContext | FiseProgressiveOptions | undefined,
	options: FiseProgressiveOptions | undefined
): Readonly<{
	context: FiseContext | undefined;
	options: FiseProgressiveOptions;
}> {
	if (options !== undefined) {
		return Object.freeze({
			context: contextOrOptions as FiseContext | undefined,
			options
		});
	}
	if (contextOrOptions === undefined) {
		return Object.freeze({ context: undefined, options: {} });
	}
	let isContext: boolean;
	try {
		isContext = Array.isArray(contextOrOptions);
	} catch (error) {
		throw new FiseError(
			"INVALID_INPUT",
			"FISE: progressive context or options could not be inspected.",
			error
		);
	}
	return isContext
		? Object.freeze({ context: contextOrOptions as FiseContext, options: {} })
		: Object.freeze({
			context: undefined,
			options: contextOrOptions as FiseProgressiveOptions
		});
}

function preflightEncryptInput(data: unknown): boolean {
	if (!isBytes(data)) return false;
	assertBinaryContentEnvelopeCapacity(
		checkedByteLength(data, "binary input", "INVALID_INPUT")
	);
	return true;
}

function assertNoEncryptOptions(unexpected: readonly unknown[]): void {
	if (unexpected.length !== 0) {
		throw new FiseError(
			"INVALID_INPUT",
			"FISE: encrypt options belong in the Fise constructor."
		);
	}
}

function readEnvelope(value: unknown): Uint8Array {
	if (typeof value === "string") {
		return decodeBase64Url(value, FISE_MAX_ENVELOPE_LENGTH);
	}
	if (isBytes(value)) return value;
	throw new FiseError(
		"INVALID_ENVELOPE",
		"FISE: encrypted data must be a Base64URL string or Uint8Array."
	);
}

function executionOf(instance: Fise<boolean>): ProfileKernelRunner {
	return executions.get(instance) ?? runProfileKernel;
}

function clockOf(instance: Fise<boolean>): FiseClock {
	return clocks.get(instance) ?? systemFiseClock;
}

function binaryPolicyOf(instance: Fise<boolean>): ResolvedFiseBinaryOptions | undefined {
	return binaryPolicies.get(instance);
}

/** @internal Deterministic instance clock seam for the repository test suite. */
export function setFiseClockForTesting(instance: Fise<boolean>, clock: FiseClock): void {
	if (!executions.has(instance) || typeof clock !== "function") {
		throw new FiseError("INVALID_INPUT", "FISE: test clock requires a Fise instance and function.");
	}
	clocks.set(instance, clock);
}

function normalizeFiseOptions(options: object): Readonly<{
	strict: boolean;
	ttlSeconds: number | undefined;
	binary: ResolvedFiseBinaryOptions | undefined;
}> {
	const properties = snapshotOwnDataProperties(
		options,
		["strict", "ttlSeconds", "binary"],
		"INVALID_INPUT",
		"options"
	);
	const strict = properties.get("strict");
	if (strict !== undefined && typeof strict !== "boolean") {
		throw new FiseError("INVALID_INPUT", "FISE: strict must be a boolean.");
	}
	return Object.freeze({
		strict: strict ?? true,
		ttlSeconds: normalizeTtlSeconds(properties.get("ttlSeconds")),
		binary: normalizeBinaryOptions(properties.get("binary"))
	});
}

function recoverInput<Strict extends boolean, Data>(
	strict: Strict,
	input: Data,
	error: unknown
): Strict extends true ? never : Data {
	if (
		strict ||
		!(error instanceof FiseError) ||
		error.code === "ENVELOPE_EXPIRED" ||
		error.code === "CLOCK_UNAVAILABLE"
	) throw error;
	return input as Strict extends true ? never : Data;
}

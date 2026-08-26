import { decodeValue, encodeValue } from "./codec.js";
import {
	openPayload,
	openPayloadAsync,
	sealPayload,
	sealPayloadAsync
} from "./envelope.js";
import {
	Profile,
	runProfileKernel,
	runtimeOf,
	type ProfileKernelRunner
} from "./profile.js";
import {
	decryptFramed,
	decryptFramedAsync,
	decryptProgressive,
	decryptProgressiveAsync,
	decryptRange,
	decryptRangeAsync,
	encryptFramed,
	encryptFramedAsync
} from "./framed.js";
import type {
	FiseContext,
	FiseFramedOptions,
	FiseProgressiveOptions,
	FiseRange,
	FiseValueInput,
	FiseValue
} from "./types.js";
import { createWasmKernelRunner } from "./wasm.js";
import {
	createParallelKernelRuntime,
	type ParallelOptions
} from "./parallel.js";

const executions = new WeakMap<Fise, ProfileKernelRunner>();

/** Runtime bound to one generated FISE 2.0 profile. */
export class Fise {
	readonly profile: Profile;

	constructor(profile: Profile) {
		runtimeOf(profile);
		this.profile = profile;
		executions.set(this, runProfileKernel);
		Object.freeze(this);
	}

	/** Creates one strict FISE 2.0 binary envelope. */
	encrypt<const Data>(
		data: Data & FiseValueInput<Data>,
		context?: FiseContext
	): Uint8Array {
		return sealPayload(encodeValue(data), this.profile, context, executionOf(this));
	}

	/** Restores the structured value or bytes declared by payload metadata. */
	decrypt(
		envelope: Uint8Array,
		context?: FiseContext
	): FiseValue {
		return decodeValue(openPayload(envelope, this.profile, context, executionOf(this)));
	}

	/** Splits binary data into independent FISF 2.0 frames. */
	encryptFramed(
		data: Uint8Array,
		context?: FiseContext,
		options: FiseFramedOptions = {}
	): Uint8Array {
		return encryptFramed(data, this.profile, context, options, executionOf(this));
	}

	/** Restores every binary frame in a strict FISF 2.0 container. */
	decryptFramed(
		container: Uint8Array,
		context?: FiseContext
	): Uint8Array {
		return decryptFramed(container, this.profile, context, executionOf(this));
	}

	/** Restores only frames intersecting one half-open binary byte range. */
	decryptRange(
		container: Uint8Array,
		range: FiseRange,
		context?: FiseContext
	): Uint8Array {
		return decryptRange(container, this.profile, range, context, executionOf(this));
	}

	/** Defers each independent frame restore until the consumer pulls it. */
	decryptProgressive(
		container: Uint8Array,
		context?: FiseContext,
		options: FiseProgressiveOptions = {}
	): AsyncGenerator<Uint8Array, void, void> {
		return decryptProgressive(container, this.profile, context, options, executionOf(this));
	}

	/** Compiles this generated profile's matching WASM kernel once. */
	async withWasm(): Promise<Fise> {
		const instance = new Fise(this.profile);
		executions.set(instance, await createWasmKernelRunner(this.profile));
		return instance;
	}

	/** Creates a retained worker runtime for large asynchronous operations. */
	async parallel(options: ParallelOptions = {}): Promise<ParallelFise> {
		const runtime = await createParallelKernelRuntime(this.profile, options);
		const profile = this.profile;
		const instance: ParallelFise = Object.freeze({
			profile,
			workerCount: runtime.workerCount,
			minimumParallelBytes: runtime.minimumParallelBytes,
			encrypt: async (data: unknown, context?: FiseContext) => {
				runtime.assertOpen();
				return sealPayloadAsync(encodeValue(data), profile, context, runtime.run);
			},
			decrypt: async (envelope: Uint8Array, context?: FiseContext) => {
				runtime.assertOpen();
				return decodeValue(await openPayloadAsync(envelope, profile, context, runtime.run));
			},
			encryptFramed: async (
				data: Uint8Array,
				context?: FiseContext,
				framedOptions: FiseFramedOptions = {}
			) => {
				runtime.assertOpen();
				return encryptFramedAsync(data, profile, context, framedOptions, runtime.run);
			},
			decryptFramed: async (container: Uint8Array, context?: FiseContext) => {
				runtime.assertOpen();
				return decryptFramedAsync(container, profile, context, runtime.run);
			},
			decryptRange: async (
				container: Uint8Array,
				range: FiseRange,
				context?: FiseContext
			) => {
				runtime.assertOpen();
				return decryptRangeAsync(container, profile, range, context, runtime.run);
			},
			decryptProgressive: (
				container: Uint8Array,
				context?: FiseContext,
				progressiveOptions: FiseProgressiveOptions = {}
			) => {
				runtime.assertOpen();
				return decryptProgressiveAsync(
					container,
					profile,
					context,
					progressiveOptions,
					runtime.run
				);
			},
			close: () => runtime.close()
		});
		return instance;
	}
}

export interface ParallelFise {
	readonly profile: Profile;
	readonly workerCount: number;
	readonly minimumParallelBytes: number;
	encrypt<Data>(
		data: Data & FiseValueInput<Data>,
		context?: FiseContext
	): Promise<Uint8Array>;
	decrypt(
		envelope: Uint8Array,
		context?: FiseContext
	): Promise<FiseValue>;
	encryptFramed(
		data: Uint8Array,
		context?: FiseContext,
		options?: FiseFramedOptions
	): Promise<Uint8Array>;
	decryptFramed(
		container: Uint8Array,
		context?: FiseContext
	): Promise<Uint8Array>;
	decryptRange(
		container: Uint8Array,
		range: FiseRange,
		context?: FiseContext
	): Promise<Uint8Array>;
	decryptProgressive(
		container: Uint8Array,
		context?: FiseContext,
		options?: FiseProgressiveOptions
	): AsyncGenerator<Uint8Array, void, void>;
	close(): Promise<void>;
}

function executionOf(instance: Fise): ProfileKernelRunner {
	return executions.get(instance) ?? runProfileKernel;
}

import { FiseError } from "../errors.js";
import { copyBytes } from "./bytes.js";
import {
	runProfileKernel,
	runtimeOf,
	type Profile,
	type ProfileAsyncKernelRunner,
	type ProfileContextState,
	type ProfileRuntime
} from "./profile.js";
import type { FiseContext } from "./types.js";

const DEFAULT_MINIMUM_PARALLEL_BYTES = 256 * 1024;
const MAX_WORKERS = 32;
const STARTUP_TIMEOUT_MS = 10_000;

export interface ParallelOptions {
	readonly workerCount?: number;
	readonly minimumParallelBytes?: number;
}

export interface ParallelKernelRuntime {
	readonly run: ProfileAsyncKernelRunner;
	readonly workerCount: number;
	readonly minimumParallelBytes: number;
	assertOpen(): void;
	close(): Promise<void>;
}

interface InitRequest {
	readonly type: "init";
	readonly module: ArrayBuffer;
}

interface RunRequest {
	readonly type: "run";
	readonly id: number;
	readonly operation: "forward" | "reverse";
	readonly input: ArrayBuffer;
	readonly contextSegment: ArrayBuffer;
	readonly contextState: ProfileContextState;
	readonly absoluteOffset: number;
}

interface ResultMessage {
	readonly type: "result";
	readonly id: number;
	readonly output: ArrayBuffer;
}

interface FailureMessage {
	readonly type: "failure";
	readonly id: number;
	readonly error: string;
}

interface ReadyMessage {
	readonly type: "ready";
}

interface FatalMessage {
	readonly type: "fatal";
	readonly error: string;
}

type WorkerMessage = ResultMessage | FailureMessage | ReadyMessage | FatalMessage;

interface WorkerAdapter {
	initialize(module: Uint8Array): Promise<void>;
	run(request: Omit<RunRequest, "id">): Promise<Uint8Array>;
	close(): Promise<void>;
}

export function isParallelSupported(): boolean {
	return isNodeRuntime() || typeof globalThis.Worker === "function";
}

export async function createParallelKernelRuntime(
	profile: Profile,
	options: ParallelOptions = {}
): Promise<ParallelKernelRuntime> {
	if (!isParallelSupported()) {
		throw new FiseError("PARALLEL_UNAVAILABLE", "FISE: dedicated workers are unavailable.");
	}
	const normalized = normalizeOptions(options);
	const runtime = runtimeOf(profile);
	if (!runtime.wasmModule) {
		throw new FiseError("PARALLEL_UNAVAILABLE", "FISE: generated profile has no worker kernel.");
	}
	const adapters: WorkerAdapter[] = [];
	try {
		for (let index = 0; index < normalized.workerCount; index++) {
			adapters.push(await createAdapter(index));
		}
		await Promise.all(adapters.map(adapter => adapter.initialize(runtime.wasmModule!)));
	} catch (error) {
		await Promise.allSettled(adapters.map(adapter => adapter.close()));
		if (error instanceof FiseError) throw error;
		throw new FiseError("PARALLEL_UNAVAILABLE", "FISE: worker startup failed.", error);
	}

	let closed = false;
	const assertOpen = (): void => {
		if (closed) throw new FiseError("PARALLEL_UNAVAILABLE", "FISE: worker runtime is closed.");
	};
	const run: ProfileAsyncKernelRunner = async (
		operation,
		selectedRuntime,
		input,
		contextSegment,
		contextState,
		absoluteOffset,
		context
	) => {
		assertOpen();
		if (selectedRuntime !== runtime) {
			throw new FiseError("PROFILE_MISMATCH", "FISE: worker runtime received another profile.");
		}
		if (input.length < normalized.minimumParallelBytes || input.length === 0) {
			return runProfileKernel(
				operation,
				runtime,
				input,
				contextSegment,
				contextState,
				absoluteOffset,
				context
			);
		}
		return runParallel(
			adapters,
			operation,
			runtime,
			input,
			contextSegment,
			contextState,
			absoluteOffset,
			context
		);
	};
	return Object.freeze({
		run,
		workerCount: normalized.workerCount,
		minimumParallelBytes: normalized.minimumParallelBytes,
		assertOpen,
		close: async () => {
			if (closed) return;
			closed = true;
			await Promise.allSettled(adapters.map(adapter => adapter.close()));
		}
	});
}

async function runParallel(
	adapters: readonly WorkerAdapter[],
	operation: "forward" | "reverse",
	_runtime: ProfileRuntime,
	input: Uint8Array,
	contextSegment: Uint8Array,
	contextState: ProfileContextState,
	absoluteOffset: number,
	_context: FiseContext
): Promise<Uint8Array> {
	const chunkCount = Math.min(adapters.length, input.length);
	const chunkSize = Math.ceil(input.length / chunkCount);
	const chunks: Promise<Uint8Array>[] = [];
	let slot = 0;
	for (let offset = 0; offset < input.length; offset += chunkSize) {
		const inputCopy = input.slice(offset, Math.min(offset + chunkSize, input.length));
		const segmentCopy = copyBytes(contextSegment);
		chunks.push(adapters[slot++ % adapters.length].run({
			type: "run",
			operation,
			input: inputCopy.buffer as ArrayBuffer,
			contextSegment: segmentCopy.buffer as ArrayBuffer,
			contextState,
			absoluteOffset: absoluteOffset + offset
		}));
	}
	const restored = await Promise.all(chunks);
	const output = new Uint8Array(input.length);
	let offset = 0;
	for (const chunk of restored) {
		output.set(chunk, offset);
		offset += chunk.length;
	}
	return output;
}

async function createAdapter(index: number): Promise<WorkerAdapter> {
	const workerUrl = new URL("./workers/profileWorker.js", import.meta.url);
	if (isNodeRuntime()) {
		const { Worker } = await import("node:worker_threads");
		const worker = new Worker(workerUrl, {
			name: `fise-profile-${index + 1}`,
			execArgv: process.execArgv.filter(argument => !argument.startsWith("--input-type"))
		});
		return adapterFor(
			(message, transfer) => worker.postMessage(message, transfer),
			listener => worker.on("message", listener),
			listener => {
				worker.on("error", listener);
				worker.on("messageerror", listener);
				worker.on("exit", code => {
					listener(new Error(`worker exited with code ${code}`));
				});
			},
			async () => void await worker.terminate()
		);
	}
	if (typeof globalThis.Worker === "function") {
		const worker = new Worker(workerUrl, { type: "module", name: `fise-profile-${index + 1}` });
		return adapterFor(
			(message, transfer) => worker.postMessage(message, transfer),
			listener => worker.addEventListener("message", event => listener(event.data as WorkerMessage)),
			listener => {
				worker.addEventListener("error", event => listener(event.error ?? new Error(event.message)));
				worker.addEventListener("messageerror", () => listener(new Error("worker message error")));
			},
			async () => void worker.terminate()
		);
	}
	throw new FiseError("PARALLEL_UNAVAILABLE", "FISE: no worker constructor is available.");
}

/** @internal Worker lifecycle seam used by focused failure verification. */
export function adapterFor(
	post: (message: InitRequest | RunRequest, transfer: ArrayBuffer[]) => void,
	onMessage: (listener: (message: WorkerMessage) => void) => void,
	onFailure: (listener: (error: unknown) => void) => void,
	terminate: () => Promise<void>
): WorkerAdapter {
	let nextId = 1;
	let closed = false;
	let failed: FiseError | undefined;
	let startupResolve: (() => void) | undefined;
	let startupReject: ((error: unknown) => void) | undefined;
	let tail = Promise.resolve();
	const pending = new Map<number, Readonly<{
		resolve(value: Uint8Array): void;
		reject(error: unknown): void;
	}>>();

	onMessage(message => {
		if (message.type === "ready") {
			startupResolve?.();
			return;
		}
		if (message.type === "fatal") {
			const error = new FiseError("PARALLEL_WORKER_FAILED", `FISE worker: ${message.error}`);
			failAdapter(error);
			return;
		}
		const task = pending.get(message.id);
		if (!task) return;
		pending.delete(message.id);
		if (message.type === "failure") {
			task.reject(new FiseError("PARALLEL_WORKER_FAILED", `FISE worker: ${message.error}`));
		} else {
			task.resolve(new Uint8Array(message.output));
		}
	});
	onFailure(error => failAdapter(
		error instanceof FiseError
			? error
			: new FiseError("PARALLEL_WORKER_FAILED", "FISE: worker lifecycle failed.", error)
	));

	function failAdapter(error: FiseError): void {
		if (closed || failed) return;
		failed = error;
		startupReject?.(error);
		failPending(error);
	}

	function failPending(error: unknown): void {
		for (const task of pending.values()) task.reject(error);
		pending.clear();
	}

	return {
		initialize: module => new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new FiseError("PARALLEL_UNAVAILABLE", "FISE: worker startup timed out.")),
				STARTUP_TIMEOUT_MS
			);
			startupResolve = () => {
				clearTimeout(timeout);
				resolve();
			};
			startupReject = error => {
				clearTimeout(timeout);
				reject(error);
			};
			const copy = copyBytes(module);
			post({ type: "init", module: copy.buffer as ArrayBuffer }, [copy.buffer as ArrayBuffer]);
		}),
			run: request => {
				const scheduled = tail.then(() => {
					if (closed) throw new FiseError("PARALLEL_UNAVAILABLE", "FISE: worker is closed.");
					if (failed) throw failed;
					return new Promise<Uint8Array>((resolve, reject) => {
						const id = nextId++;
						pending.set(id, Object.freeze({ resolve, reject }));
						try {
							post({ ...request, id }, [request.input, request.contextSegment]);
						} catch (error) {
							failAdapter(new FiseError(
								"PARALLEL_WORKER_FAILED",
								"FISE: unable to dispatch work to a worker.",
								error
							));
						}
					});
			});
			tail = scheduled.then(() => undefined, () => undefined);
			return scheduled;
		},
		close: async () => {
			if (closed) return;
			closed = true;
			failPending(new FiseError("PARALLEL_UNAVAILABLE", "FISE: worker was closed."));
			await terminate();
		}
	};
}

function normalizeOptions(options: ParallelOptions): Required<ParallelOptions> {
	if (!options || typeof options !== "object" || Array.isArray(options)) {
		throw new FiseError("INVALID_INPUT", "FISE: parallel options must be an object.");
	}
	for (const key of Reflect.ownKeys(options)) {
		if (
			typeof key === "symbol" ||
			(key !== "workerCount" && key !== "minimumParallelBytes")
		) {
			throw new FiseError("INVALID_INPUT", "FISE: parallel options contain an unknown field.");
		}
		const descriptor = Object.getOwnPropertyDescriptor(options, key);
		if (!descriptor || !("value" in descriptor)) {
			throw new FiseError("INVALID_INPUT", "FISE: parallel options must not contain accessors.");
		}
	}
	const workerCount = ownValue(options, "workerCount") ?? defaultWorkerCount();
	const minimumParallelBytes = ownValue(options, "minimumParallelBytes") ?? DEFAULT_MINIMUM_PARALLEL_BYTES;
	if (
		typeof workerCount !== "number" ||
		!Number.isInteger(workerCount) ||
		workerCount < 1 ||
		workerCount > MAX_WORKERS
	) {
		throw new FiseError("INVALID_INPUT", `FISE: workerCount must be from 1 through ${MAX_WORKERS}.`);
	}
	if (
		typeof minimumParallelBytes !== "number" ||
		!Number.isSafeInteger(minimumParallelBytes) ||
		minimumParallelBytes < 0
	) {
		throw new FiseError("INVALID_INPUT", "FISE: minimumParallelBytes must be non-negative.");
	}
	return Object.freeze({ workerCount, minimumParallelBytes });
}

function ownValue(object: object, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(object, key);
	return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function defaultWorkerCount(): number {
	const concurrency = globalThis.navigator?.hardwareConcurrency;
	return Number.isInteger(concurrency) && concurrency > 1
		? Math.min(8, concurrency - 1)
		: 2;
}

function isNodeRuntime(): boolean {
	return (
		typeof globalThis.window === "undefined" &&
		typeof process !== "undefined" &&
		typeof process.versions?.node === "string"
	);
}

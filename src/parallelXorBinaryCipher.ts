import {
	optionalAbortSignal,
	snapshotOperationOptions,
	throwIfAborted
} from "./core/operationOptions.js";
import { registerBuiltInAsyncBinaryCipher } from "./core/transformRegistry.js";
import { assertUint8ArrayValue } from "./core/valueValidation.js";
import { xorBinaryCipher } from "./core/xorBinaryCipher.js";
import { FiseError } from "./errors.js";
import {
	FiseAsyncBinaryCipher,
	FiseAsyncBinaryTransformOptions
} from "./types.js";

const DEFAULT_MINIMUM_PARALLEL_BYTES = 256 * 1024;
const MAX_WORKERS = 32;
const WORKER_READY_TIMEOUT_MS = 10_000;
const PARALLEL_OPTION_KEYS = new Set([
	"workerCount",
	"minimumParallelBytes"
]);

export interface ParallelXorBinaryCipherOptions {
	/** Number of dedicated workers retained by the backend. Default: 2-8. */
	readonly workerCount?: number;
	/** Inputs below this byte length use the local JS loop. Default: 256 KiB. */
	readonly minimumParallelBytes?: number;
}

export interface ParallelXorBinaryCipher extends FiseAsyncBinaryCipher {
	readonly workerCount: number;
	readonly minimumParallelBytes: number;
	/** Terminates retained workers. Calls after close fail explicitly. */
	close(): Promise<void>;
}

interface WorkerRequest {
	readonly id: number;
	readonly input: ArrayBuffer;
	readonly salt: ArrayBuffer;
	readonly absoluteOffset: number;
}

interface WorkerSuccess {
	readonly id: number;
	readonly output: ArrayBuffer;
}

interface WorkerFailure {
	readonly id: number;
	readonly error: string;
}

interface WorkerReady {
	readonly ready: true;
}

type WorkerMessage = WorkerSuccess | WorkerFailure | WorkerReady;

interface WorkerAdapter {
	readonly ready: Promise<void>;
	postMessage(message: WorkerRequest, transfer: ArrayBuffer[]): void;
	onMessage(listener: (message: WorkerMessage) => void): void;
	onFailure(listener: (error: unknown) => void): void;
	terminate(): Promise<void>;
}

interface WorkerTask {
	readonly id: number;
	readonly input: Uint8Array;
	readonly salt: Uint8Array;
	readonly absoluteOffset: number;
	readonly signal?: AbortSignal;
	readonly resolve: (output: Uint8Array) => void;
	readonly reject: (error: FiseError) => void;
	onAbort?: () => void;
	settled: boolean;
	running: boolean;
}

interface WorkerSlot {
	readonly adapter: WorkerAdapter;
	active?: WorkerTask;
}

/** API-presence check only; CSP and worker startup can still reject creation. */
export function isParallelXorBinaryCipherSupported(): boolean {
	return isNodeRuntime() || typeof globalThis.Worker === "function";
}

/**
 * Creates an explicit worker-backed implementation of `fise.xor.u8.v1`.
 * Worker chunks preserve the absolute salt index, so the output is byte-for-
 * byte compatible with the synchronous JavaScript and WASM implementations.
 */
export async function createParallelXorBinaryCipher(
	options: ParallelXorBinaryCipherOptions = {}
): Promise<ParallelXorBinaryCipher> {
	const normalized = normalizeParallelOptions(options);
	if (!isParallelXorBinaryCipherSupported()) {
		throw new FiseError(
			"PARALLEL_UNAVAILABLE",
			"FISE: dedicated workers are not available in this runtime."
		);
	}

	let pool: XorWorkerPool | undefined;
	try {
		const adapters = await Promise.all(
			Array.from(
				{ length: normalized.workerCount },
				(_, index) => createWorkerAdapter(index)
			)
		);
		pool = new XorWorkerPool(adapters);
		await pool.ready();
	} catch (error) {
		await pool?.close();
		if (error instanceof FiseError) throw error;
		throw new FiseError(
			"PARALLEL_UNAVAILABLE",
			"FISE: unable to initialize the parallel XOR worker pool.",
			error
		);
	}

	const activePool = pool;
	const transform = async (
		input: Uint8Array,
		salt: Uint8Array,
		operationOptions: FiseAsyncBinaryTransformOptions = {}
	): Promise<Uint8Array> => {
		assertUint8ArrayValue(input, "parallel transform input", "INVALID_INPUT");
		assertUint8ArrayValue(salt, "parallel transform salt", "INVALID_SALT");
		const ownedInput = copyTransformBytes(input, "input");
		const ownedSalt = copyTransformBytes(salt, "salt");
		const signal = normalizeTransformSignal(operationOptions);
		throwIfAborted(signal);
		activePool.ensureOpen();
		if (ownedInput.length > 0 && ownedSalt.length === 0) {
			throw new FiseError(
				"INVALID_SALT",
				"FISE: parallel binary XOR salt must not be empty."
			);
		}
		if (ownedInput.length === 0) return new Uint8Array();
		if (ownedInput.length < normalized.minimumParallelBytes) {
			return xorBinaryCipher.encrypt(ownedInput, ownedSalt);
		}
		return activePool.transform(ownedInput, ownedSalt, signal);
	};

	return registerBuiltInAsyncBinaryCipher(Object.freeze({
		id: "fise.xor.u8.v1",
		workerCount: normalized.workerCount,
		minimumParallelBytes: normalized.minimumParallelBytes,
		encrypt: transform,
		decrypt: transform,
		close: () => activePool.close()
	}));
}

class XorWorkerPool {
	private readonly slots: WorkerSlot[];
	private readonly queue: WorkerTask[] = [];
	private nextTaskId = 1;
	private closed = false;
	private failure?: FiseError;

	constructor(adapters: WorkerAdapter[]) {
		this.slots = adapters.map(adapter => ({ adapter }));
		for (const slot of this.slots) {
			slot.adapter.onMessage(message => this.receive(slot, message));
			slot.adapter.onFailure(error => this.fail(error));
		}
	}

	async ready(): Promise<void> {
		try {
			await Promise.all(this.slots.map(slot => slot.adapter.ready));
		} catch (error) {
			this.fail(error);
			throw this.failure;
		}
	}

	ensureOpen(): void {
		this.assertOpen();
	}

	async transform(
		input: Uint8Array,
		salt: Uint8Array,
		signal: AbortSignal | undefined
	): Promise<Uint8Array> {
		this.assertOpen();
		throwIfAborted(signal);
		const chunkCount = Math.min(this.slots.length, input.length);
		const chunkSize = Math.ceil(input.length / chunkCount);
		const chunks: Promise<Uint8Array>[] = [];
		for (let offset = 0; offset < input.length; offset += chunkSize) {
			chunks.push(this.runChunk(
				input.slice(offset, Math.min(offset + chunkSize, input.length)),
				salt.slice(),
				offset,
				signal
			));
		}
		const outputs = await Promise.all(chunks);
		throwIfAborted(signal);
		const result = new Uint8Array(input.length);
		let outputOffset = 0;
		for (const output of outputs) {
			result.set(output, outputOffset);
			outputOffset += output.length;
		}
		return result;
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		const error = new FiseError(
			"PARALLEL_WORKER_FAILED",
			"FISE: parallel XOR worker pool is closed."
		);
		for (const task of this.allTasks()) this.rejectTask(task, error);
		this.queue.length = 0;
		await Promise.allSettled(this.slots.map(slot => slot.adapter.terminate()));
	}

	private runChunk(
		input: Uint8Array,
		salt: Uint8Array,
		absoluteOffset: number,
		signal: AbortSignal | undefined
	): Promise<Uint8Array> {
		this.assertOpen();
		return new Promise((resolve, reject) => {
			const task: WorkerTask = {
				id: this.nextTaskId++,
				input,
				salt,
				absoluteOffset,
				signal,
				resolve,
				reject,
				settled: false,
				running: false
			};
			if (signal) {
				task.onAbort = () => {
					this.rejectTask(task, new FiseError(
						"OPERATION_ABORTED",
						"FISE: parallel transform was aborted."
					));
					if (!task.running) this.pump();
				};
				signal.addEventListener("abort", task.onAbort, { once: true });
			}
			if (signal?.aborted) {
				task.onAbort?.();
				return;
			}
			this.queue.push(task);
			this.pump();
		});
	}

	private pump(): void {
		if (this.closed || this.failure) return;
		for (const slot of this.slots) {
			if (slot.active) continue;
			let task = this.queue.shift();
			while (task?.settled) task = this.queue.shift();
			if (!task) return;
			slot.active = task;
			task.running = true;
			try {
				const inputBuffer = task.input.buffer as ArrayBuffer;
				const saltBuffer = task.salt.buffer as ArrayBuffer;
				slot.adapter.postMessage({
					id: task.id,
					input: inputBuffer,
					salt: saltBuffer,
					absoluteOffset: task.absoluteOffset
				}, [inputBuffer, saltBuffer]);
			} catch (error) {
				this.fail(error);
				return;
			}
		}
	}

	private receive(slot: WorkerSlot, message: WorkerMessage): void {
		if ("ready" in message) return;
		const task = slot.active;
		if (!task || message.id !== task.id) {
			this.fail(new Error("worker returned an unexpected task identifier"));
			return;
		}
		if ("error" in message) {
			this.fail(new Error(message.error));
			return;
		}
		if (!(message.output instanceof ArrayBuffer)) {
			this.fail(new Error("worker returned an invalid output buffer"));
			return;
		}
		slot.active = undefined;
		task.running = false;
		if (!task.settled) {
			task.settled = true;
			this.cleanupTask(task);
			task.resolve(new Uint8Array(message.output));
		} else {
			this.cleanupTask(task);
		}
		this.pump();
	}

	private fail(cause: unknown): void {
		if (this.failure || this.closed) return;
		this.failure = new FiseError(
			"PARALLEL_WORKER_FAILED",
			"FISE: parallel XOR worker failed.",
			cause
		);
		for (const task of this.allTasks()) this.rejectTask(task, this.failure);
		this.queue.length = 0;
		void Promise.allSettled(this.slots.map(slot => slot.adapter.terminate()));
	}

	private *allTasks(): Iterable<WorkerTask> {
		yield* this.queue;
		for (const slot of this.slots) {
			if (slot.active) yield slot.active;
		}
	}

	private rejectTask(task: WorkerTask, error: FiseError): void {
		if (task.settled) return;
		task.settled = true;
		this.cleanupTask(task);
		task.reject(error);
	}

	private cleanupTask(task: WorkerTask): void {
		if (task.signal && task.onAbort) {
			task.signal.removeEventListener("abort", task.onAbort);
		}
	}

	private assertOpen(): void {
		if (this.failure) throw this.failure;
		if (this.closed) {
			throw new FiseError(
				"PARALLEL_WORKER_FAILED",
				"FISE: parallel XOR worker pool is closed."
			);
		}
	}
}

async function createWorkerAdapter(index: number): Promise<WorkerAdapter> {
	const workerUrl = new URL("./workers/xorWorker.js", import.meta.url);
	if (isNodeRuntime()) {
		const { Worker } = await import("node:worker_threads");
		const worker = new Worker(workerUrl, {
			name: `fise-xor-${index + 1}`,
			execArgv: process.execArgv.filter(
				argument => !argument.startsWith("--input-type")
			)
		});
		return createNodeWorkerAdapter(worker);
	}
	if (typeof globalThis.Worker === "function") {
		const worker = new Worker(workerUrl, {
			type: "module",
			name: `fise-xor-${index + 1}`
		});
		return createBrowserWorkerAdapter(worker);
	}
	throw new FiseError(
		"PARALLEL_UNAVAILABLE",
		"FISE: no supported dedicated-worker constructor is available."
	);
}

function createBrowserWorkerAdapter(worker: Worker): WorkerAdapter {
	const messageListeners = new Set<(message: WorkerMessage) => void>();
	const failureListeners = new Set<(error: unknown) => void>();
	let terminating = false;
	const ready = createReadyPromise(messageListeners, failureListeners);
	worker.addEventListener("message", event => {
		for (const listener of messageListeners) listener(event.data as WorkerMessage);
	});
	worker.addEventListener("error", event => {
		if (terminating) return;
		for (const listener of failureListeners) {
			listener(event.error ?? new Error(event.message));
		}
	});
	worker.addEventListener("messageerror", () => {
		if (terminating) return;
		for (const listener of failureListeners) {
			listener(new Error("worker message could not be deserialized"));
		}
	});
	return {
		ready,
		postMessage: (message, transfer) => worker.postMessage(message, transfer),
		onMessage: listener => void messageListeners.add(listener),
		onFailure: listener => void failureListeners.add(listener),
		terminate: async () => {
			terminating = true;
			worker.terminate();
		}
	};
}

function createNodeWorkerAdapter(
	worker: import("node:worker_threads").Worker
): WorkerAdapter {
	const messageListeners = new Set<(message: WorkerMessage) => void>();
	const failureListeners = new Set<(error: unknown) => void>();
	let terminating = false;
	const ready = createReadyPromise(messageListeners, failureListeners);
	worker.on("message", message => {
		for (const listener of messageListeners) listener(message as WorkerMessage);
	});
	worker.on("error", error => {
		if (terminating) return;
		for (const listener of failureListeners) listener(error);
	});
	worker.on("messageerror", error => {
		if (terminating) return;
		for (const listener of failureListeners) listener(error);
	});
	worker.on("exit", code => {
		if (terminating || code === 0) return;
		for (const listener of failureListeners) {
			listener(new Error(`worker exited with code ${code}`));
		}
	});
	return {
		ready,
		postMessage: (message, transfer) => worker.postMessage(message, transfer),
		onMessage: listener => void messageListeners.add(listener),
		onFailure: listener => void failureListeners.add(listener),
		terminate: async () => {
			terminating = true;
			await worker.terminate();
		}
	};
}

function createReadyPromise(
	messageListeners: Set<(message: WorkerMessage) => void>,
	failureListeners: Set<(error: unknown) => void>
): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			reject(new FiseError(
				"PARALLEL_UNAVAILABLE",
				"FISE: parallel XOR worker startup timed out."
			));
		}, WORKER_READY_TIMEOUT_MS);
		const onMessage = (message: WorkerMessage) => {
			if (!("ready" in message) || message.ready !== true) return;
			cleanup();
			resolve();
		};
		const onFailure = (error: unknown) => {
			cleanup();
			reject(error);
		};
		function cleanup() {
			clearTimeout(timeout);
			messageListeners.delete(onMessage);
			failureListeners.delete(onFailure);
		}
		messageListeners.add(onMessage);
		failureListeners.add(onFailure);
	});
}

function normalizeParallelOptions(options: unknown): {
	readonly workerCount: number;
	readonly minimumParallelBytes: number;
} {
	const source = snapshotOperationOptions(options, PARALLEL_OPTION_KEYS, "parallel options");
	const workerCount = source.workerCount === undefined
		? defaultWorkerCount()
		: source.workerCount;
	if (
		typeof workerCount !== "number" ||
		!Number.isInteger(workerCount) ||
		workerCount < 1 ||
		workerCount > MAX_WORKERS
	) {
		throw new FiseError(
			"INVALID_INPUT",
			`FISE: workerCount must be an integer from 1 through ${MAX_WORKERS}.`
		);
	}
	const minimumParallelBytes = source.minimumParallelBytes === undefined
		? DEFAULT_MINIMUM_PARALLEL_BYTES
		: source.minimumParallelBytes;
	if (
		typeof minimumParallelBytes !== "number" ||
		!Number.isSafeInteger(minimumParallelBytes) ||
		minimumParallelBytes < 0
	) {
		throw new FiseError(
			"INVALID_INPUT",
			"FISE: minimumParallelBytes must be a non-negative safe integer."
		);
	}
	return Object.freeze({ workerCount, minimumParallelBytes });
}

function normalizeTransformSignal(options: unknown): AbortSignal | undefined {
	const source = snapshotOperationOptions(
		options,
		new Set(["signal"]),
		"parallel transform options"
	);
	return optionalAbortSignal(source.signal);
}

function defaultWorkerCount(): number {
	const hardwareConcurrency = globalThis.navigator?.hardwareConcurrency;
	if (Number.isInteger(hardwareConcurrency) && hardwareConcurrency > 1) {
		return Math.min(MAX_WORKERS, 8, Math.max(2, hardwareConcurrency - 1));
	}
	return 2;
}

function isNodeRuntime(): boolean {
	return (
		typeof globalThis.window === "undefined" &&
		typeof process !== "undefined" &&
		typeof process.versions?.node === "string"
	);
}

function copyTransformBytes(value: Uint8Array, label: string): Uint8Array {
	try {
		const copy = new Uint8Array(value.length);
		copy.set(value);
		return copy;
	} catch (error) {
		throw new FiseError(
			"ENVELOPE_LIMIT",
			`FISE: unable to snapshot parallel transform ${label} of length ${value.length}.`,
			error
		);
	}
}

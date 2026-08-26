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
	readonly contextState: readonly [number, number, number, number];
	readonly absoluteOffset: number;
}

type WorkerRequest = InitRequest | RunRequest;

interface WorkerSuccess {
	readonly type: "result";
	readonly id: number;
	readonly output: ArrayBuffer;
}

interface WorkerFailure {
	readonly type: "failure";
	readonly id: number;
	readonly error: string;
}

interface WorkerReady {
	readonly type: "ready";
}

interface WorkerFatal {
	readonly type: "fatal";
	readonly error: string;
}

type WorkerResponse = WorkerSuccess | WorkerFailure | WorkerReady | WorkerFatal;
type PostResult = (message: WorkerResponse, transfer?: ArrayBuffer[]) => void;

interface KernelExports extends WebAssembly.Exports {
	readonly memory: WebAssembly.Memory;
	readonly forward: (...arguments_: number[]) => void;
	readonly reverse: (...arguments_: number[]) => void;
}

const PAGE_BYTES = 65_536;
const MAX_MEMORY_PAGES = 8192;
let kernel: KernelExports | undefined;

async function processRequest(request: WorkerRequest, post: PostResult): Promise<void> {
	if (request?.type === "init") {
		try {
			if (!(request.module instanceof ArrayBuffer)) throw new Error("invalid WASM module");
			const module = await WebAssembly.compile(request.module);
			const instance = await WebAssembly.instantiate(module);
			const exports = instance.exports as KernelExports;
			if (
				!(exports.memory instanceof WebAssembly.Memory) ||
				typeof exports.forward !== "function" ||
				typeof exports.reverse !== "function"
			) {
				throw new Error("invalid generated kernel exports");
			}
			kernel = exports;
			post({ type: "ready" });
		} catch (error) {
			post({ type: "fatal", error: errorMessage(error) });
		}
		return;
	}

	const id = request?.id;
	try {
		if (!kernel) throw new Error("worker is not initialized");
		if (
			!Number.isSafeInteger(id) ||
			(request.operation !== "forward" && request.operation !== "reverse") ||
			!(request.input instanceof ArrayBuffer) ||
			!(request.contextSegment instanceof ArrayBuffer) ||
			!Array.isArray(request.contextState) ||
			request.contextState.length !== 4 ||
			!Number.isSafeInteger(request.absoluteOffset) ||
			request.absoluteOffset < 0
		) {
			throw new Error("invalid worker request");
		}
		const input = new Uint8Array(request.input);
		const contextSegment = new Uint8Array(request.contextSegment);
		if (contextSegment.length === 0) throw new Error("context segment must not be empty");
		const requiredBytes = input.length + contextSegment.length;
		ensureMemory(kernel.memory, requiredBytes);
		const memory = new Uint8Array(kernel.memory.buffer);
		memory.set(input, 0);
		memory.set(contextSegment, input.length);
		kernel[request.operation](
			0,
			input.length,
			input.length,
			contextSegment.length,
			request.contextState[0],
			request.contextState[1],
			request.contextState[2],
			request.contextState[3],
			request.absoluteOffset
		);
		const output = memory.slice(0, input.length);
		memory.fill(0, 0, requiredBytes);
		post({ type: "result", id, output: output.buffer }, [output.buffer]);
	} catch (error) {
		post({
			type: "failure",
			id: Number.isSafeInteger(id) ? id : -1,
			error: errorMessage(error)
		});
	}
}

function ensureMemory(memory: WebAssembly.Memory, requiredBytes: number): void {
	const requiredPages = Math.max(1, Math.ceil(requiredBytes / PAGE_BYTES));
	if (requiredPages > MAX_MEMORY_PAGES) throw new Error("WASM memory limit exceeded");
	const currentPages = memory.buffer.byteLength / PAGE_BYTES;
	if (requiredPages > currentPages) memory.grow(requiredPages - currentPages);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "unknown worker failure";
}

interface BrowserWorkerScope {
	postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
	onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}

const browserScope = globalThis as unknown as Partial<BrowserWorkerScope>;
if (typeof browserScope.postMessage === "function") {
	browserScope.onmessage = event => {
		void processRequest(
			event.data,
			(message, transfer = []) => browserScope.postMessage!(message, transfer)
		);
	};
} else {
	const { parentPort } = await import("node:worker_threads");
	if (!parentPort) throw new Error("FISE profile worker has no parent port");
	parentPort.on("message", (request: WorkerRequest) => {
		void processRequest(
			request,
			(message, transfer = []) => parentPort.postMessage(message, transfer)
		);
	});
}

export {};

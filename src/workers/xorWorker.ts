interface XorWorkerRequest {
	readonly id: number;
	readonly input: ArrayBuffer;
	readonly salt: ArrayBuffer;
	readonly absoluteOffset: number;
}

interface XorWorkerSuccess {
	readonly id: number;
	readonly output: ArrayBuffer;
}

interface XorWorkerFailure {
	readonly id: number;
	readonly error: string;
}

interface XorWorkerReady {
	readonly ready: true;
}

type PostResult = (
	message: XorWorkerSuccess | XorWorkerFailure | XorWorkerReady,
	transfer?: ArrayBuffer[]
) => void;

function processRequest(request: XorWorkerRequest, post: PostResult): void {
	const id = request?.id;
	try {
		if (
			!Number.isSafeInteger(id) ||
			!Number.isSafeInteger(request.absoluteOffset) ||
			request.absoluteOffset < 0 ||
			!(request.input instanceof ArrayBuffer) ||
			!(request.salt instanceof ArrayBuffer)
		) {
			throw new Error("invalid worker request");
		}
		const input = new Uint8Array(request.input);
		const salt = new Uint8Array(request.salt);
		if (input.length > 0 && salt.length === 0) {
			throw new Error("salt must not be empty");
		}
		const output = new Uint8Array(input.length);
		for (let index = 0; index < input.length; index++) {
			output[index] = input[index] ^ salt[(request.absoluteOffset + index) % salt.length];
		}
		post({ id, output: output.buffer }, [output.buffer]);
	} catch (error) {
		const message = error instanceof Error ? error.message : "unknown worker failure";
		post({ id: Number.isSafeInteger(id) ? id : -1, error: message });
	}
}

interface BrowserWorkerScope {
	postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
	onmessage: ((event: MessageEvent<XorWorkerRequest>) => void) | null;
}

const browserScope = globalThis as unknown as Partial<BrowserWorkerScope>;
if (typeof browserScope.postMessage === "function") {
	browserScope.onmessage = (event: MessageEvent<XorWorkerRequest>) => {
		processRequest(
			event.data,
			(message, transfer = []) => browserScope.postMessage!(message, transfer)
		);
	};
	browserScope.postMessage({ ready: true });
} else {
	const { parentPort } = await import("node:worker_threads");
	if (!parentPort) throw new Error("FISE XOR worker has no parent port");
	parentPort.on("message", (request: XorWorkerRequest) => {
		processRequest(
			request,
			(message, transfer = []) => parentPort.postMessage(message, transfer)
		);
	});
	parentPort.postMessage({ ready: true });
}

export {};

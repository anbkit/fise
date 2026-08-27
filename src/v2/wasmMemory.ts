export function withClearedWasmMemory<Result>(
	memory: WebAssembly.Memory,
	requiredBytes: number,
	operation: (bytes: Uint8Array) => Result
): Result {
	try {
		return operation(new Uint8Array(memory.buffer));
	} finally {
		const current = new Uint8Array(memory.buffer);
		current.fill(0, 0, Math.min(requiredBytes, current.length));
	}
}

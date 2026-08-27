import { FiseError } from "../errors.js";
import { copyBytes } from "./bytes.js";
import {
	runtimeOf,
	type Profile,
	type ProfileKernelRunner
} from "./profile.js";
import { withClearedWasmMemory } from "./wasmMemory.js";

const PAGE_BYTES = 65_536;
const MAX_MEMORY_PAGES = 8192;

interface ProfileWasmExports extends WebAssembly.Exports {
	readonly memory: WebAssembly.Memory;
	readonly forward: (...arguments_: number[]) => void;
	readonly reverse: (...arguments_: number[]) => void;
}

export function isWasmSupported(): boolean {
	return (
		typeof WebAssembly !== "undefined" &&
		typeof WebAssembly.compile === "function" &&
		typeof WebAssembly.instantiate === "function"
	);
}

export async function createWasmKernelRunner(profile: Profile): Promise<ProfileKernelRunner> {
	if (!isWasmSupported()) {
		throw new FiseError("WASM_UNAVAILABLE", "FISE: WebAssembly is unavailable.");
	}
	const runtime = runtimeOf(profile);
	if (!runtime.wasmModule) {
		throw new FiseError("WASM_UNAVAILABLE", "FISE: generated profile has no WASM kernel.");
	}
	let instance: WebAssembly.Instance;
	try {
		const moduleBytes = copyBytes(runtime.wasmModule);
		const module = await WebAssembly.compile(moduleBytes.buffer as ArrayBuffer);
		instance = await WebAssembly.instantiate(module);
	} catch (error) {
		throw new FiseError("WASM_COMPILE_FAILED", "FISE: unable to compile generated WASM kernel.", error);
	}
	const exports = instance.exports as ProfileWasmExports;
	if (
		!(exports.memory instanceof WebAssembly.Memory) ||
		typeof exports.forward !== "function" ||
		typeof exports.reverse !== "function"
	) {
		throw new FiseError("WASM_COMPILE_FAILED", "FISE: generated WASM exports are invalid.");
	}
	let busy = false;
	return (
		operation,
		selectedRuntime,
		input,
		contextSegment,
		contextState,
		absoluteOffset,
		_context
	) => {
		if (selectedRuntime !== runtime) {
			throw new FiseError("PROFILE_MISMATCH", "FISE: WASM runner received another profile.");
		}
		if (busy) throw new FiseError("RUNTIME_UNAVAILABLE", "FISE: WASM profile runner is not reentrant.");
		busy = true;
		const requiredBytes = input.length + contextSegment.length;
		try {
			ensureMemory(exports.memory, requiredBytes);
			return withClearedWasmMemory(exports.memory, requiredBytes, memory => {
				memory.set(input, 0);
				memory.set(contextSegment, input.length);
				exports[operation](
					0,
					input.length,
					input.length,
					contextSegment.length,
					contextState[0],
					contextState[1],
					contextState[2],
					contextState[3],
					absoluteOffset
				);
				return memory.slice(0, input.length);
			});
		} catch (error) {
			if (error instanceof FiseError) throw error;
			throw new FiseError("INVALID_PROFILE", "FISE: generated WASM execution failed.", error);
		} finally {
			busy = false;
		}
	};
}

function ensureMemory(memory: WebAssembly.Memory, requiredBytes: number): void {
	const requiredPages = Math.max(1, Math.ceil(requiredBytes / PAGE_BYTES));
	if (requiredPages > MAX_MEMORY_PAGES) {
		throw new FiseError("WASM_MEMORY_LIMIT", "FISE: WASM operation exceeds 512 MiB.");
	}
	const currentPages = memory.buffer.byteLength / PAGE_BYTES;
	if (requiredPages > currentPages) {
		try {
			memory.grow(requiredPages - currentPages);
		} catch (error) {
			throw new FiseError("WASM_MEMORY_LIMIT", "FISE: unable to grow WASM memory.", error);
		}
	}
}

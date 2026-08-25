import { FiseBinaryCipher } from "../types.js";
import { FiseError } from "../errors.js";
import { registerBuiltInBinaryCipher } from "./transformRegistry.js";

const WASM_PAGE_SIZE = 64 * 1024;
const DEFAULT_MAX_MEMORY_PAGES = 1_024;
const MEMORY32_MAX_PAGES = 65_536;

export interface WasmXorBinaryCipherOptions {
	/** Maximum retained WASM linear-memory pages (64 KiB each). Default: 1024. */
	readonly maxMemoryPages?: number;
}

// Binary form of this dependency-free module:
//
// (module
//   (memory (export "memory") 1)
//   (func (export "xor_in_place")
//     (param $data i32) (param $data_len i32)
//     (param $salt i32) (param $salt_len i32)
//     (local $i i32)
//     (block $done
//       (loop $next
//         (br_if $done (i32.ge_u (local.get $i) (local.get $data_len)))
//         (i32.store8
//           (i32.add (local.get $data) (local.get $i))
//           (i32.xor
//             (i32.load8_u (i32.add (local.get $data) (local.get $i)))
//             (i32.load8_u
//               (i32.add
//                 (local.get $salt)
//                 (i32.rem_u (local.get $i) (local.get $salt_len))))))
//         (local.set $i (i32.add (local.get $i) (i32.const 1)))
//         (br $next)))))
//
// Keeping the 112-byte module inline avoids a fetch, a public asset URL, and
// application/wasm MIME configuration. The wrapper still compiles it through
// the standard WebAssembly JavaScript API.
const XOR_WASM_MODULE = Uint8Array.from([
	0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
	0x01, 0x08, 0x01, 0x60, 0x04, 0x7f, 0x7f, 0x7f, 0x7f, 0x00,
	0x03, 0x02, 0x01, 0x00,
	0x05, 0x03, 0x01, 0x00, 0x01,
	0x07, 0x19, 0x02,
	0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
	0x0c, 0x78, 0x6f, 0x72, 0x5f, 0x69, 0x6e, 0x5f, 0x70, 0x6c, 0x61, 0x63, 0x65, 0x00, 0x00,
	0x0a, 0x38, 0x01, 0x36,
	0x01, 0x01, 0x7f,
	0x02, 0x40, 0x03, 0x40,
	0x20, 0x04, 0x20, 0x01, 0x4f, 0x0d, 0x01,
	0x20, 0x00, 0x20, 0x04, 0x6a,
	0x20, 0x00, 0x20, 0x04, 0x6a, 0x2d, 0x00, 0x00,
	0x20, 0x02, 0x20, 0x04, 0x20, 0x03, 0x70, 0x6a, 0x2d, 0x00, 0x00,
	0x73, 0x3a, 0x00, 0x00,
	0x20, 0x04, 0x41, 0x01, 0x6a, 0x21, 0x04,
	0x0c, 0x00, 0x0b, 0x0b, 0x0b
]);

interface XorWasmExports extends WebAssembly.Exports {
	memory: WebAssembly.Memory;
	xor_in_place(
		dataPointer: number,
		dataLength: number,
		saltPointer: number,
		saltLength: number
	): void;
}

let compiledModule: Promise<WebAssembly.Module> | undefined;

/**
 * Reports whether this runtime exposes the WebAssembly APIs required by the
 * optional XOR backend. Compilation can still be rejected by resource limits
 * or a browser Content Security Policy.
 */
export function isWasmXorBinaryCipherSupported(): boolean {
	return (
		typeof WebAssembly !== "undefined" &&
		typeof WebAssembly.compile === "function" &&
		typeof WebAssembly.instantiate === "function" &&
		typeof WebAssembly.Memory === "function"
	);
}

/**
 * Creates an isolated WASM-backed implementation of the default binary XOR
 * transform. Compile once during application or worker initialization, then
 * bind it to a binary profile through `withBinaryBackend()`.
 *
 * The WASM module accelerates only the byte transform. Profile layout and
 * envelope assembly remain in TypeScript, so custom JavaScript profiles keep
 * the same behavior.
 */
export async function createWasmXorBinaryCipher(
	options: WasmXorBinaryCipherOptions = {}
): Promise<FiseBinaryCipher> {
	const maxMemoryPages = normalizeMaxMemoryPages(options);
	if (!isWasmXorBinaryCipherSupported()) {
		throw new FiseError("WASM_UNAVAILABLE", "FISE: WebAssembly is not available in this runtime.");
	}

	const module = await getCompiledModule();
	let instance: WebAssembly.Instance;
	try {
		instance = await WebAssembly.instantiate(module);
	} catch (error) {
		throw new FiseError(
			"WASM_COMPILE_FAILED",
			"FISE: unable to instantiate the WebAssembly XOR module.",
			error
		);
	}
	const exports = instance.exports as XorWasmExports;

	if (
		!(exports.memory instanceof WebAssembly.Memory) ||
		typeof exports.xor_in_place !== "function"
	) {
		throw new FiseError("WASM_COMPILE_FAILED", "FISE: invalid WebAssembly XOR module exports.");
	}

	const transform = createTransform(exports, maxMemoryPages);
	return registerBuiltInBinaryCipher(Object.freeze({
		id: "fise.xor.u8.v1",
		encrypt: transform,
		decrypt: transform
	}));
}

async function getCompiledModule(): Promise<WebAssembly.Module> {
	if (!compiledModule) {
		compiledModule = WebAssembly.compile(XOR_WASM_MODULE).catch((error) => {
			compiledModule = undefined;
			const detail = error instanceof Error ? ` ${error.message}` : "";
			throw new FiseError(
				"WASM_COMPILE_FAILED",
				`FISE: unable to compile the WebAssembly XOR module.${detail}`,
				error
			);
		});
	}
	return compiledModule;
}

function createTransform(exports: XorWasmExports, maxMemoryPages: number) {
	return (input: Uint8Array, salt: Uint8Array): Uint8Array => {
		if (input.length > 0 && salt.length === 0) {
			throw new FiseError("INVALID_SALT", "FISE: binary XOR salt must not be empty.");
		}
		if (input.length === 0) return new Uint8Array();

		const requiredBytes = input.length + salt.length;
		if (!Number.isSafeInteger(requiredBytes) || requiredBytes > 0xffff_ffff) {
			throw new FiseError("WASM_MEMORY_LIMIT", "FISE: input is too large for WebAssembly memory32.");
		}

		ensureMemoryCapacity(exports.memory, requiredBytes, maxMemoryPages);
		const memoryBytes = new Uint8Array(exports.memory.buffer, 0, requiredBytes);
		const saltPointer = input.length;

		try {
			memoryBytes.set(input, 0);
			memoryBytes.set(salt, saltPointer);
			exports.xor_in_place(0, input.length, saltPointer, salt.length);

			const output = new Uint8Array(input.length);
			output.set(memoryBytes.subarray(0, input.length));
			return output;
		} finally {
			// Best-effort cleanup of the reusable linear-memory window. This is
			// hygiene, not a cryptographic zeroization guarantee.
			memoryBytes.fill(0);
		}
	};
}

function ensureMemoryCapacity(
	memory: WebAssembly.Memory,
	requiredBytes: number,
	maxMemoryPages: number
): void {
	const requiredPages = Math.ceil(requiredBytes / WASM_PAGE_SIZE);
	if (requiredPages > maxMemoryPages) {
		throw new FiseError(
			"WASM_MEMORY_LIMIT",
			`FISE: transform requires ${requiredPages} WebAssembly pages, exceeding configured maximum ${maxMemoryPages}.`
		);
	}
	const missingBytes = requiredBytes - memory.buffer.byteLength;
	if (missingBytes <= 0) return;
	try {
		memory.grow(requiredPages - (memory.buffer.byteLength / WASM_PAGE_SIZE));
	} catch (error) {
		throw new FiseError("WASM_MEMORY_LIMIT", "FISE: unable to grow WebAssembly memory.", error);
	}
}

function normalizeMaxMemoryPages(options: unknown): number {
	if (!options || typeof options !== "object" || Array.isArray(options)) {
		throw new FiseError("INVALID_INPUT", "FISE: WASM options must be an object.");
	}
	const prototype = Object.getPrototypeOf(options);
	if (
		(prototype !== Object.prototype && prototype !== null) ||
		Object.getOwnPropertySymbols(options).length > 0
	) {
		throw new FiseError("INVALID_INPUT", "FISE: WASM options must be a plain object.");
	}
	const source = options as Record<string, unknown>;
	for (const key of Object.keys(source)) {
		if (key !== "maxMemoryPages") {
			throw new FiseError(
				"INVALID_INPUT",
				`FISE: WASM options contain unknown field '${key}'.`
			);
		}
	}
	const value = Object.prototype.hasOwnProperty.call(source, "maxMemoryPages")
		? source.maxMemoryPages
		: DEFAULT_MAX_MEMORY_PAGES;
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < 1 ||
		value > MEMORY32_MAX_PAGES
	) {
		throw new FiseError(
			"INVALID_INPUT",
			`FISE: maxMemoryPages must be an integer from 1 through ${MEMORY32_MAX_PAGES}.`
		);
	}
	return value;
}

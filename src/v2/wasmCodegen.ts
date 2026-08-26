import { FiseError } from "../errors.js";

export interface WasmStage {
	readonly kind: "xor" | "add" | "rotate" | "affine";
	readonly segmentShift: number;
	readonly positionMultiplier: number;
	readonly constant: number;
	readonly contextLane: number;
	readonly contextLane2: number;
	readonly multiplier?: number;
	readonly inverse?: number;
}

const I32 = 0x7f;
const EMPTY_BLOCK = 0x40;

const LOCAL_I = 9;
const LOCAL_X = 10;
const LOCAL_POSITION = 11;
const LOCAL_MIXED = 12;
const LOCAL_MASK = 13;
const LOCAL_ROTATION = 14;

export function compileProfileWasm(stages: readonly WasmStage[]): Uint8Array {
	const typeSection = section(1, [
		...u32(1),
		0x60,
		...u32(9),
		I32, I32, I32, I32, I32, I32, I32, I32, I32,
		...u32(0)
	]);
	const functionSection = section(3, [...u32(2), ...u32(0), ...u32(0)]);
	const memorySection = section(5, [...u32(1), 0x01, ...u32(1), ...u32(8192)]);
	const exportSection = section(7, [
		...u32(3),
		...exportEntry("memory", 0x02, 0),
		...exportEntry("forward", 0x00, 0),
		...exportEntry("reverse", 0x00, 1)
	]);
	const forward = functionBody(stages, false);
	const reverse = functionBody([...stages].reverse(), true);
	const codeSection = section(10, [
		...u32(2),
		...u32(forward.length),
		...forward,
		...u32(reverse.length),
		...reverse
	]);
	const module = Uint8Array.from([
		0x00, 0x61, 0x73, 0x6d,
		0x01, 0x00, 0x00, 0x00,
		...typeSection,
		...functionSection,
		...memorySection,
		...exportSection,
		...codeSection
	]);
	if (typeof WebAssembly !== "undefined" && !WebAssembly.validate(module)) {
		throw new FiseError("WASM_COMPILE_FAILED", "FISE: generated an invalid WASM profile kernel.");
	}
	return module;
}

function functionBody(stages: readonly WasmStage[], reverse: boolean): number[] {
	const code: number[] = [
		...u32(1), ...u32(6), I32,
		...constant(0), ...localSet(LOCAL_I),
		0x02, EMPTY_BLOCK,
		0x03, EMPTY_BLOCK,
		...localGet(LOCAL_I), ...localGet(1), 0x4f, 0x0d, ...u32(1),
		...localGet(8), ...localGet(LOCAL_I), 0x6a, ...localSet(LOCAL_POSITION),
		...localGet(0), ...localGet(LOCAL_I), 0x6a, 0x2d, 0x00, 0x00, ...localSet(LOCAL_X)
	];

	for (const stage of stages) {
		code.push(...emitMask(stage));
		if (stage.kind === "xor") {
			code.push(...localGet(LOCAL_X), ...localGet(LOCAL_MASK), 0x73, ...localSet(LOCAL_X));
		} else if (stage.kind === "add") {
			code.push(
				...localGet(LOCAL_X),
				...localGet(LOCAL_MASK),
				reverse ? 0x6b : 0x6a,
				...constant(255), 0x71,
				...localSet(LOCAL_X)
			);
		} else if (stage.kind === "rotate") {
			code.push(
				...localGet(LOCAL_MASK), ...constant(7), 0x71, ...constant(1), 0x6a,
				...localSet(LOCAL_ROTATION),
				...localGet(LOCAL_X), ...localGet(LOCAL_ROTATION), reverse ? 0x76 : 0x74,
				...localGet(LOCAL_X), ...constant(8), ...localGet(LOCAL_ROTATION), 0x6b,
				reverse ? 0x74 : 0x76,
				0x72, ...constant(255), 0x71,
				...localSet(LOCAL_X)
			);
		} else {
			if (reverse) {
				code.push(
					...localGet(LOCAL_X),
					...localGet(LOCAL_MASK),
					0x6b,
					...constant(255), 0x71,
					...constant(stage.inverse!), 0x6c
				);
			} else {
				code.push(
					...localGet(LOCAL_X),
					...constant(stage.multiplier!),
					0x6c,
					...localGet(LOCAL_MASK),
					0x6a
				);
			}
			code.push(...constant(255), 0x71, ...localSet(LOCAL_X));
		}
	}

	code.push(
		...localGet(0), ...localGet(LOCAL_I), 0x6a,
		...localGet(LOCAL_X), 0x3a, 0x00, 0x00,
		...localGet(LOCAL_I), ...constant(1), 0x6a, ...localSet(LOCAL_I),
		0x0c, ...u32(0),
		0x0b,
		0x0b,
		0x0b
	);
	return code;
}

function emitMask(stage: WasmStage): number[] {
	return [
		...localGet(LOCAL_POSITION),
		...localGet(4 + stage.contextLane),
		0x73,
		...constant(stage.positionMultiplier),
		0x6c,
		...localGet(4 + stage.contextLane2),
		0x6a,
		...constant(stage.constant),
		0x6a,
		...localSet(LOCAL_MIXED),

		...localGet(2),
		...localGet(LOCAL_POSITION),
		...constant(stage.segmentShift),
		0x6a,
		...localGet(3),
		0x70,
		0x6a,
		0x2d, 0x00, 0x00,
		...localGet(LOCAL_MIXED), 0x73,
		...localGet(LOCAL_MIXED), ...constant(8), 0x76, 0x73,
		...localGet(LOCAL_MIXED), ...constant(16), 0x76, 0x73,
		...localGet(LOCAL_MIXED), ...constant(24), 0x76, 0x73,
		...constant(255), 0x71,
		...localSet(LOCAL_MASK)
	];
}

function section(id: number, payload: number[]): number[] {
	return [id, ...u32(payload.length), ...payload];
}

function exportEntry(name: string, kind: number, index: number): number[] {
	const bytes = Array.from(new TextEncoder().encode(name));
	return [...u32(bytes.length), ...bytes, kind, ...u32(index)];
}

function localGet(index: number): number[] {
	return [0x20, ...u32(index)];
}

function localSet(index: number): number[] {
	return [0x21, ...u32(index)];
}

function constant(value: number): number[] {
	return [0x41, ...s32(value | 0)];
}

function u32(value: number): number[] {
	const bytes: number[] = [];
	let remaining = value >>> 0;
	do {
		let byte = remaining & 0x7f;
		remaining >>>= 7;
		if (remaining !== 0) byte |= 0x80;
		bytes.push(byte);
	} while (remaining !== 0);
	return bytes;
}

function s32(value: number): number[] {
	const bytes: number[] = [];
	let remaining = value | 0;
	let done = false;
	while (!done) {
		let byte = remaining & 0x7f;
		remaining >>= 7;
		const sign = (byte & 0x40) !== 0;
		done = (remaining === 0 && !sign) || (remaining === -1 && sign);
		if (!done) byte |= 0x80;
		bytes.push(byte);
	}
	return bytes;
}

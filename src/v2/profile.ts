import { FiseError } from "../errors.js";
import { assertBytes, copyBytes, hexToBytes } from "./bytes.js";
import type { FiseContext } from "./types.js";

export type ProfileContextState = readonly [number, number, number, number];

export interface ProfileLayoutInput {
	readonly transformedLength: number;
	readonly encodedContextLength: number;
	readonly contextSegmentLength: number;
}

export type ProfileContextMixer = (
	encodedContext: Uint8Array,
	context: FiseContext
) => ProfileContextState;
export type ProfileOffset = (
	input: ProfileLayoutInput,
	contextState: ProfileContextState,
	contextSegment: Uint8Array,
	context: FiseContext
) => number;
export type ProfileMarker = (
	input: ProfileLayoutInput,
	contextState: ProfileContextState,
	contextSegment: Uint8Array,
	context: FiseContext
) => number;
export type ProfileKernel = (
	input: Uint8Array,
	contextSegment: Uint8Array,
	contextState: ProfileContextState,
	absoluteOffset: number,
	context: FiseContext
) => Uint8Array;

export type ProfileKernelRunner = (
	operation: "forward" | "reverse",
	runtime: ProfileRuntime,
	input: Uint8Array,
	contextSegment: Uint8Array,
	contextState: ProfileContextState,
	absoluteOffset: number,
	context: FiseContext
) => Uint8Array;

export type ProfileAsyncKernelRunner = (
	operation: "forward" | "reverse",
	runtime: ProfileRuntime,
	input: Uint8Array,
	contextSegment: Uint8Array,
	contextState: ProfileContextState,
	absoluteOffset: number,
	context: FiseContext
) => Promise<Uint8Array>;

export interface ProfileRuntime {
	readonly fingerprint: Uint8Array;
	readonly fingerprintHex: string;
	readonly contextSegmentOffset: number;
	readonly contextSegmentLength: number;
	readonly mixContext: ProfileContextMixer;
	readonly offset: ProfileOffset;
	readonly marker: ProfileMarker;
	readonly forward: ProfileKernel;
	readonly reverse: ProfileKernel;
	readonly wasmModule?: Uint8Array;
}

const runtimes = new WeakMap<Profile, ProfileRuntime>();
const PROFILE_CONSTRUCTION_TOKEN = Symbol("FISE profile construction");

/**
 * One immutable, generated FISE 2.0 transformation profile.
 *
 * Applications import instances emitted by `fise generate`; they do not build
 * or mutate profiles at runtime.
 */
export class Profile {
	private constructor(token: typeof PROFILE_CONSTRUCTION_TOKEN, runtime: ProfileRuntime) {
		if (token !== PROFILE_CONSTRUCTION_TOKEN) {
			throw new FiseError(
				"INVALID_PROFILE",
				"FISE: profiles must be created by the generated profile ABI."
			);
		}
		runtimes.set(this, runtime);
		Object.freeze(this);
	}

	/** Low-level generated-module ABI. Do not hand-author calls to this method. */
	static generated(
		fingerprint: string,
		contextSegmentOffset: number,
		contextSegmentLength: number,
		mixContext: ProfileContextMixer,
		offset: ProfileOffset,
		marker: ProfileMarker,
		forward: ProfileKernel,
		reverse: ProfileKernel,
		wasmModule?: Uint8Array
	): Profile {
		const fingerprintBytes = hexToBytes(fingerprint);
		validateContextSegment(contextSegmentOffset, contextSegmentLength);
		for (const [label, operation] of [
			["context mixer", mixContext],
			["offset", offset],
			["marker", marker],
			["forward kernel", forward],
			["reverse kernel", reverse]
		] as const) {
			if (typeof operation !== "function") {
				throw new FiseError("INVALID_PROFILE", `FISE: generated ${label} must be a function.`);
			}
		}

		const runtime: ProfileRuntime = Object.freeze({
			fingerprint: fingerprintBytes,
			fingerprintHex: fingerprint,
			contextSegmentOffset,
			contextSegmentLength,
			mixContext,
			offset,
			marker,
			forward,
			reverse,
			...(wasmModule === undefined ? {} : { wasmModule: snapshotWasm(wasmModule) })
		});
		validateRuntime(runtime);
		return new Profile(PROFILE_CONSTRUCTION_TOKEN, runtime);
	}

	/** Opaque content identity carried by FISE 2.0 envelopes. */
	get fingerprint(): string {
		return runtimeOf(this).fingerprintHex;
	}
}

function snapshotWasm(value: Uint8Array): Uint8Array {
	assertBytes(value, "generated WASM module", "INVALID_PROFILE");
	const snapshot = copyBytes(value);
	if (snapshot.length < 8 || snapshot.length > 1024 * 1024) {
		throw new FiseError("INVALID_PROFILE", "FISE: generated WASM module has an invalid size.");
	}
	return snapshot;
}

export function runtimeOf(profile: Profile): ProfileRuntime {
	const runtime = runtimes.get(profile);
	if (!runtime) {
		throw new FiseError(
			"INVALID_PROFILE",
			"FISE: profile must be an instance emitted by the FISE profile generator."
		);
	}
	return runtime;
}

export function runProfileKernel(
	operation: "forward" | "reverse",
	runtime: ProfileRuntime,
	input: Uint8Array,
	contextSegment: Uint8Array,
	contextState: ProfileContextState,
	absoluteOffset: number,
	context: FiseContext
): Uint8Array {
	assertContextSegment(runtime, contextSegment);
	let output: Uint8Array;
	const ownedInput = copyBytes(input);
	try {
		output = runtime[operation](
			ownedInput,
			copyBytes(contextSegment),
			contextState,
			absoluteOffset,
			context
		);
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError(
			"INVALID_CIPHERTEXT",
			`FISE: generated ${operation} kernel failed.`,
			error
		);
	}
	assertBytes(output, `${operation} kernel output`, "INVALID_PROFILE");
	if (output === ownedInput) {
		throw new FiseError("INVALID_PROFILE", `FISE: generated ${operation} kernel aliased its input.`);
	}
	const ownedOutput = copyBytes(output);
	if (ownedOutput.length !== input.length) {
		throw new FiseError(
			"INVALID_PROFILE",
			`FISE: generated ${operation} kernel must preserve byte length.`
		);
	}
	return ownedOutput;
}

export function mixProfileContext(
	runtime: ProfileRuntime,
	encodedContext: Uint8Array,
	context: FiseContext
): ProfileContextState {
	let state: ProfileContextState;
	try {
		state = runtime.mixContext(copyBytes(encodedContext), context);
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError("INVALID_CONTEXT", "FISE: profile context mixer failed.", error);
	}
	if (!Array.isArray(state) || state.length !== 4) {
		throw new FiseError("INVALID_PROFILE", "FISE: context mixer must return four uint32 lanes.");
	}
	for (const key of Reflect.ownKeys(state)) {
		if (
			typeof key === "symbol" ||
			(key !== "length" && key !== "0" && key !== "1" && key !== "2" && key !== "3")
		) {
			throw new FiseError(
				"INVALID_PROFILE",
				"FISE: context mixer lanes must not contain custom properties."
			);
		}
	}
	const lanes: number[] = [];
	for (let index = 0; index < 4; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(state, String(index));
		if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
			throw new FiseError(
				"INVALID_PROFILE",
				"FISE: context mixer must return four dense data lanes."
			);
		}
		const value = descriptor.value;
		if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
			throw new FiseError("INVALID_PROFILE", "FISE: context mixer returned a non-uint32 lane.");
		}
		lanes.push(value >>> 0);
	}
	return Object.freeze(lanes) as unknown as ProfileContextState;
}

export function deriveProfileContextSegment(
	runtime: ProfileRuntime,
	encodedContext: Uint8Array
): Uint8Array {
	if (!(encodedContext instanceof Uint8Array) || encodedContext.length === 0) {
		throw new FiseError("INVALID_CONTEXT", "FISE: encoded context must not be empty.");
	}
	const output = new Uint8Array(runtime.contextSegmentLength);
	const start = runtime.contextSegmentOffset % encodedContext.length;
	for (let index = 0; index < output.length; index++) {
		output[index] = encodedContext[(start + index) % encodedContext.length];
	}
	return output;
}

export function profileOffset(
	runtime: ProfileRuntime,
	input: ProfileLayoutInput,
	contextState: ProfileContextState,
	contextSegment: Uint8Array,
	context: FiseContext
): number {
	assertContextSegment(runtime, contextSegment);
	let offset: number;
	try {
		offset = runtime.offset(
			Object.freeze({ ...input }),
			contextState,
			copyBytes(contextSegment),
			context
		);
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError("INVALID_PROFILE", "FISE: generated offset calculation failed.", error);
	}
	if (!Number.isInteger(offset) || offset < 0 || offset > input.transformedLength) {
		throw new FiseError("INVALID_PROFILE", "FISE: generated offset is outside the payload.");
	}
	return offset;
}

export function profileMarker(
	runtime: ProfileRuntime,
	input: ProfileLayoutInput,
	contextState: ProfileContextState,
	contextSegment: Uint8Array,
	context: FiseContext
): number {
	assertContextSegment(runtime, contextSegment);
	let marker: number;
	try {
		marker = runtime.marker(
			Object.freeze({ ...input }),
			contextState,
			copyBytes(contextSegment),
			context
		);
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError("INVALID_PROFILE", "FISE: generated marker calculation failed.", error);
	}
	if (!Number.isInteger(marker) || marker < 0 || marker > 0xffff_ffff) {
		throw new FiseError("INVALID_PROFILE", "FISE: generated marker must be a uint32.");
	}
	return marker >>> 0;
}

function validateContextSegment(offset: number, length: number): void {
	if (
		!Number.isInteger(offset) ||
		offset < 0 ||
		offset > 0xffff_ffff ||
		!Number.isInteger(length) ||
		length < 8 ||
		length > 1024
	) {
		throw new FiseError(
			"INVALID_PROFILE",
			"FISE: generated context segment parameters are invalid."
		);
	}
}

function validateRuntime(runtime: ProfileRuntime): void {
	const context = Object.freeze([]) as FiseContext;
	const encodedContext = new TextEncoder().encode("W10");
	const contextState = mixProfileContext(runtime, encodedContext, context);
	const contextSegment = deriveProfileContextSegment(runtime, encodedContext);
	const input = Uint8Array.from([0, 1, 2, 127, 128, 254, 255]);
	const forward = runProfileKernel(
		"forward",
		runtime,
		input,
		contextSegment,
		contextState,
		0,
		context
	);
	const reverse = runProfileKernel(
		"reverse",
		runtime,
		forward,
		contextSegment,
		contextState,
		0,
		context
	);
	for (let index = 0; index < input.length; index++) {
		if (reverse[index] !== input[index]) {
			throw new FiseError("INVALID_PROFILE", "FISE: generated profile failed its inverse smoke test.");
		}
	}
	const layout = {
		transformedLength: input.length,
		encodedContextLength: encodedContext.length,
		contextSegmentLength: contextSegment.length
	};
	profileOffset(runtime, layout, contextState, contextSegment, context);
	profileMarker(runtime, layout, contextState, contextSegment, context);
}

function assertContextSegment(runtime: ProfileRuntime, value: Uint8Array): void {
	assertBytes(value, "context segment", "INVALID_PROFILE");
	if (value.length !== runtime.contextSegmentLength) {
		throw new FiseError(
			"INVALID_PROFILE",
			"FISE: context segment length does not match the generated profile."
		);
	}
}

export type FiseErrorCode =
	| "INVALID_INPUT"
	| "INVALID_PROFILE"
	| "INVALID_CONTEXT"
	| "INVALID_SALT"
	| "INVALID_ENVELOPE"
	| "UNSUPPORTED_VERSION"
	| "PROFILE_MISMATCH"
	| "TRANSFORM_MISMATCH"
	| "LENGTH_MISMATCH"
	| "ENVELOPE_LIMIT"
	| "MARKER_MISMATCH"
	| "INVALID_CIPHERTEXT"
	| "INVALID_PAYLOAD"
	| "RANDOM_UNAVAILABLE"
	| "RUNTIME_UNAVAILABLE"
	| "WASM_UNAVAILABLE"
	| "WASM_COMPILE_FAILED"
	| "WASM_MEMORY_LIMIT";

/** Stable, machine-readable error returned by FISE validation and runtimes. */
export class FiseError extends Error {
	readonly code: FiseErrorCode;
	readonly cause?: unknown;

	constructor(code: FiseErrorCode, message: string, cause?: unknown) {
		super(message);
		this.name = "FiseError";
		this.code = code;
		this.cause = cause;
	}
}

export type FiseRepresentation = "string" | "binary";

export interface FiseContext {
	readonly timestamp?: number;
	readonly metadata?: Readonly<Record<string, unknown>>;
}

export type FiseContextFieldType = "string" | "number" | "boolean";

export interface FiseContextFieldContract {
	readonly type: FiseContextFieldType;
	readonly required?: boolean;
}

/**
 * Declares the external context a profile expects. Context is never inferred
 * from an envelope and must be supplied identically by producer and consumer.
 */
export interface FiseContextContract {
	readonly timestamp?: "optional" | "required" | "forbidden";
	readonly metadata?: Readonly<Record<string, FiseContextFieldContract>>;
	readonly allowAdditionalMetadata?: boolean;
}

export interface FiseLayoutInput {
	readonly transformedLength: number;
	readonly saltLength: number;
}

/**
 * Public layout contract for the marker inside a FISE 1.1 envelope.
 * The header already carries salt length, so the marker is recomputed and
 * compared rather than decoded. It is a bounded consistency signal, not a MAC,
 * checksum over the payload, or cryptographic integrity mechanism.
 */
export interface FiseLayout<T extends string | Uint8Array> {
	readonly markerSize: number;
	readonly saltRange?: Readonly<{ min: number; max: number }>;
	offset(input: FiseLayoutInput, ctx: FiseContext): number;
	createMarker(input: FiseLayoutInput, ctx: FiseContext): T;
}

export interface FiseProfileLimits {
	/** Maximum envelope length applied on creation and before core parsing. */
	readonly maxEnvelopeLength?: number;
}

/**
 * Reversible string-transform contract owned by a FISE profile.
 *
 * @remarks `encrypt` and `decrypt` are operational method names. The interface
 * does not imply cryptographic confidentiality, authenticity, or integrity.
 */
export interface FiseCipher {
	/** Stable semantic transform identity, shared by compatible backends. */
	readonly id: string;
	/** Applies the forward reversible transform. */
	encrypt(plaintext: string, salt: string): string;
	/** Reverses the transform after envelope validation. */
	decrypt(cipherText: string, salt: string): string;
}

/**
 * Reversible byte-transform contract owned by a FISE binary profile.
 *
 * @remarks `encrypt` and `decrypt` are operational method names. The interface
 * does not imply cryptographic confidentiality, authenticity, or integrity.
 */
export interface FiseBinaryCipher {
	/** Stable semantic transform identity, shared by compatible backends. */
	readonly id: string;
	/** Applies the forward reversible transform. */
	encrypt(plaintext: Uint8Array, salt: Uint8Array): Uint8Array;
	/** Reverses the transform after envelope validation. */
	decrypt(cipherText: Uint8Array, salt: Uint8Array): Uint8Array;
}

/** Cancellation passed to an asynchronous byte-transform backend. */
export interface FiseAsyncBinaryTransformOptions {
	readonly signal?: AbortSignal;
}

/**
 * Asynchronous implementation backend for one binary transform identity.
 *
 * @remarks A backend changes execution only. It must produce exactly the same
 * bytes as the synchronous transform owned by the selected profile.
 */
export interface FiseAsyncBinaryCipher {
	readonly id: string;
	encrypt(
		plaintext: Uint8Array,
		salt: Uint8Array,
		options?: FiseAsyncBinaryTransformOptions
	): Promise<Uint8Array>;
	decrypt(
		cipherText: Uint8Array,
		salt: Uint8Array,
		options?: FiseAsyncBinaryTransformOptions
	): Promise<Uint8Array>;
}

interface FiseProfileBase {
	/** Stable public compatibility identifier written into the envelope. */
	readonly id: string;
	readonly context?: FiseContextContract;
	readonly limits?: FiseProfileLimits;
	/** Present when the profile was compiled from a canonical manifest. */
	readonly manifestDigest?: string;
}

export interface FiseStringProfile extends FiseProfileBase {
	readonly representation: "string";
	readonly transform: FiseCipher;
	readonly layout: FiseLayout<string>;
}

export interface FiseBinaryProfile extends FiseProfileBase {
	readonly representation: "binary";
	readonly transform: FiseBinaryCipher;
	readonly layout: FiseLayout<Uint8Array>;
}

export type FiseProfile = FiseStringProfile | FiseBinaryProfile;

export interface EncryptOptions {
	readonly timestamp?: number;
	readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface DecryptOptions extends EncryptOptions {
	/** Optional caller bound; the stricter of this and the profile limit wins. */
	readonly maxEnvelopeLength?: number;
}

/** Async full-buffer binary operation using an optional compatible backend. */
export interface FiseAsyncBinaryEncryptOptions extends EncryptOptions {
	readonly backend?: FiseAsyncBinaryCipher;
	readonly signal?: AbortSignal;
}

/** Async full-buffer binary decode options. */
export interface FiseAsyncBinaryDecryptOptions extends DecryptOptions {
	readonly backend?: FiseAsyncBinaryCipher;
	readonly signal?: AbortSignal;
}

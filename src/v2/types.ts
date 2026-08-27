/**
 * JSON values accepted by FISE's structured-data codec.
 * Runtime strings must contain valid Unicode scalar values. Numbers use
 * finite IEEE-754 binary64 semantics and exclude negative zero.
 */
export type FiseJsonValue =
	| null
	| boolean
	| number
	| string
	| readonly FiseJsonValue[]
	| { readonly [key: string]: FiseJsonValue };

/** Values accepted by the unified FISE 2.0 API. */
export type FiseValue = FiseJsonValue | Uint8Array;

/** Transport representation accepted by decrypt. */
export type FiseEncrypted = string | Uint8Array;

/** Encrypt returns Base64URL for structured data and bytes for top-level binary. */
export type FiseEncryptedResult<Value> = Value extends Uint8Array ? Uint8Array : string;

/** One positional scalar using the same string/number rules as structured data. */
export type FiseContextValue = null | boolean | number | string;

/** Opaque positional context supplied by the application. */
export type FiseContext = readonly FiseContextValue[];

/** @internal Infers ordinary domain types while rejecting known non-JSON shapes. */
export type FiseStructuredInput<Value> =
	Value extends null | boolean | number | string
		? Value
		: Value extends (...arguments_: never[]) => unknown
			? never
			: Value extends Uint8Array
				? never
				: Value extends readonly (infer Item)[]
					? readonly FiseStructuredInput<Item>[]
					: Value extends object
						? { readonly [Key in keyof Value]:
							Key extends symbol ? never : FiseStructuredInput<Value[Key]>
						}
						: never;

/** @internal Public input inference for structured values or top-level bytes. */
export type FiseValueInput<Value> = Value extends Uint8Array
	? Value
	: FiseStructuredInput<Value>;

/** Half-open plaintext byte range used by direct binary restoration. */
export interface FiseRange {
	readonly start: number;
	readonly endExclusive: number;
}

export interface FiseProgressiveOptions {
	/** Plaintext bytes restored per pull. Defaults to 256 KiB. */
	readonly chunkSize?: number;
	readonly signal?: AbortSignal;
}

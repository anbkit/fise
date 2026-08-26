/** JSON values accepted by FISE's structured-data codec. */
export type FiseJsonValue =
	| null
	| boolean
	| number
	| string
	| readonly FiseJsonValue[]
	| { readonly [key: string]: FiseJsonValue };

/** Values accepted by the unified FISE 2.0 API. */
export type FiseValue = FiseJsonValue | Uint8Array;

/** One positional, JSON-safe scalar supplied as external transformation context. */
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

/** Half-open byte range used by framed binary restoration. */
export interface FiseRange {
	readonly start: number;
	readonly endExclusive: number;
}

export interface FiseFramedOptions {
	/** Independent plaintext bytes per frame. Defaults to 256 KiB. */
	readonly frameSize?: number;
}

export interface FiseProgressiveOptions {
	readonly signal?: AbortSignal;
}

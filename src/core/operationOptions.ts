import { FiseError } from "../errors.js";

/** @internal Captures strict own enumerable data options exactly once. */
export function snapshotOperationOptions(
	value: unknown,
	allowedKeys: ReadonlySet<string>,
	label = "options"
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new FiseError("INVALID_INPUT", `FISE: ${label} must be an object.`);
	}
	try {
		const prototype = Object.getPrototypeOf(value);
		if (
			(prototype !== Object.prototype && prototype !== null) ||
			Object.getOwnPropertySymbols(value).length > 0
		) {
			throw new FiseError(
				"INVALID_INPUT",
				`FISE: ${label} must be a plain object with string keys.`
			);
		}

		const snapshot = Object.create(null) as Record<string, unknown>;
		for (const key of Object.getOwnPropertyNames(value)) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
				throw new FiseError(
					"INVALID_INPUT",
					`FISE: ${label}.${key} must be an enumerable data property.`
				);
			}
			if (!allowedKeys.has(key)) {
				throw new FiseError(
					"INVALID_INPUT",
					`FISE: ${label} contains unknown field '${key}'.`
				);
			}
			snapshot[key] = descriptor.value;
		}
		return Object.freeze(snapshot);
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError(
			"INVALID_INPUT",
			`FISE: unable to inspect ${label}.`,
			error
		);
	}
}

/** @internal Validates a cross-realm AbortSignal-like platform object. */
export function optionalAbortSignal(value: unknown): AbortSignal | undefined {
	if (value === undefined) return undefined;
	try {
		if (
			!value ||
			typeof value !== "object" ||
			Object.prototype.toString.call(value) !== "[object AbortSignal]" ||
			typeof (value as AbortSignal).aborted !== "boolean" ||
			typeof (value as AbortSignal).addEventListener !== "function" ||
			typeof (value as AbortSignal).removeEventListener !== "function"
		) {
			throw new FiseError(
				"INVALID_INPUT",
				"FISE: signal must be an AbortSignal."
			);
		}
		return value as AbortSignal;
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError(
			"INVALID_INPUT",
			"FISE: unable to inspect signal.",
			error
		);
	}
}

/** @internal Fails before or between asynchronous ownership boundaries. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw new FiseError(
			"OPERATION_ABORTED",
			"FISE: operation was aborted."
		);
	}
}

import { FiseError, type FiseErrorCode } from "../errors.js";

export function snapshotOwnDataProperties(
	value: unknown,
	allowedKeys: readonly string[],
	code: FiseErrorCode,
	label: string
): ReadonlyMap<string, unknown> {
	try {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new FiseError(code, `FISE: ${label} must be an object.`);
		}
		const properties = new Map<string, unknown>();
		for (const key of Reflect.ownKeys(value)) {
			if (typeof key === "symbol" || !allowedKeys.includes(key)) {
				throw new FiseError(code, `FISE: unknown field in ${label}.`);
			}
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor || !("value" in descriptor)) {
				throw new FiseError(code, `FISE: ${label} must not contain accessors.`);
			}
			properties.set(key, descriptor.value);
		}
		return properties;
	} catch (error) {
		if (error instanceof FiseError) throw error;
		throw new FiseError(code, `FISE: unable to inspect ${label}.`, error);
	}
}

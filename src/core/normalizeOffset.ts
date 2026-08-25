import { FiseError } from "../errors.js";

export function normalizeOffset(offset: number, maximum: number): number {
	if (!Number.isFinite(offset)) {
		throw new FiseError("INVALID_PROFILE", "FISE: profile offset must return a finite number.");
	}
	return Math.max(0, Math.min(Math.trunc(offset), maximum));
}

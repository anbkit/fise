/**
 * FISE constants and default values.
 * Centralized configuration to avoid magic numbers throughout the codebase.
 */

/**
 * Default salt length range for encryption.
 * Salt length is randomized within this range for each encryption operation.
 */
export const DEFAULT_SALT_RANGE = {
	min: 10,
	max: 99
} as const;

export const FISE_WIRE_VERSION = Object.freeze({
	major: 1,
	minor: 1
} as const);

export const MAX_SALT_LENGTH = 0xffff;
export const MAX_MARKER_SIZE = 0xff;
export const MAX_PROFILE_ID_LENGTH = 0x3f;

/**
 * Default offset calculation multipliers and modulos.
 * Used in timestamp-based offset calculations.
 */
export const DEFAULT_OFFSET_PARAMS = {
	MULTIPLIER: 7,
	MODULO: 11
} as const;

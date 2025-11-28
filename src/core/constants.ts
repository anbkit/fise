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

/**
 * Default offset calculation multipliers and modulos.
 * Used in timestamp-based offset calculations.
 */
export const DEFAULT_OFFSET_PARAMS = {
	MULTIPLIER: 7,
	MODULO: 11
} as const;

/**
 * Dummy character used for offset calculation in string mode.
 * Used to create placeholder strings for length-based calculations.
 */
export const DUMMY_CHAR = 'x';

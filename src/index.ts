/**
 * FISE - Fast Internet Secure Extensible
 * 
 * A keyless, rule-based, high-performance envelope for protecting API & frontend data.
 */

export { encryptFise, decryptFise } from "./encryptFise.js";
export { xorCipher } from "./core/xorCipher.js";
export { defaultRules } from "./rules/defaultRules.js";
export { FiseBuilderInstance } from "./rules/builder.instance.js";
export { FiseBuilder } from "./rules/builder.js";

// Export types
export type {
    FiseCipher,
    FiseContext,
    FiseRules,
    EncryptOptions,
    DecryptOptions
} from "./types.js";


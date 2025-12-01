export { fiseEncrypt, fiseDecrypt } from "./fiseEncrypt.js";
export { fiseBinaryEncrypt, fiseBinaryDecrypt } from "./fiseBinaryEncrypt.js";
export { xorCipher } from "./core/xorCipher.js";
export { xorBinaryCipher } from "./core/xorBinaryCipher.js";
export { randomSalt, randomSaltBinary } from "./core/utils.js";
export { defaultRules } from "./rules/defaultRules.js";
export { defaultBinaryRules } from "./rules/defaultBinaryRules.js";
export { FiseBuilder } from "./rules/builder.js";

// Export types
export type {
    FiseCipher,
    FiseBinaryCipher,
    FiseContext,
    FiseRules,
    EncryptOptions,
    DecryptOptions
} from "./types.js";

import { randomSaltBinary } from "./core/utils.js";
import { normalizeFiseRulesBinary } from "./core/normalizeBinaryFiseRules.js";
import { DEFAULT_SALT_RANGE } from "./core/constants.js";
import { EncryptOptions, DecryptOptions, FiseBinaryCipher, FiseContext, FiseRules } from "./types.js";
import { xorBinaryCipher } from "./core/xorBinaryCipher.js";

/**
 * Encrypts binary data using FISE transformation with binary envelope.
 * 
 * **Rules Sharing**: You can use the same rules for both string and binary encryption.
 * 
 * @param binaryData - The binary data to encrypt (Uint8Array)
 * @param rules - The rules implementation (can be shared with string encryption).
 *                If rules use text-based encodeLength, they will be automatically converted to binary.
 *                For best performance, use binary-native rules (e.g., defaultBinaryRules).
 * @param options - Optional encryption options (timestamp, metadata, binaryCipher).
 *                  Defaults to xorBinaryCipher if binaryCipher is not specified.
 * @returns The encrypted envelope as Uint8Array (pure binary, no base64)
 */
export function fiseBinaryEncrypt(
    binaryData: Uint8Array,
    rules: FiseRules<string | Uint8Array>,
    options: EncryptOptions = {}
): Uint8Array {
    const cipher = options.binaryCipher ?? xorBinaryCipher;
    // Normalize rules
    const fullRules = normalizeFiseRulesBinary(rules);

    // Use salt range from rules (default from constants)
    const saltRange = rules.saltRange ?? DEFAULT_SALT_RANGE;
    const timestamp = options.timestamp;

    const range = saltRange.max - saltRange.min + 1;
    const saltLen =
        saltRange.min + Math.floor(Math.random() * Math.max(range, 1));

    // Generate salt as Uint8Array
    const salt = randomSaltBinary(saltLen);

    const ctx: FiseContext = {
        timestamp,
        saltLength: saltLen,
        metadata: options.metadata
    };

    // Encrypt binary data
    const cipherText = cipher.encrypt(binaryData, salt);

    // Encode salt length as binary
    const encodedLen = fullRules.encodeLength(saltLen, ctx);
    if (!(encodedLen instanceof Uint8Array)) {
        throw new Error("FISE: encodeLength must return Uint8Array for binary envelopes");
    }

    // Calculate offset (works on byte length)
    const offsetRaw = fullRules.offset(cipherText, ctx);
    const offset = Math.max(0, Math.min(offsetRaw, cipherText.length));

    // Assemble envelope: [cipherText[0:offset], encodedLen, cipherText[offset:], salt]
    const totalSize = cipherText.length + encodedLen.length + salt.length;
    const envelope = new Uint8Array(totalSize);
    let pos = 0;

    // Copy cipherText prefix
    envelope.set(cipherText.slice(0, offset), pos);
    pos += offset;

    // Copy encoded length
    envelope.set(encodedLen, pos);
    pos += encodedLen.length;

    // Copy cipherText suffix
    envelope.set(cipherText.slice(offset), pos);
    pos += cipherText.length - offset;

    // Copy salt
    envelope.set(salt, pos);

    return envelope;
}

/**
 * Decrypts a binary FISE envelope back to binary data.
 * 
 * **Rules Sharing**: You can use the same rules for both string and binary decryption.
 * 
 * @param envelope - The encrypted envelope as Uint8Array (pure binary)
 * @param rules - The rules implementation that matches the one used for encryption.
 *                Can be shared with string decryption - normalization handles adaptation.
 * @param options - Optional decryption options (timestamp, metadata, binaryCipher).
 *                  Defaults to xorBinaryCipher if binaryCipher is not specified.
 *                  Timestamp and metadata must match encryption.
 * @returns The decrypted binary data (Uint8Array)
 * 
 */
export function fiseBinaryDecrypt(
    envelope: Uint8Array,
    rules: FiseRules<string | Uint8Array>,
    options: DecryptOptions = {}
): Uint8Array {
    const cipher = options.binaryCipher ?? xorBinaryCipher;
    // Normalize rules
    const fullRules = normalizeFiseRulesBinary(rules);

    const ctx: FiseContext = {
        timestamp: options.timestamp,
        metadata: options.metadata
    };

    // Extract salt length and encoded length
    const { saltLength, encodedLength, withoutLen } = fullRules.preExtractLength(envelope, ctx);

    // For binary operations, encodedLength and withoutLen are always Uint8Array
    const encodedLengthBinary = encodedLength as Uint8Array;
    const withoutLenBinary = withoutLen as Uint8Array;

    const salt = fullRules.extractSalt(envelope, saltLength, {
        ...ctx,
        saltLength
    }) as Uint8Array;

    // Calculate offset
    const encodedSize = fullRules.encodedLengthSize;
    const ctxWithSalt = { ...ctx, saltLength };
    const cipherTextLen = withoutLenBinary.length - encodedSize;
    const expectedOffset = fullRules.offset(
        new Uint8Array(Math.max(1, cipherTextLen)),
        ctxWithSalt
    );
    const encodedPos = Math.max(0, Math.min(expectedOffset, cipherTextLen));

    // Verify encoded length matches
    const actualEncoded = withoutLenBinary.slice(encodedPos, encodedPos + encodedSize);
    if (encodedPos + encodedSize > withoutLenBinary.length ||
        !actualEncoded.every((b, i) => b === encodedLengthBinary[i])) {
        throw new Error(
            "FISE: cannot find encoded length at expected offset. " +
            "This may indicate a corrupted envelope, mismatched rules/timestamp, " +
            "or a rules implementation where offset depends on content (not just length)."
        );
    }

    // Extract ciphertext
    const cipherText = new Uint8Array(cipherTextLen);
    cipherText.set(withoutLenBinary.slice(0, encodedPos), 0);
    cipherText.set(withoutLenBinary.slice(encodedPos + encodedSize), encodedPos);

    // Decrypt
    const decrypted = cipher.decrypt(cipherText, salt);

    return decrypted;
}

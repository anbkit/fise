import { FiseBinaryCipher } from "../types.js";

/**
 * XOR-based cipher implementation for FISE (binary-optimized).
 * 
 * This cipher performs XOR operation directly on binary data (Uint8Array).
 * No base64 conversion - works with pure binary throughout.
 * 
 * Note: XOR is symmetric, so encrypt and decrypt use the same operation.
 */
export const xorBinaryCipher: FiseBinaryCipher = {
    encrypt(plaintext: Uint8Array, salt: Uint8Array): Uint8Array {
        // XOR binary directly with salt (optimized)
        const xorResult = new Uint8Array(plaintext.length);
        for (let i = 0; i < plaintext.length; i++) {
            xorResult[i] = plaintext[i] ^ salt[i % salt.length];
        }
        return xorResult;
    },

    decrypt(cipherText: Uint8Array, salt: Uint8Array): Uint8Array {
        // XOR again with salt to get original binary (same as encrypt)
        const decrypted = new Uint8Array(cipherText.length);
        for (let i = 0; i < cipherText.length; i++) {
            decrypted[i] = cipherText[i] ^ salt[i % salt.length];
        }
        return decrypted;
    }
};


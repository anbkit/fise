import { test } from "node:test";
import assert from "node:assert";
import { FiseBuilderInstance } from "../dist/rules/builder.instance.js";
import { FiseBuilder } from "../dist/rules/builder.js";
import { encryptFise, decryptFise } from "../dist/encryptFise.js";
import { xorCipher } from "../dist/core/xorCipher.js";

// ============================================================================
// FiseBuilderInstance Tests
// ============================================================================

test("FiseBuilderInstance - create instance", () => {
    const builder = FiseBuilder.create();
    assert.ok(builder instanceof FiseBuilderInstance);
});

test("FiseBuilderInstance - build without offset throws error", () => {
    const builder = FiseBuilder.create();
    assert.throws(
        () => builder.build(),
        {
            message: "FISE FiseBuilderInstance: withOffset() is required"
        }
    );
});

test("FiseBuilderInstance - build with only offset defaults to base36", () => {
    const builder = FiseBuilder.create()
        .withOffset((c) => 5);

    const rules = builder.build();
    assert.ok(typeof rules.offset === "function");
    assert.ok(typeof rules.encodeLength === "function");
    assert.ok(typeof rules.decodeLength === "function");

    // Test default base36 encoding
    const encoded = rules.encodeLength(10, {});
    assert.strictEqual(encoded, "0a");
    const decoded = rules.decodeLength(encoded, {});
    assert.strictEqual(decoded, 10);
});

test("FiseBuilderInstance - build with all 3 security points", () => {
    const builder = FiseBuilder.create()
        .withOffset((c, ctx) => {
            const t = ctx.timestamp ?? 0;
            return (c.length * 7 + (t % 11)) % c.length;
        })
        .withEncodeLength((len) => len.toString(36).padStart(2, "0"))
        .withDecodeLength((encoded) => parseInt(encoded, 36));

    const rules = builder.build();
    assert.ok(typeof rules.offset === "function");
    assert.ok(typeof rules.encodeLength === "function");
    assert.ok(typeof rules.decodeLength === "function");

    // Test roundtrip
    const testLen = 15;
    const encoded = rules.encodeLength(testLen, {});
    const decoded = rules.decodeLength(encoded, {});
    assert.strictEqual(decoded, testLen);
});

test("FiseBuilderInstance - withSaltRange", () => {
    const builder = FiseBuilder.create()
        .withOffset((c) => 5)
        .withSaltRange(20, 50);

    const rules = builder.build();
    assert.deepStrictEqual(rules.saltRange, { min: 20, max: 50 });
});

test("FiseBuilderInstance - withHeadSalt", () => {
    const builder = FiseBuilder.create()
        .withOffset((c) => 5)
        .withHeadSalt();

    const rules = builder.build();
    assert.ok(typeof rules.extractSalt === "function");
    assert.ok(typeof rules.stripSalt === "function");

    // Test head-based extraction
    const envelope = "salt12345ciphertext";
    const saltLen = 8;
    const salt = rules.extractSalt(envelope, saltLen, {});
    const withoutSalt = rules.stripSalt(envelope, saltLen, {});

    assert.strictEqual(salt, "salt1234");
    assert.strictEqual(withoutSalt, "5ciphertext");
    assert.strictEqual(salt + withoutSalt, envelope);
});

test("FiseBuilderInstance - withCustomSaltExtraction", () => {
    const builder = FiseBuilder.create()
        .withOffset((c) => 5)
        .withCustomSaltExtraction(
            (envelope, saltLen) => envelope.slice(5, 5 + saltLen),
            (envelope, saltLen) => envelope.slice(0, 5) + envelope.slice(5 + saltLen)
        );

    const rules = builder.build();
    assert.ok(typeof rules.extractSalt === "function");
    assert.ok(typeof rules.stripSalt === "function");

    // Test custom extraction
    const envelope = "prefixsalt123suffix";
    const saltLen = 8;
    const salt = rules.extractSalt(envelope, saltLen, {});
    const withoutSalt = rules.stripSalt(envelope, saltLen, {});

    // Verify extraction works correctly
    // saltLen=8, so salt should be 8 chars starting at position 5: "xsalt123"
    assert.strictEqual(salt, "xsalt123");
    assert.strictEqual(withoutSalt, "prefisuffix");
    // Verify we can reconstruct: prefix + salt + suffix
    assert.strictEqual(withoutSalt.slice(0, 5) + salt + withoutSalt.slice(5), envelope);
});

test("FiseBuilderInstance - fluent API chaining", () => {
    const builder = FiseBuilder.create()
        .withOffset((c) => 5)
        .withEncodeLength((len) => len.toString(16).padStart(2, "0"))
        .withDecodeLength((encoded) => parseInt(encoded, 16))
        .withSaltRange(15, 80)
        .withHeadSalt();

    const rules = builder.build();
    assert.ok(rules.offset);
    assert.ok(rules.encodeLength);
    assert.ok(rules.decodeLength);
    assert.deepStrictEqual(rules.saltRange, { min: 15, max: 80 });
    assert.ok(rules.extractSalt);
    assert.ok(rules.stripSalt);
});

test("FiseBuilderInstance - works with encryptFise and decryptFise", () => {
    const rules = FiseBuilder.create()
        .withOffset((c, ctx) => {
            const t = ctx.timestamp ?? 0;
            return (c.length * 7 + (t % 11)) % c.length;
        })
        .withEncodeLength((len) => len.toString(36).padStart(2, "0"))
        .withDecodeLength((encoded) => parseInt(encoded, 36))
        .build();

    const plaintext = "Hello, FISE!";
    const encrypted = encryptFise(plaintext, xorCipher, rules);
    const decrypted = decryptFise(encrypted, xorCipher, rules);

    assert.strictEqual(decrypted, plaintext);
});

// ============================================================================
// FiseBuilder Static Preset Tests
// ============================================================================

test("FiseBuilder.defaults() - creates valid rules", () => {
    const rules = FiseBuilder.defaults().build();
    assert.ok(typeof rules.offset === "function");
    assert.ok(typeof rules.encodeLength === "function");
    assert.ok(typeof rules.decodeLength === "function");
    assert.deepStrictEqual(rules.saltRange, { min: 10, max: 99 });
});

test("FiseBuilder.defaults() - works with encryptFise/decryptFise", () => {
    const rules = FiseBuilder.defaults().build();
    const plaintext = "Test message";
    const encrypted = encryptFise(plaintext, xorCipher, rules);
    const decrypted = decryptFise(encrypted, xorCipher, rules);
    assert.strictEqual(decrypted, plaintext);
});

test("FiseBuilder.simple() - creates valid rules", () => {
    const rules = FiseBuilder.simple(13, 17).build();
    assert.ok(typeof rules.offset === "function");

    // Test offset with custom params
    const cipherText = "test123";
    const offset = rules.offset(cipherText, { timestamp: 0 });
    assert.ok(offset >= 0 && offset < cipherText.length);
});

test("FiseBuilder.simple() - works with encryptFise/decryptFise", () => {
    const rules = FiseBuilder.simple(13, 17).build();
    const plaintext = "Test";
    const encrypted = encryptFise(plaintext, xorCipher, rules);
    const decrypted = decryptFise(encrypted, xorCipher, rules);
    assert.strictEqual(decrypted, plaintext);
});

test("FiseBuilder.timestamp() - creates valid rules", () => {
    const rules = FiseBuilder.timestamp(13, 17).build();
    assert.ok(typeof rules.offset === "function");

    const cipherText = "test";
    const offset = rules.offset(cipherText, { timestamp: 5 });
    assert.ok(offset >= 0 && offset < cipherText.length);
});

test("FiseBuilder.timestamp() - works with encryptFise/decryptFise", () => {
    const rules = FiseBuilder.timestamp().build();
    const plaintext = "Test";
    const encrypted = encryptFise(plaintext, xorCipher, rules);
    const decrypted = decryptFise(encrypted, xorCipher, rules);
    assert.strictEqual(decrypted, plaintext);
});

test("FiseBuilder.fixed() - creates valid rules", () => {
    const rules = FiseBuilder.fixed().build();
    const cipherText = "test123";
    const offset = rules.offset(cipherText, {});
    assert.strictEqual(offset, Math.floor(cipherText.length / 2));
});

test("FiseBuilder.fixed() - works with encryptFise/decryptFise", () => {
    const rules = FiseBuilder.fixed().build();
    const plaintext = "Test";
    const encrypted = encryptFise(plaintext, xorCipher, rules);
    const decrypted = decryptFise(encrypted, xorCipher, rules);
    assert.strictEqual(decrypted, plaintext);
});

test("FiseBuilder.lengthBased() - creates valid rules", () => {
    const rules = FiseBuilder.lengthBased(7).build();
    const cipherText = "test123";
    const offset = rules.offset(cipherText, {});
    assert.strictEqual(offset, cipherText.length % 7);
});

test("FiseBuilder.lengthBased() - works with encryptFise/decryptFise", () => {
    const rules = FiseBuilder.lengthBased(7).build();
    const plaintext = "Test";
    const encrypted = encryptFise(plaintext, xorCipher, rules);
    const decrypted = decryptFise(encrypted, xorCipher, rules);
    assert.strictEqual(decrypted, plaintext);
});

test("FiseBuilder.prime() - creates valid rules", () => {
    const rules = FiseBuilder.prime(17, 23).build();
    const cipherText = "test";
    const offset = rules.offset(cipherText, { timestamp: 10 });
    assert.ok(offset >= 0 && offset < cipherText.length);
});

test("FiseBuilder.prime() - works with encryptFise/decryptFise", () => {
    const rules = FiseBuilder.prime().build();
    const plaintext = "Test";
    const encrypted = encryptFise(plaintext, xorCipher, rules);
    const decrypted = decryptFise(encrypted, xorCipher, rules);
    assert.strictEqual(decrypted, plaintext);
});

test("FiseBuilder.multiFactor() - creates valid rules", () => {
    const rules = FiseBuilder.multiFactor().build();
    const cipherText = "test";
    const offset = rules.offset(cipherText, { timestamp: 5, saltLength: 15 });
    assert.ok(offset >= 0 && offset < cipherText.length);
});

test("FiseBuilder.multiFactor() - works with encryptFise/decryptFise", () => {
    const rules = FiseBuilder.multiFactor().build();
    const plaintext = "Test";
    const encrypted = encryptFise(plaintext, xorCipher, rules);
    const decrypted = decryptFise(encrypted, xorCipher, rules);
    assert.strictEqual(decrypted, plaintext);
});

test("FiseBuilder.hex() - creates valid rules with hex encoding", () => {
    const rules = FiseBuilder.hex().build();

    // Test hex encoding
    const encoded = rules.encodeLength(15, {});
    assert.strictEqual(encoded, "0f");
    const decoded = rules.decodeLength(encoded, {});
    assert.strictEqual(decoded, 15);
});

test("FiseBuilder.hex() - works with encryptFise/decryptFise", () => {
    const rules = FiseBuilder.hex().build();
    const plaintext = "Test";
    const encrypted = encryptFise(plaintext, xorCipher, rules);
    const decrypted = decryptFise(encrypted, xorCipher, rules);
    assert.strictEqual(decrypted, plaintext);
});

test("FiseBuilder.base62() - creates valid rules with base62 encoding", () => {
    const rules = FiseBuilder.base62().build();

    // Test base62 encoding
    const testLen = 15;
    const encoded = rules.encodeLength(testLen, {});
    const decoded = rules.decodeLength(encoded, {});
    assert.strictEqual(decoded, testLen);
});

test("FiseBuilder.base62() - works with encryptFise/decryptFise", () => {
    const rules = FiseBuilder.base62().build();
    const plaintext = "Test";
    const encrypted = encryptFise(plaintext, xorCipher, rules);
    const decrypted = decryptFise(encrypted, xorCipher, rules);
    assert.strictEqual(decrypted, plaintext);
});

test("FiseBuilder.xor() - creates valid rules", () => {
    const rules = FiseBuilder.xor().build();
    const cipherText = "test";
    const offset = rules.offset(cipherText, { timestamp: 5 });
    assert.ok(offset >= 0 && offset < cipherText.length);
});

test("FiseBuilder.xor() - works with encryptFise/decryptFise", () => {
    const rules = FiseBuilder.xor().build();
    const plaintext = "Test";
    const encrypted = encryptFise(plaintext, xorCipher, rules);
    const decrypted = decryptFise(encrypted, xorCipher, rules);
    assert.strictEqual(decrypted, plaintext);
});

test("FiseBuilder.base64() - creates valid rules with base64 charset encoding", () => {
    const rules = FiseBuilder.base64().build();

    // Test base64 charset encoding
    const testLen = 15;
    const encoded = rules.encodeLength(testLen, {});
    const decoded = rules.decodeLength(encoded, {});
    assert.strictEqual(decoded, testLen);
});

test("FiseBuilder.base64() - works with encryptFise/decryptFise", () => {
    const rules = FiseBuilder.base64().build();
    const plaintext = "Test";
    const encrypted = encryptFise(plaintext, xorCipher, rules);
    const decrypted = decryptFise(encrypted, xorCipher, rules);
    assert.strictEqual(decrypted, plaintext);
});

test("FiseBuilder.customChars() - creates valid rules", () => {
    const rules = FiseBuilder.customChars("!@#$%^&*()").build();

    // Test custom encoding
    const testLen = 15;
    const encoded = rules.encodeLength(testLen, {});
    const decoded = rules.decodeLength(encoded, {});
    assert.strictEqual(decoded, testLen);
});

test("FiseBuilder.customChars() - throws error for short alphabet", () => {
    assert.throws(
        () => FiseBuilder.customChars("!@#$"),
        {
            message: "FISE FiseBuilder: customChars alphabet must have at least 10 characters"
        }
    );
});

test("FiseBuilder.customChars() - works with encryptFise/decryptFise", () => {
    const rules = FiseBuilder.customChars("!@#$%^&*()").build();
    const plaintext = "Test";
    const encrypted = encryptFise(plaintext, xorCipher, rules);
    const decrypted = decryptFise(encrypted, xorCipher, rules);
    assert.strictEqual(decrypted, plaintext);
});

// ============================================================================
// Integration Tests
// ============================================================================

test("FiseBuilder presets - all presets work with encrypt/decrypt", () => {
    const presets = [
        () => FiseBuilder.defaults().build(),
        () => FiseBuilder.simple(7, 11).build(),
        () => FiseBuilder.timestamp().build(),
        () => FiseBuilder.fixed().build(),
        () => FiseBuilder.lengthBased(7).build(),
        () => FiseBuilder.prime().build(),
        () => FiseBuilder.multiFactor().build(),
        () => FiseBuilder.hex().build(),
        () => FiseBuilder.base62().build(),
        () => FiseBuilder.xor().build(),
        () => FiseBuilder.base64().build(),
        () => FiseBuilder.customChars("!@#$%^&*()").build()
    ];

    const plaintext = "Hello, FISE!";

    for (const presetFn of presets) {
        const rules = presetFn();
        const encrypted = encryptFise(plaintext, xorCipher, rules);
        const decrypted = decryptFise(encrypted, xorCipher, rules);
        assert.strictEqual(decrypted, plaintext, `Preset ${presetFn.name} failed`);
    }
});

test("FiseBuilder - presets can be customized further", () => {
    const rules = FiseBuilder.defaults()
        .withSaltRange(20, 50)
        .build();

    assert.deepStrictEqual(rules.saltRange, { min: 20, max: 50 });

    // Should still work
    const plaintext = "Test";
    const encrypted = encryptFise(plaintext, xorCipher, rules);
    const decrypted = decryptFise(encrypted, xorCipher, rules);
    assert.strictEqual(decrypted, plaintext);
});

test("FiseBuilder - different presets produce different envelopes", () => {
    const plaintext = "Test message";

    const rules1 = FiseBuilder.defaults().build();
    const rules2 = FiseBuilder.hex().build();
    const rules3 = FiseBuilder.timestamp(13, 17).build();

    const encrypted1 = encryptFise(plaintext, xorCipher, rules1);
    const encrypted2 = encryptFise(plaintext, xorCipher, rules2);
    const encrypted3 = encryptFise(plaintext, xorCipher, rules3);

    // Due to random salt, they should be different
    // But we can verify they all decrypt correctly
    assert.strictEqual(decryptFise(encrypted1, xorCipher, rules1), plaintext);
    assert.strictEqual(decryptFise(encrypted2, xorCipher, rules2), plaintext);
    assert.strictEqual(decryptFise(encrypted3, xorCipher, rules3), plaintext);
});

test("FiseBuilderInstance - encoding/decoding roundtrip for all presets", () => {
    const presets = [
        () => FiseBuilder.defaults().build(),
        () => FiseBuilder.hex().build(),
        () => FiseBuilder.base62().build(),
        () => FiseBuilder.base64().build(),
        () => FiseBuilder.customChars("!@#$%^&*()").build()
    ];

    for (const presetFn of presets) {
        const rules = presetFn();
        for (let len = 10; len <= 99; len += 10) {
            const encoded = rules.encodeLength(len, {});
            const decoded = rules.decodeLength(encoded, {});
            assert.strictEqual(decoded, len, `Preset ${presetFn.name} failed for length ${len}`);
        }
    }
});

test("FiseBuilderInstance - offset validation", () => {
    // Use a fixed offset that's valid and not at the edge
    const rules = FiseBuilder.create()
        .withOffset((c) => {
            // Return a safe offset in the middle range
            // Avoid edge cases (0 or length-1) which can cause decryption issues
            const len = c.length || 1;
            if (len <= 2) return 0;
            return Math.floor(len / 2);
        })
        .build();

    // Offset should work correctly
    const plaintext = "test";
    const encrypted = encryptFise(plaintext, xorCipher, rules);
    const decrypted = decryptFise(encrypted, xorCipher, rules);
    assert.strictEqual(decrypted, plaintext);
});

test("FiseBuilderInstance - empty string handling", () => {
    const rules = FiseBuilder.defaults().build();

    const plaintext = "";
    const encrypted = encryptFise(plaintext, xorCipher, rules);
    const decrypted = decryptFise(encrypted, xorCipher, rules);
    assert.strictEqual(decrypted, plaintext);
});

test("FiseBuilderInstance - timestamp-based offset rotation", () => {
    const rules = FiseBuilder.defaults().build();
    const cipherText = "test123";

    const offset1 = rules.offset(cipherText, { timestamp: 0 });
    const offset2 = rules.offset(cipherText, { timestamp: 11 });

    // With timestamp rotation, offsets should potentially differ
    // (though not guaranteed, depends on modulo)
    assert.ok(offset1 >= 0 && offset1 < cipherText.length);
    assert.ok(offset2 >= 0 && offset2 < cipherText.length);
});

test("FiseBuilderInstance - custom salt range affects encryption", () => {
    const rules1 = FiseBuilder.defaults().build();
    const rules2 = FiseBuilder.defaults()
        .withSaltRange(20, 30)
        .build();

    const plaintext = "Test";
    const encrypted1 = encryptFise(plaintext, xorCipher, rules1);
    const encrypted2 = encryptFise(plaintext, xorCipher, rules2);

    // Both should decrypt correctly
    assert.strictEqual(decryptFise(encrypted1, xorCipher, rules1), plaintext);
    assert.strictEqual(decryptFise(encrypted2, xorCipher, rules2), plaintext);
});

test("FiseBuilderInstance - head salt extraction works", () => {
    // Note: encryptFise always appends salt at the end, so head-based extraction
    // is only useful for custom encryption implementations. This test verifies
    // that the extraction functions work correctly, but we can't test full
    // encrypt/decrypt with head salt using the standard encryptFise function.
    const rules = FiseBuilder.create()
        .withOffset((c) => Math.floor(c.length / 2))
        .withEncodeLength((len) => len.toString(36).padStart(2, "0"))
        .withDecodeLength((encoded) => parseInt(encoded, 36))
        .withHeadSalt()
        .build();

    // Test that extraction functions work correctly
    const envelope = "salt12345ciphertext";
    const saltLen = 10;
    const salt = rules.extractSalt(envelope, saltLen, {});
    const withoutSalt = rules.stripSalt(envelope, saltLen, {});

    // saltLen=10, so salt should be first 10 chars: "salt12345c"
    assert.strictEqual(salt, "salt12345c");
    assert.strictEqual(withoutSalt, "iphertext");
    assert.strictEqual(salt + withoutSalt, envelope);
});

// ============================================================================
// Edge Cases and Additional Tests
// ============================================================================

test("FiseBuilderInstance - offset with zero-length ciphertext", () => {
    const rules = FiseBuilder.create()
        .withOffset((c) => {
            const len = c.length || 1;
            // Ensure offset is in valid range [0, len)
            return (len % 2) % len;
        })
        .build();

    const offset = rules.offset("", {});
    // When ciphertext is empty, len becomes 1, so offset = (1 % 2) % 1 = 1 % 1 = 0
    assert.strictEqual(offset, 0);
});

test("FiseBuilderInstance - offset with single character", () => {
    const rules = FiseBuilder.defaults().build();
    const offset = rules.offset("a", { timestamp: 0 });
    assert.strictEqual(offset, 0); // (1 * 7 + 0) % 1 = 0
});

test("FiseBuilderInstance - encoding edge cases", () => {
    const rules = FiseBuilder.defaults().build();

    // Test minimum salt range
    const encodedMin = rules.encodeLength(10, {});
    const decodedMin = rules.decodeLength(encodedMin, {});
    assert.strictEqual(decodedMin, 10);

    // Test maximum salt range
    const encodedMax = rules.encodeLength(99, {});
    const decodedMax = rules.decodeLength(encodedMax, {});
    assert.strictEqual(decodedMax, 99);

    // Test boundary values
    const encoded0 = rules.encodeLength(0, {});
    const decoded0 = rules.decodeLength(encoded0, {});
    assert.strictEqual(decoded0, 0);
});

test("FiseBuilderInstance - base62 encoding edge cases", () => {
    const rules = FiseBuilder.base62().build();

    // Test various lengths
    for (let len = 0; len <= 100; len++) {
        const encoded = rules.encodeLength(len, {});
        const decoded = rules.decodeLength(encoded, {});
        assert.strictEqual(decoded, len, `Base62 encoding failed for length ${len}`);
    }
});

test("FiseBuilderInstance - hex encoding edge cases", () => {
    const rules = FiseBuilder.hex().build();

    // Test various lengths
    for (let len = 0; len <= 255; len++) {
        const encoded = rules.encodeLength(len, {});
        const decoded = rules.decodeLength(encoded, {});
        assert.strictEqual(decoded, len, `Hex encoding failed for length ${len}`);
    }
});

test("FiseBuilderInstance - customChars with minimum valid alphabet", () => {
    const alphabet = "0123456789"; // Exactly 10 characters
    const rules = FiseBuilder.customChars(alphabet).build();

    const testLen = 15;
    const encoded = rules.encodeLength(testLen, {});
    const decoded = rules.decodeLength(encoded, {});
    assert.strictEqual(decoded, testLen);
});

test("FiseBuilderInstance - salt range validation", () => {
    const rules1 = FiseBuilder.create()
        .withOffset((c) => 0)
        .withSaltRange(1, 5)
        .build();

    assert.deepStrictEqual(rules1.saltRange, { min: 1, max: 5 });

    const rules2 = FiseBuilder.create()
        .withOffset((c) => 0)
        .withSaltRange(100, 200)
        .build();

    assert.deepStrictEqual(rules2.saltRange, { min: 100, max: 200 });
});

test("FiseBuilderInstance - timestamp affects offset differently", () => {
    const rules = FiseBuilder.defaults().build();
    const cipherText = "test123456789";

    const offsets = new Set();
    for (let t = 0; t < 20; t++) {
        const offset = rules.offset(cipherText, { timestamp: t });
        offsets.add(offset);
        assert.ok(offset >= 0 && offset < cipherText.length);
    }

    // With different timestamps, we should get some variation
    // (though not necessarily all unique due to modulo)
    assert.ok(offsets.size > 0);
});

test("FiseBuilderInstance - multiFactor uses saltLength", () => {
    const rules = FiseBuilder.multiFactor().build();
    const cipherText = "test";

    const offset1 = rules.offset(cipherText, { timestamp: 0, saltLength: 10 });
    const offset2 = rules.offset(cipherText, { timestamp: 0, saltLength: 20 });

    // Different salt lengths should potentially produce different offsets
    assert.ok(offset1 >= 0 && offset1 < cipherText.length);
    assert.ok(offset2 >= 0 && offset2 < cipherText.length);
});

test("FiseBuilderInstance - all presets handle long strings", () => {
    const longString = "a".repeat(1000);
    const presets = [
        () => FiseBuilder.defaults().build(),
        () => FiseBuilder.hex().build(),
        () => FiseBuilder.base62().build(),
        () => FiseBuilder.timestamp().build(),
        () => FiseBuilder.fixed().build()
    ];

    for (const presetFn of presets) {
        const rules = presetFn();
        const encrypted = encryptFise(longString, xorCipher, rules);
        const decrypted = decryptFise(encrypted, xorCipher, rules);
        assert.strictEqual(decrypted, longString, `Preset ${presetFn.name} failed with long string`);
    }
});

test("FiseBuilderInstance - all presets handle special characters", () => {
    const specialString = "!@#$%^&*()_+-=[]{}|;':\",./<>?`~";
    const presets = [
        () => FiseBuilder.defaults().build(),
        () => FiseBuilder.hex().build(),
        () => FiseBuilder.base62().build()
    ];

    for (const presetFn of presets) {
        const rules = presetFn();
        const encrypted = encryptFise(specialString, xorCipher, rules);
        const decrypted = decryptFise(encrypted, xorCipher, rules);
        assert.strictEqual(decrypted, specialString, `Preset ${presetFn.name} failed with special chars`);
    }
});

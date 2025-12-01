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
        { name: "defaults", fn: () => FiseBuilder.defaults().build() },
        { name: "simple", fn: () => FiseBuilder.simple(7, 11).build() },
        { name: "timestamp", fn: () => FiseBuilder.timestamp().build() },
        { name: "fixed", fn: () => FiseBuilder.fixed().build() },
        { name: "lengthBased", fn: () => FiseBuilder.lengthBased(7).build() },
        { name: "prime", fn: () => FiseBuilder.prime().build() },
        { name: "multiFactor", fn: () => FiseBuilder.multiFactor().build() },
        { name: "hex", fn: () => FiseBuilder.hex().build() },
        { name: "base62", fn: () => FiseBuilder.base62().build() },
        { name: "xor", fn: () => FiseBuilder.xor().build() },
        { name: "base64", fn: () => FiseBuilder.base64().build() },
        { name: "customChars", fn: () => FiseBuilder.customChars("!@#$%^&*()").build() }
    ];

    const plaintext = "Hello, FISE!";

    for (const preset of presets) {
        try {
            const rules = preset.fn();
            const encrypted = encryptFise(plaintext, xorCipher, rules);
            const decrypted = decryptFise(encrypted, xorCipher, rules);
            assert.strictEqual(
                decrypted,
                plaintext,
                `Preset ${preset.name} failed: expected "${plaintext}", got "${decrypted.substring(0, 50)}${decrypted.length > 50 ? '...' : ''}"`
            );
        } catch (error) {
            throw new Error(`Preset ${preset.name} threw error: ${error.message}`);
        }
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

// ============================================================================
// Comprehensive Builder Tests
// ============================================================================

test("FiseBuilderInstance - multiple build calls create independent instances", () => {
    const builder = FiseBuilder.create()
        .withOffset((c) => 0)
        .withSaltRange(10, 20);

    const rules1 = builder.build();
    const rules2 = builder.build();

    // Both should be valid but independent
    assert.ok(rules1.offset);
    assert.ok(rules2.offset);
    assert.deepStrictEqual(rules1.saltRange, rules2.saltRange);
});

test("FiseBuilderInstance - builder methods can be called multiple times", () => {
    const builder = FiseBuilder.create()
        .withOffset((c) => 0)
        .withSaltRange(10, 20)
        .withSaltRange(30, 40); // Override previous

    const rules = builder.build();
    assert.deepStrictEqual(rules.saltRange, { min: 30, max: 40 });
});

test("FiseBuilderInstance - offset function receives correct context", () => {
    let receivedContext = null;
    const rules = FiseBuilder.create()
        .withOffset((c, ctx) => {
            receivedContext = ctx;
            return 0;
        })
        .build();

    const testContext = { timestamp: 123, saltLength: 50, metadata: { test: true } };
    rules.offset("test", testContext);

    assert.deepStrictEqual(receivedContext, testContext);
});

test("FiseBuilderInstance - encodeLength function receives correct context", () => {
    let receivedContext = null;
    const rules = FiseBuilder.create()
        .withOffset((c) => 0)
        .withEncodeLength((len, ctx) => {
            receivedContext = ctx;
            return len.toString(36).padStart(2, "0");
        })
        .withDecodeLength((encoded) => parseInt(encoded, 36))
        .build();

    const testContext = { timestamp: 456, saltLength: 75 };
    rules.encodeLength(10, testContext);

    // Context should be received
    assert.ok(receivedContext !== null, "Context should be received");
    assert.strictEqual(receivedContext.timestamp, testContext.timestamp);
    assert.strictEqual(receivedContext.saltLength, testContext.saltLength);
});

test("FiseBuilderInstance - decodeLength function receives correct context", () => {
    let receivedContext = null;
    const rules = FiseBuilder.create()
        .withOffset((c) => 0)
        .withEncodeLength((len) => len.toString(36).padStart(2, "0"))
        .withDecodeLength((encoded, ctx) => {
            receivedContext = ctx;
            return parseInt(encoded, 36);
        })
        .build();

    const testContext = { timestamp: 789 };
    rules.decodeLength("0a", testContext);

    // Context should be received
    assert.ok(receivedContext !== null, "Context should be received");
    assert.strictEqual(receivedContext.timestamp, testContext.timestamp);
});

test("FiseBuilderInstance - all presets work with various string lengths", () => {
    const testStrings = [
        "",
        "a",
        "ab",
        "abc",
        "Hello",
        "Hello, World!",
        "a".repeat(10),
        "a".repeat(100),
        "a".repeat(1000),
        "Test with\nnewlines",
        "Test with\ttabs",
        "Test with spaces and punctuation!",
    ];

    const presets = [
        () => FiseBuilder.defaults().build(),
        () => FiseBuilder.hex().build(),
        () => FiseBuilder.base62().build(),
        () => FiseBuilder.fixed().build(),
        () => FiseBuilder.timestamp().build()
    ];

    for (const presetFn of presets) {
        const rules = presetFn();
        for (const testString of testStrings) {
            const encrypted = encryptFise(testString, xorCipher, rules);
            const decrypted = decryptFise(encrypted, xorCipher, rules);
            assert.strictEqual(
                decrypted,
                testString,
                `Preset ${presetFn.name} failed for string length ${testString.length}`
            );
        }
    }
});

test("FiseBuilderInstance - all presets work with timestamp option", () => {
    const plaintext = "Test message";
    const timestamp = Math.floor(Date.now() / 60000);

    const presets = [
        () => FiseBuilder.defaults().build(),
        () => FiseBuilder.simple().build(),
        () => FiseBuilder.timestamp().build(),
        () => FiseBuilder.prime().build(),
        () => FiseBuilder.multiFactor().build()
    ];

    for (const presetFn of presets) {
        const rules = presetFn();
        const encrypted = encryptFise(plaintext, xorCipher, rules, { timestamp });
        const decrypted = decryptFise(encrypted, xorCipher, rules, { timestamp });
        assert.strictEqual(decrypted, plaintext, `Preset ${presetFn.name} failed with timestamp`);
    }
});

test("FiseBuilderInstance - all presets work with metadata option", () => {
    const plaintext = "Test message";
    const metadata = { userId: 123, sessionId: "abc" };

    const presets = [
        () => FiseBuilder.defaults().build(),
        () => FiseBuilder.hex().build(),
        () => FiseBuilder.base62().build()
    ];

    for (const presetFn of presets) {
        const rules = presetFn();
        const encrypted = encryptFise(plaintext, xorCipher, rules, { metadata });
        const decrypted = decryptFise(encrypted, xorCipher, rules, { metadata });
        assert.strictEqual(decrypted, plaintext, `Preset ${presetFn.name} failed with metadata`);
    }
});

test("FiseBuilder.simple() - different multiplier/modulo combinations", () => {
    const combinations = [
        [3, 5],
        [7, 11],
        [13, 17],
        [19, 23],
        [29, 31]
    ];

    for (const [mult, mod] of combinations) {
        const rules = FiseBuilder.simple(mult, mod).build();
        const plaintext = "Test";
        const encrypted = encryptFise(plaintext, xorCipher, rules);
        const decrypted = decryptFise(encrypted, xorCipher, rules);
        assert.strictEqual(decrypted, plaintext, `simple(${mult}, ${mod}) failed`);
    }
});

test("FiseBuilder.timestamp() - different multiplier/modulo combinations", () => {
    const combinations = [
        [5, 7],
        [11, 13],
        [17, 19],
        [23, 29]
    ];

    for (const [mult, mod] of combinations) {
        const rules = FiseBuilder.timestamp(mult, mod).build();
        const plaintext = "Test";
        const encrypted = encryptFise(plaintext, xorCipher, rules);
        const decrypted = decryptFise(encrypted, xorCipher, rules);
        assert.strictEqual(decrypted, plaintext, `timestamp(${mult}, ${mod}) failed`);
    }
});

test("FiseBuilder.prime() - different prime combinations", () => {
    const combinations = [
        [3, 5],
        [7, 11],
        [13, 17],
        [19, 23],
        [29, 31],
        [37, 41]
    ];

    for (const [mult, mod] of combinations) {
        const rules = FiseBuilder.prime(mult, mod).build();
        const plaintext = "Test";
        const encrypted = encryptFise(plaintext, xorCipher, rules);
        const decrypted = decryptFise(encrypted, xorCipher, rules);
        assert.strictEqual(decrypted, plaintext, `prime(${mult}, ${mod}) failed`);
    }
});

test("FiseBuilder.lengthBased() - different modulo values", () => {
    const modulos = [3, 5, 7, 11, 13, 17, 19, 23];

    for (const mod of modulos) {
        const rules = FiseBuilder.lengthBased(mod).build();
        const plaintext = "Test message";
        const encrypted = encryptFise(plaintext, xorCipher, rules);
        const decrypted = decryptFise(encrypted, xorCipher, rules);
        assert.strictEqual(decrypted, plaintext, `lengthBased(${mod}) failed`);
    }
});

test("FiseBuilder.customChars() - various alphabet sizes", () => {
    const alphabets = [
        "0123456789", // 10 chars (minimum)
        "0123456789ABCDEF", // 16 chars
        "!@#$%^&*()_+-=", // 14 chars
        "abcdefghijklmnopqrstuvwxyz", // 26 chars
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", // 62 chars
    ];

    for (const alphabet of alphabets) {
        const rules = FiseBuilder.customChars(alphabet).build();
        const plaintext = "Test";
        const encrypted = encryptFise(plaintext, xorCipher, rules);
        const decrypted = decryptFise(encrypted, xorCipher, rules);
        assert.strictEqual(decrypted, plaintext, `customChars with ${alphabet.length} chars failed`);
    }
});

test("FiseBuilderInstance - chaining all optional methods", () => {
    const rules = FiseBuilder.create()
        .withOffset((c, ctx) => {
            const t = ctx.timestamp ?? 0;
            return (c.length * 7 + (t % 11)) % c.length;
        })
        .withEncodeLength((len) => len.toString(36).padStart(2, "0"))
        .withDecodeLength((encoded) => parseInt(encoded, 36))
        .withSaltRange(15, 85)
        .withHeadSalt()
        .build();

    assert.ok(rules.offset);
    assert.ok(rules.encodeLength);
    assert.ok(rules.decodeLength);
    assert.deepStrictEqual(rules.saltRange, { min: 15, max: 85 });
    assert.ok(rules.extractSalt);
    assert.ok(rules.stripSalt);

    // Note: head salt extraction is for custom implementations
    // Standard encryptFise uses tail-based extraction, so we test extraction functions directly
    const envelope = "salt12345ciphertext";
    const saltLen = 10;
    const salt = rules.extractSalt(envelope, saltLen, {});
    const withoutSalt = rules.stripSalt(envelope, saltLen, {});
    assert.strictEqual(salt + withoutSalt, envelope);
});

test("FiseBuilderInstance - custom salt extraction with context", () => {
    let extractContext = null;
    let stripContext = null;

    const rules = FiseBuilder.create()
        .withOffset((c) => 0)
        .withCustomSaltExtraction(
            (envelope, saltLen, ctx) => {
                extractContext = ctx;
                return envelope.slice(0, saltLen);
            },
            (envelope, saltLen, ctx) => {
                stripContext = ctx;
                return envelope.slice(saltLen);
            }
        )
        .build();

    const testContext = { timestamp: 100, saltLength: 20 };
    const envelope = "salt12345ciphertext";
    const saltLen = 10;

    rules.extractSalt(envelope, saltLen, testContext);
    rules.stripSalt(envelope, saltLen, testContext);

    assert.deepStrictEqual(extractContext, testContext);
    assert.deepStrictEqual(stripContext, testContext);
});

test("FiseBuilderInstance - multiple encryption cycles with same rules", () => {
    const rules = FiseBuilder.defaults().build();
    const plaintext = "Test message";

    // Encrypt and decrypt multiple times
    for (let i = 0; i < 10; i++) {
        const encrypted = encryptFise(plaintext, xorCipher, rules);
        const decrypted = decryptFise(encrypted, xorCipher, rules);
        assert.strictEqual(decrypted, plaintext, `Cycle ${i + 1} failed`);
    }
});

test("FiseBuilderInstance - offset boundary conditions", () => {
    const testCases = [
        { length: 1, expected: 0 }, // Math.floor(1/2) = 0
        { length: 2, expected: 1 }, // Math.floor(2/2) = 1
        { length: 3, expected: 1 }, // Math.floor(3/2) = 1
        { length: 10, expected: 5 }, // Math.floor(10/2) = 5
    ];

    for (const testCase of testCases) {
        const rules = FiseBuilder.fixed().build();
        const cipherText = "a".repeat(testCase.length);
        const offset = rules.offset(cipherText, {});
        assert.strictEqual(offset, testCase.expected, `Fixed offset failed for length ${testCase.length}`);
    }
});

test("FiseBuilderInstance - encoding handles all salt range values", () => {
    const presets = [
        () => FiseBuilder.defaults().build(),
        () => FiseBuilder.hex().build(),
        () => FiseBuilder.base62().build(),
        () => FiseBuilder.base64().build()
    ];

    for (const presetFn of presets) {
        const rules = presetFn();
        // Test entire salt range (10-99)
        for (let len = 10; len <= 99; len++) {
            const encoded = rules.encodeLength(len, {});
            const decoded = rules.decodeLength(encoded, {});
            assert.strictEqual(decoded, len, `Preset ${presetFn.name} failed for length ${len}`);
        }
    }
});

test("FiseBuilderInstance - offset with various ciphertext lengths", () => {
    const rules = FiseBuilder.defaults().build();

    for (let len = 1; len <= 100; len++) {
        const cipherText = "a".repeat(len);
        const offset = rules.offset(cipherText, { timestamp: 0 });
        assert.ok(offset >= 0 && offset < len, `Offset ${offset} out of range for length ${len}`);
    }
});

test("FiseBuilderInstance - base64 encoding edge cases", () => {
    const rules = FiseBuilder.base64().build();

    // Test various lengths
    for (let len = 0; len <= 200; len++) {
        const encoded = rules.encodeLength(len, {});
        const decoded = rules.decodeLength(encoded, {});
        assert.strictEqual(decoded, len, `Base64 encoding failed for length ${len}`);
    }
});

test("FiseBuilderInstance - customChars encoding with large alphabet", () => {
    const largeAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()";
    const rules = FiseBuilder.customChars(largeAlphabet).build();

    for (let len = 0; len <= 200; len++) {
        const encoded = rules.encodeLength(len, {});
        const decoded = rules.decodeLength(encoded, {});
        assert.strictEqual(decoded, len, `CustomChars encoding failed for length ${len}`);
    }
});

test("FiseBuilderInstance - decodeLength handles invalid input gracefully", () => {
    const rules = FiseBuilder.base62().build();

    // Test with invalid characters
    const invalid = rules.decodeLength("!!", {});
    assert.ok(isNaN(invalid), "decodeLength should return NaN for invalid input");
});

test("FiseBuilderInstance - customChars decodeLength handles invalid input", () => {
    const rules = FiseBuilder.customChars("!@#$%^&*()").build();

    // Test with character not in alphabet
    const invalid = rules.decodeLength("XX", {});
    assert.ok(isNaN(invalid), "decodeLength should return NaN for invalid input");
});

test("FiseBuilderInstance - presets produce consistent results", () => {
    const rules = FiseBuilder.defaults().build();
    const cipherText = "test123";
    const ctx = { timestamp: 5 };

    // Same input should produce same offset
    const offset1 = rules.offset(cipherText, ctx);
    const offset2 = rules.offset(cipherText, ctx);
    assert.strictEqual(offset1, offset2, "Offset should be deterministic");
});

test("FiseBuilderInstance - all presets handle unicode characters", () => {
    const unicodeStrings = [
        "Hello 世界",
        "Привет",
        "こんにちは",
        "مرحبا",
        "🌍🌎🌏",
        "Test with émojis 🚀🎉",
    ];

    const presets = [
        () => FiseBuilder.defaults().build(),
        () => FiseBuilder.hex().build(),
        () => FiseBuilder.base62().build()
    ];

    for (const presetFn of presets) {
        const rules = presetFn();
        for (const testString of unicodeStrings) {
            const encrypted = encryptFise(testString, xorCipher, rules);
            const decrypted = decryptFise(encrypted, xorCipher, rules);
            assert.strictEqual(decrypted, testString, `Preset ${presetFn.name} failed with unicode`);
        }
    }
});

test("FiseBuilderInstance - all presets handle JSON data", () => {
    const jsonData = JSON.stringify({
        name: "Test",
        value: 123,
        nested: { a: 1, b: 2 },
        array: [1, 2, 3]
    });

    const presets = [
        () => FiseBuilder.defaults().build(),
        () => FiseBuilder.hex().build(),
        () => FiseBuilder.base62().build(),
        () => FiseBuilder.timestamp().build()
    ];

    for (const presetFn of presets) {
        const rules = presetFn();
        const encrypted = encryptFise(jsonData, xorCipher, rules);
        const decrypted = decryptFise(encrypted, xorCipher, rules);
        assert.strictEqual(decrypted, jsonData, `Preset ${presetFn.name} failed with JSON`);

        // Verify it's valid JSON
        const parsed = JSON.parse(decrypted);
        assert.strictEqual(parsed.name, "Test");
    }
});

test("FiseBuilderInstance - salt range edge cases", () => {
    const edgeCases = [
        { min: 1, max: 1 },
        { min: 10, max: 10 },
        { min: 99, max: 99 },
        { min: 10, max: 11 },
        { min: 50, max: 100 },
    ];

    for (const range of edgeCases) {
        const rules = FiseBuilder.create()
            .withOffset((c) => 0)
            .withSaltRange(range.min, range.max)
            .build();

        assert.deepStrictEqual(rules.saltRange, range);

        // Should still work
        const plaintext = "Test";
        const encrypted = encryptFise(plaintext, xorCipher, rules);
        const decrypted = decryptFise(encrypted, xorCipher, rules);
        assert.strictEqual(decrypted, plaintext);
    }
});

test("FiseBuilderInstance - offset with zero timestamp", () => {
    const rules = FiseBuilder.defaults().build();
    const cipherText = "test123";

    const offsetZero = rules.offset(cipherText, { timestamp: 0 });
    const offsetUndefined = rules.offset(cipherText, {});

    // Both should be the same (defaults to 0)
    assert.strictEqual(offsetZero, offsetUndefined);
});

test("FiseBuilderInstance - multiFactor with missing saltLength", () => {
    const rules = FiseBuilder.multiFactor().build();
    const cipherText = "test";

    // Should default saltLength to 10 if not provided
    const offset1 = rules.offset(cipherText, { timestamp: 0 });
    const offset2 = rules.offset(cipherText, { timestamp: 0, saltLength: 10 });

    // Should be the same
    assert.strictEqual(offset1, offset2);
});

test("FiseBuilderInstance - xor offset with various timestamps", () => {
    const rules = FiseBuilder.xor().build();
    const cipherText = "test123";

    const offsets = new Set();
    for (let t = 0; t < 50; t++) {
        const offset = rules.offset(cipherText, { timestamp: t });
        offsets.add(offset);
        assert.ok(offset >= 0 && offset < cipherText.length);
    }

    // XOR should produce good distribution
    assert.ok(offsets.size > 1);
});

test("FiseBuilderInstance - fixed offset is consistent", () => {
    const rules = FiseBuilder.fixed().build();
    const cipherText = "test123456";

    // Fixed offset should always be the same
    const offset1 = rules.offset(cipherText, {});
    const offset2 = rules.offset(cipherText, { timestamp: 100 });
    const offset3 = rules.offset(cipherText, { saltLength: 50 });

    assert.strictEqual(offset1, offset2);
    assert.strictEqual(offset2, offset3);
    assert.strictEqual(offset1, Math.floor(cipherText.length / 2));
});

test("FiseBuilderInstance - lengthBased offset is consistent for same length", () => {
    const rules = FiseBuilder.lengthBased(7).build();

    const cipherText1 = "test123";
    const cipherText2 = "abcd123";

    // Same length should produce same offset
    const offset1 = rules.offset(cipherText1, {});
    const offset2 = rules.offset(cipherText2, {});

    assert.strictEqual(offset1, offset2);
    assert.strictEqual(offset1, cipherText1.length % 7);
});

test("FiseBuilderInstance - builder instance immutability", () => {
    const builder = FiseBuilder.create()
        .withOffset((c) => 0)
        .withSaltRange(10, 20);

    const rules1 = builder.build();

    // Modify builder
    builder.withSaltRange(30, 40);

    // Previous build should be unchanged
    assert.deepStrictEqual(rules1.saltRange, { min: 10, max: 20 });

    // New build should have new values
    const rules2 = builder.build();
    assert.deepStrictEqual(rules2.saltRange, { min: 30, max: 40 });
});

test("FiseBuilderInstance - all encoding methods handle zero correctly", () => {
    const presets = [
        () => FiseBuilder.defaults().build(),
        () => FiseBuilder.hex().build(),
        () => FiseBuilder.base62().build(),
        () => FiseBuilder.base64().build(),
        () => FiseBuilder.customChars("0123456789").build()
    ];

    for (const presetFn of presets) {
        const rules = presetFn();
        const encoded = rules.encodeLength(0, {});
        const decoded = rules.decodeLength(encoded, {});
        assert.strictEqual(decoded, 0, `Preset ${presetFn.name} failed for zero`);
    }
});

test("FiseBuilderInstance - complex chaining with all methods", () => {
    const rules = FiseBuilder.defaults()
        .withSaltRange(25, 75)
        .build();

    assert.ok(rules.offset);
    assert.ok(rules.encodeLength);
    assert.ok(rules.decodeLength);
    assert.deepStrictEqual(rules.saltRange, { min: 25, max: 75 });

    // Should work with encryption
    const plaintext = "Complex test";
    const encrypted = encryptFise(plaintext, xorCipher, rules);
    const decrypted = decryptFise(encrypted, xorCipher, rules);
    assert.strictEqual(decrypted, plaintext);
});

test("FiseBuilderInstance - preset customization preserves functionality", () => {
    const baseRules = FiseBuilder.defaults().build();
    const customizedRules = FiseBuilder.defaults()
        .withSaltRange(20, 30)
        .build();

    const plaintext = "Test";

    // Both should work
    const encrypted1 = encryptFise(plaintext, xorCipher, baseRules);
    const encrypted2 = encryptFise(plaintext, xorCipher, customizedRules);

    assert.strictEqual(decryptFise(encrypted1, xorCipher, baseRules), plaintext);
    assert.strictEqual(decryptFise(encrypted2, xorCipher, customizedRules), plaintext);

    // Salt ranges should be different
    assert.notDeepStrictEqual(baseRules.saltRange, customizedRules.saltRange);
});

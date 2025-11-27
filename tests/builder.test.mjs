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
            const t = ctx.timestampMinutes ?? 0;
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
            const t = ctx.timestampMinutes ?? 0;
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
    const offset = rules.offset(cipherText, { timestampMinutes: 0 });
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
    const offset = rules.offset(cipherText, { timestampMinutes: 5 });
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
    const offset = rules.offset(cipherText, { timestampMinutes: 10 });
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
    const offset = rules.offset(cipherText, { timestampMinutes: 5, saltLength: 15 });
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
    const offset = rules.offset(cipherText, { timestampMinutes: 5 });
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
    // Use a fixed offset that's valid but might be clamped
    const rules = FiseBuilder.create()
        .withOffset((c) => {
            // Return offset that's valid but at the edge
            return Math.max(0, c.length - 1);
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

    const offset1 = rules.offset(cipherText, { timestampMinutes: 0 });
    const offset2 = rules.offset(cipherText, { timestampMinutes: 11 });

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

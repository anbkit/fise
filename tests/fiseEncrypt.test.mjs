import { test } from "node:test";
import assert from "node:assert";
import { fiseEncrypt, fiseDecrypt } from "../dist/index.js";
import { xorCipher } from "../dist/core/xorCipher.js";
import { defaultRules } from "../dist/rules/defaultRules.js";

test("fiseEncrypt - basic encryption", () => {
    const plaintext = "Hello, world!";
    const encrypted = fiseEncrypt(plaintext, defaultRules);

    assert.ok(typeof encrypted === "string");
    assert.ok(encrypted.length > plaintext.length);
    assert.ok(encrypted !== plaintext);
});

test("fiseEncrypt - roundtrip encryption/decryption", () => {
    const plaintext = "Hello, world!";
    const encrypted = fiseEncrypt(plaintext, defaultRules);
    const decrypted = fiseDecrypt(encrypted, defaultRules);

    assert.strictEqual(decrypted, plaintext);
});

test("fiseEncrypt - different inputs produce different outputs", () => {
    const plaintext = "Hello, world!";
    const encrypted1 = fiseEncrypt(plaintext, defaultRules);
    const encrypted2 = fiseEncrypt(plaintext, defaultRules);

    // Due to random salt, outputs should be different
    assert.ok(encrypted1 !== encrypted2);
});

test("fiseEncrypt - empty string", () => {
    const plaintext = "";
    const encrypted = fiseEncrypt(plaintext, defaultRules);
    const decrypted = fiseDecrypt(encrypted, defaultRules);

    assert.strictEqual(decrypted, plaintext);
});

test("fiseEncrypt - long string", () => {
    const plaintext = "A".repeat(1000);
    const encrypted = fiseEncrypt(plaintext, defaultRules);
    const decrypted = fiseDecrypt(encrypted, defaultRules);

    assert.strictEqual(decrypted, plaintext);
});

test("fiseEncrypt - JSON data", () => {
    const plaintext = JSON.stringify({ name: "FISE", version: "0.1.0" });
    const encrypted = fiseEncrypt(plaintext, defaultRules);
    const decrypted = fiseDecrypt(encrypted, defaultRules);

    assert.strictEqual(decrypted, plaintext);
    const parsed = JSON.parse(decrypted);
    assert.strictEqual(parsed.name, "FISE");
});

test("fiseEncrypt - unicode characters", () => {
    const plaintext = "Hello 世界 🌍";
    const encrypted = fiseEncrypt(plaintext, defaultRules);
    const decrypted = fiseDecrypt(encrypted, defaultRules);

    assert.strictEqual(decrypted, plaintext);
});

test("fiseEncrypt - with timestamp option", () => {
    const plaintext = "Hello, world!";
    const timestamp = 12345;
    const encrypted = fiseEncrypt(plaintext, defaultRules, {
        timestamp
    });
    const decrypted = fiseDecrypt(encrypted, defaultRules, {
        timestamp
    });

    assert.strictEqual(decrypted, plaintext);
});

test("fiseEncrypt - with custom salt length range", () => {
    const plaintext = "Hello, world!";
    const customRules = {
        ...defaultRules,
        saltRange: { min: 15, max: 20 }
    };
    const encrypted = fiseEncrypt(plaintext, customRules);
    const decrypted = fiseDecrypt(encrypted, customRules);

    assert.strictEqual(decrypted, plaintext);
});

test("fiseEncrypt - with custom salt range in rules", () => {
    const plaintext = "Hello, world!";
    const customRules = {
        ...defaultRules,
        saltRange: { min: 20, max: 30 }
    };

    const encrypted = fiseEncrypt(plaintext, customRules);
    const decrypted = fiseDecrypt(encrypted, customRules);

    assert.strictEqual(decrypted, plaintext);
});

test("fiseDecrypt - error: invalid envelope", () => {
    assert.throws(
        () => {
            fiseDecrypt("invalid", defaultRules);
        },
        {
            message: "FISE: cannot infer salt length from envelope. This may indicate a corrupted envelope or mismatched rules/timestamp."
        }
    );
});

test("fiseEncrypt - multiple roundtrips with same input", () => {
    const plaintext = "Test message";
    for (let i = 0; i < 10; i++) {
        const encrypted = fiseEncrypt(plaintext, defaultRules);
        const decrypted = fiseDecrypt(encrypted, defaultRules);
        assert.strictEqual(decrypted, plaintext);
    }
});

test("fiseEncrypt - various special characters", () => {
    const testCases = [
        "!@#$%^&*()",
        "Line 1\nLine 2\nLine 3",
        "\tTabbed\tText\t",
        "   Spaces   ",
        "Mixed123!@#ABC"
    ];

    for (const plaintext of testCases) {
        const encrypted = fiseEncrypt(plaintext, defaultRules);
        const decrypted = fiseDecrypt(encrypted, defaultRules);
        assert.strictEqual(decrypted, plaintext);
    }
});

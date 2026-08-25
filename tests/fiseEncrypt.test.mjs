import { test } from "node:test";
import assert from "node:assert";
import { defineStringProfile, fiseEncrypt, fiseDecrypt } from "../dist/index.js";
import { defaultStringProfile } from "../dist/profiles/defaultStringProfile.js";

test("fiseEncrypt - basic encryption", () => {
    const plaintext = "Hello, world!";
    const encrypted = fiseEncrypt(plaintext, defaultStringProfile);

    assert.ok(typeof encrypted === "string");
    assert.ok(encrypted.length > plaintext.length);
    assert.ok(encrypted !== plaintext);
});

test("fiseEncrypt - roundtrip encryption/decryption", () => {
    const plaintext = "Hello, world!";
    const encrypted = fiseEncrypt(plaintext, defaultStringProfile);
    const decrypted = fiseDecrypt(encrypted, defaultStringProfile);

    assert.strictEqual(decrypted, plaintext);
});

test("fiseEncrypt - different inputs produce different outputs", () => {
    const plaintext = "Hello, world!";
    const encrypted1 = fiseEncrypt(plaintext, defaultStringProfile);
    const encrypted2 = fiseEncrypt(plaintext, defaultStringProfile);

    // Due to random salt, outputs should be different
    assert.ok(encrypted1 !== encrypted2);
});

test("fiseEncrypt - empty string", () => {
    const plaintext = "";
    const encrypted = fiseEncrypt(plaintext, defaultStringProfile);
    const decrypted = fiseDecrypt(encrypted, defaultStringProfile);

    assert.strictEqual(decrypted, plaintext);
});

test("fiseEncrypt - long string", () => {
    const plaintext = "A".repeat(1000);
    const encrypted = fiseEncrypt(plaintext, defaultStringProfile);
    const decrypted = fiseDecrypt(encrypted, defaultStringProfile);

    assert.strictEqual(decrypted, plaintext);
});

test("fiseEncrypt - JSON data", () => {
    const plaintext = JSON.stringify({ name: "FISE", version: "0.1.0" });
    const encrypted = fiseEncrypt(plaintext, defaultStringProfile);
    const decrypted = fiseDecrypt(encrypted, defaultStringProfile);

    assert.strictEqual(decrypted, plaintext);
    const parsed = JSON.parse(decrypted);
    assert.strictEqual(parsed.name, "FISE");
});

test("fiseEncrypt - unicode characters", () => {
    const plaintext = "Hello 世界 🌍";
    const encrypted = fiseEncrypt(plaintext, defaultStringProfile);
    const decrypted = fiseDecrypt(encrypted, defaultStringProfile);

    assert.strictEqual(decrypted, plaintext);
});

test("fiseEncrypt - with timestamp option", () => {
    const plaintext = "Hello, world!";
    const timestamp = 12345;
    const encrypted = fiseEncrypt(plaintext, defaultStringProfile, {
        timestamp
    });
    const decrypted = fiseDecrypt(encrypted, defaultStringProfile, {
        timestamp
    });

    assert.strictEqual(decrypted, plaintext);
});

test("fiseEncrypt - with custom salt length range", () => {
    const plaintext = "Hello, world!";
    const customProfile = defineStringProfile({
        ...defaultStringProfile,
        id: "test.salt-range.15-20",
		layout: { ...defaultStringProfile.layout, saltRange: { min: 15, max: 20 } }
    });
    const encrypted = fiseEncrypt(plaintext, customProfile);
    const decrypted = fiseDecrypt(encrypted, customProfile);

    assert.strictEqual(decrypted, plaintext);
});

test("fiseEncrypt - with custom salt range in a profile", () => {
    const plaintext = "Hello, world!";
    const customProfile = defineStringProfile({
        ...defaultStringProfile,
        id: "test.salt-range.20-30",
		layout: { ...defaultStringProfile.layout, saltRange: { min: 20, max: 30 } }
    });

    const encrypted = fiseEncrypt(plaintext, customProfile);
    const decrypted = fiseDecrypt(encrypted, customProfile);

    assert.strictEqual(decrypted, plaintext);
});

test("fiseDecrypt - passes declared lengths to layout operations", () => {
	let observedSaltLength;
    const profile = defineStringProfile({
		...defaultStringProfile,
		id: "test.layout-input",
		layout: {
			markerSize: 2,
			saltRange: { min: 10, max: 10 },
			offset(input) {
				return Math.floor(input.transformedLength / 2);
			},
			createMarker(input) {
				observedSaltLength = input.saltLength;
				return input.saltLength.toString(36).padStart(2, "0");
			}
		}
    });

    const plaintext = "candidate context";
	const encrypted = fiseEncrypt(plaintext, profile);
	assert.strictEqual(fiseDecrypt(encrypted, profile), plaintext);
	assert.strictEqual(observedSaltLength, 10);
});

test("fiseDecrypt - error: invalid envelope", () => {
    assert.throws(
        () => {
            fiseDecrypt("invalid", defaultStringProfile);
        },
        {
			code: "INVALID_ENVELOPE"
        }
    );
});

test("fiseEncrypt - multiple roundtrips with same input", () => {
    const plaintext = "Test message";
    for (let i = 0; i < 10; i++) {
        const encrypted = fiseEncrypt(plaintext, defaultStringProfile);
        const decrypted = fiseDecrypt(encrypted, defaultStringProfile);
        assert.strictEqual(decrypted, plaintext);
    }
});

test("fiseDecrypt - error: mismatched metadata with a context-aware profile", () => {
    const metadataAwareProfile = defineStringProfile({
        ...defaultStringProfile,
		id: "test.metadata-aware",
		context: {
			timestamp: "optional",
			metadata: { userId: { type: "number", required: true } }
		},
		layout: {
			...defaultStringProfile.layout,
			offset(input, ctx) {
				const userId = ctx.metadata?.userId ?? 0;
				const t = ctx.timestamp ?? 0;
				const len = input.transformedLength || 1;
				return (len * 7 + (t % 11) + (Number(userId) % 5)) % len;
			}
		}
    });

    const plaintext = "Hello, metadata!";
	const encrypted = fiseEncrypt(plaintext, metadataAwareProfile, {
        metadata: { userId: 123 }
    });

    assert.throws(
        () => {
			fiseDecrypt(encrypted, metadataAwareProfile, {
                metadata: { userId: 456 }
            });
        },
        {
			code: "MARKER_MISMATCH"
        }
    );
});

test("fiseDecrypt - error: tampered encoded length marker", () => {
    const plaintext = "Test tamper";
    const fixedSaltProfile = defineStringProfile({
        ...defaultStringProfile,
		id: "test.fixed-salt",
		layout: { ...defaultStringProfile.layout, saltRange: { min: 10, max: 10 } }
    });

    const timestamp = 0;
	const encrypted = fiseEncrypt(plaintext, fixedSaltProfile, { timestamp });

	const profileLength = Number.parseInt(encrypted.slice(8, 10), 16);
	const bodyStart = 22 + profileLength;
	const cipherTextLength = Number.parseInt(encrypted.slice(14, 22), 16);
	const offset = (cipherTextLength * 7 + (timestamp % 11)) % cipherTextLength;
	const markerStart = bodyStart + offset;
	const tamperedChar = encrypted[markerStart] === "z" ? "y" : "z";
	const tamperedEnvelope =
		encrypted.slice(0, markerStart) + tamperedChar + encrypted.slice(markerStart + 1);

	assert.throws(
		() => {
			fiseDecrypt(tamperedEnvelope, fixedSaltProfile, { timestamp });
		},
		{ code: "MARKER_MISMATCH" }
	);
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
        const encrypted = fiseEncrypt(plaintext, defaultStringProfile);
        const decrypted = fiseDecrypt(encrypted, defaultStringProfile);
        assert.strictEqual(decrypted, plaintext);
    }
});

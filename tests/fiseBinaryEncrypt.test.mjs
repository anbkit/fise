import { test } from "node:test";
import assert from "node:assert";
import {
	defaultBinaryProfile,
	defaultStringProfile,
	defineBinaryProfile,
	fiseBinaryDecrypt,
	fiseBinaryEncrypt
} from "../dist/index.js";

// Helper to convert string to Uint8Array
function stringToUint8Array(str) {
	return new TextEncoder().encode(str);
}

// Helper to check if two Uint8Arrays are equal
function arraysEqual(a, b) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

test("fiseBinaryEncrypt - basic encryption", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryProfile);

	assert.ok(encrypted instanceof Uint8Array);
	assert.ok(encrypted.length > binaryData.length);
	assert.ok(!arraysEqual(encrypted, binaryData));
});

test("fiseBinaryEncrypt - roundtrip encryption/decryption", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryProfile);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryProfile);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - different inputs produce different outputs", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const encrypted1 = fiseBinaryEncrypt(binaryData, defaultBinaryProfile);
	const encrypted2 = fiseBinaryEncrypt(binaryData, defaultBinaryProfile);

	// Due to random salt, outputs should be different
	assert.ok(!arraysEqual(encrypted1, encrypted2));
});

test("fiseBinaryEncrypt - empty binary data", () => {
	const binaryData = new Uint8Array([]);
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryProfile);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryProfile);

	assert.deepStrictEqual(decrypted, binaryData);
	assert.strictEqual(decrypted.length, 0);
});

test("fiseBinaryEncrypt - single byte", () => {
	const binaryData = new Uint8Array([65]); // 'A'
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryProfile);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryProfile);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - large binary data", () => {
	const binaryData = new Uint8Array(10000);
	for (let i = 0; i < 10000; i++) {
		binaryData[i] = i % 256;
	}
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryProfile);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryProfile);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - video-like data (random bytes)", () => {
	// Simulate video data: large array with random bytes
	const binaryData = new Uint8Array(50000);
	for (let i = 0; i < 50000; i++) {
		binaryData[i] = Math.floor(Math.random() * 256);
	}
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryProfile);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryProfile);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - all zero bytes", () => {
	const binaryData = new Uint8Array(100).fill(0);
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryProfile);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryProfile);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - all 255 bytes", () => {
	const binaryData = new Uint8Array(100).fill(255);
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryProfile);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryProfile);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - preserves all byte values (0-255)", () => {
	// Test all possible byte values
	const binaryData = new Uint8Array(256);
	for (let i = 0; i < 256; i++) {
		binaryData[i] = i;
	}
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryProfile);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryProfile);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - with timestamp option", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const timestamp = 12345;
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryProfile, {
		timestamp
	});
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryProfile, {
		timestamp
	});

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - with metadata option", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const metadata = { productId: 123, userId: 456 };
	const profile = defineBinaryProfile({
		...defaultBinaryProfile,
		id: "test.binary.metadata",
		context: {
			metadata: {
				productId: { type: "number", required: true },
				userId: { type: "number", required: true }
			}
		}
	});
	const encrypted = fiseBinaryEncrypt(binaryData, profile, {
		metadata
	});
	const decrypted = fiseBinaryDecrypt(encrypted, profile, {
		metadata
	});

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - with timestamp and metadata", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const timestamp = 12345;
	const metadata = { productId: 123 };
	const profile = defineBinaryProfile({
		...defaultBinaryProfile,
		id: "test.binary.timestamp-metadata",
		context: {
			timestamp: "required",
			metadata: { productId: { type: "number", required: true } }
		}
	});
	const encrypted = fiseBinaryEncrypt(binaryData, profile, {
		timestamp,
		metadata
	});
	const decrypted = fiseBinaryDecrypt(encrypted, profile, {
		timestamp,
		metadata
	});

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - with custom salt length range", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const customProfile = defineBinaryProfile({
		...defaultBinaryProfile,
		id: "test.binary.range",
		layout: { ...defaultBinaryProfile.layout, saltRange: { min: 15, max: 20 } }
	});
	const encrypted = fiseBinaryEncrypt(binaryData, customProfile);
	const decrypted = fiseBinaryDecrypt(encrypted, customProfile);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - multiple roundtrips with same input", () => {
	const binaryData = stringToUint8Array("Test message");
	for (let i = 0; i < 10; i++) {
		const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryProfile);
		const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryProfile);
		assert.deepStrictEqual(decrypted, binaryData);
	}
});

test("fiseBinaryEncrypt - different binary data produces different envelopes", () => {
	const data1 = stringToUint8Array("Hello");
	const data2 = stringToUint8Array("World");

	const encrypted1 = fiseBinaryEncrypt(data1, defaultBinaryProfile);
	const encrypted2 = fiseBinaryEncrypt(data2, defaultBinaryProfile);

	assert.ok(!arraysEqual(encrypted1, encrypted2));
});

test("fiseBinaryEncrypt - binary profiles remain representation-specific", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryProfile);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryProfile);

	assert.deepStrictEqual(decrypted, binaryData);
	assert.throws(
		() => fiseBinaryEncrypt(binaryData, defaultStringProfile),
		{ code: "INVALID_PROFILE" }
	);
});

test("fiseBinaryDecrypt - error: tampered encoded length marker", () => {
	const binaryData = stringToUint8Array("Tamper me");
	const fixedSaltProfile = defineBinaryProfile({
		...defaultBinaryProfile,
		id: "test.binary.fixed-salt",
		layout: { ...defaultBinaryProfile.layout, saltRange: { min: 5, max: 5 } }
	});
	const timestamp = 0;

	const encrypted = fiseBinaryEncrypt(binaryData, fixedSaltProfile, { timestamp });

	const saltLen = 5;
	const profileLength = encrypted[6];
	const bodyStart = 13 + profileLength;
	const cipherTextLen = new DataView(
		encrypted.buffer,
		encrypted.byteOffset,
		encrypted.byteLength
	).getUint32(9, false);
	const offset = fixedSaltProfile.layout.offset(
		{ transformedLength: cipherTextLen, saltLength: saltLen },
		{ timestamp }
	);

	const tamperedEnvelope = new Uint8Array(encrypted.length);
	tamperedEnvelope.set(encrypted);

	// Flip one byte inside the encoded length marker
	tamperedEnvelope[bodyStart + offset] = tamperedEnvelope[bodyStart + offset] ^ 0xff;

	assert.throws(
		() => {
			fiseBinaryDecrypt(tamperedEnvelope, fixedSaltProfile, { timestamp });
		},
		{ code: "MARKER_MISMATCH" }
	);
});

test("fiseBinaryDecrypt - error: invalid envelope (too short)", () => {
	const invalidEnvelope = new Uint8Array([1, 2, 3]);
	assert.throws(
		() => {
			fiseBinaryDecrypt(invalidEnvelope, defaultBinaryProfile);
		},
		{ code: "INVALID_ENVELOPE" }
	);
});

test("fiseBinaryDecrypt - error: invalid envelope (random bytes)", () => {
	const invalidEnvelope = new Uint8Array(100);
	for (let i = 0; i < 100; i++) {
		invalidEnvelope[i] = Math.floor(Math.random() * 256);
	}
	assert.throws(
		() => {
			fiseBinaryDecrypt(invalidEnvelope, defaultBinaryProfile);
		},
		{ code: "INVALID_ENVELOPE" }
	);
});

test("fiseBinaryDecrypt - error: mismatched timestamp", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryProfile, {
		timestamp: 100
	});

	assert.throws(
		() => {
			fiseBinaryDecrypt(encrypted, defaultBinaryProfile, {
				timestamp: 200 // Different timestamp
			});
		},
		{ code: "MARKER_MISMATCH" }
	);
});

test("fiseBinaryDecrypt - error: mismatched profile context", () => {
	const binaryData = stringToUint8Array("Hello, world!");

	const metadataProfile = defineBinaryProfile({
		...defaultBinaryProfile,
		id: "test.binary.context",
		context: {
			metadata: { productId: { type: "number", required: true } }
		},
		layout: {
			...defaultBinaryProfile.layout,
			offset(input, ctx) {
				const productId = Number(ctx.metadata?.productId ?? 0);
				const len = input.transformedLength || 1;
				return (len * 7 + (productId % 5)) % len;
			}
		}
	});

	const encrypted = fiseBinaryEncrypt(binaryData, metadataProfile, {
		metadata: { productId: 123 }
	});

	assert.throws(
		() => {
			fiseBinaryDecrypt(encrypted, metadataProfile, {
				metadata: { productId: 456 } // Different metadata
			});
		},
		{ code: "MARKER_MISMATCH" }
	);
});

test("fiseBinaryEncrypt - function names are consistent", () => {
	const binaryData = stringToUint8Array("Hello, world!");

	// Test that function names match exports
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryProfile);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryProfile);

	assert.deepStrictEqual(decrypted, binaryData);
	assert.ok(typeof fiseBinaryEncrypt === 'function');
	assert.ok(typeof fiseBinaryDecrypt === 'function');
});

test("fiseBinaryEncrypt - image-like data (PNG header)", () => {
	// PNG file signature: 89 50 4E 47 0D 0A 1A 0A
	const pngHeader = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
	const encrypted = fiseBinaryEncrypt(pngHeader, defaultBinaryProfile);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryProfile);

	assert.deepStrictEqual(decrypted, pngHeader);
});

test("fiseBinaryEncrypt - UTF-8 encoded text", () => {
	const texts = [
		"Hello 世界",
		"🌍🌎🌏",
		"Привет",
		"مرحبا",
		"こんにちは"
	];

	for (const text of texts) {
		const binaryData = stringToUint8Array(text);
		const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryProfile);
		const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryProfile);
		const decoded = new TextDecoder().decode(decrypted);

		assert.strictEqual(decoded, text);
	}
});

test("fiseBinaryEncrypt - envelope structure verification", () => {
	const binaryData = stringToUint8Array("Test");
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryProfile);

	// Envelope should be larger than input (contains salt + encoded length)
	assert.ok(encrypted.length > binaryData.length);

	// Should be valid Uint8Array
	assert.ok(encrypted instanceof Uint8Array);

	// Should be decryptable
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryProfile);
	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - very small data (1 byte)", () => {
	const binaryData = new Uint8Array([42]);
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryProfile);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryProfile);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - very large data (1MB)", () => {
	const binaryData = new Uint8Array(1024 * 1024); // 1MB
	for (let i = 0; i < binaryData.length; i++) {
		binaryData[i] = i % 256;
	}
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryProfile);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryProfile);

	assert.deepStrictEqual(decrypted, binaryData);
});

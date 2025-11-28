import { test } from "node:test";
import assert from "node:assert";
import { encryptBinaryFise, decryptBinaryFise, xorBinaryCipher, defaultBinaryRules, defaultRules } from "../dist/index.js";

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

test("encryptBinaryFise - basic encryption", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const encrypted = encryptBinaryFise(binaryData, xorBinaryCipher, defaultBinaryRules);

	assert.ok(encrypted instanceof Uint8Array);
	assert.ok(encrypted.length > binaryData.length);
	assert.ok(!arraysEqual(encrypted, binaryData));
});

test("encryptBinaryFise - roundtrip encryption/decryption", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const encrypted = encryptBinaryFise(binaryData, xorBinaryCipher, defaultBinaryRules);
	const decrypted = decryptBinaryFise(encrypted, xorBinaryCipher, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("encryptBinaryFise - different inputs produce different outputs", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const encrypted1 = encryptBinaryFise(binaryData, xorBinaryCipher, defaultBinaryRules);
	const encrypted2 = encryptBinaryFise(binaryData, xorBinaryCipher, defaultBinaryRules);

	// Due to random salt, outputs should be different
	assert.ok(!arraysEqual(encrypted1, encrypted2));
});

test("encryptBinaryFise - empty binary data", () => {
	const binaryData = new Uint8Array([]);
	const encrypted = encryptBinaryFise(binaryData, xorBinaryCipher, defaultBinaryRules);
	const decrypted = decryptBinaryFise(encrypted, xorBinaryCipher, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
	assert.strictEqual(decrypted.length, 0);
});

test("encryptBinaryFise - single byte", () => {
	const binaryData = new Uint8Array([65]); // 'A'
	const encrypted = encryptBinaryFise(binaryData, xorBinaryCipher, defaultBinaryRules);
	const decrypted = decryptBinaryFise(encrypted, xorBinaryCipher, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("encryptBinaryFise - large binary data", () => {
	const binaryData = new Uint8Array(10000);
	for (let i = 0; i < 10000; i++) {
		binaryData[i] = i % 256;
	}
	const encrypted = encryptBinaryFise(binaryData, xorBinaryCipher, defaultBinaryRules);
	const decrypted = decryptBinaryFise(encrypted, xorBinaryCipher, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("encryptBinaryFise - video-like data (random bytes)", () => {
	// Simulate video data: large array with random bytes
	const binaryData = new Uint8Array(50000);
	for (let i = 0; i < 50000; i++) {
		binaryData[i] = Math.floor(Math.random() * 256);
	}
	const encrypted = encryptBinaryFise(binaryData, xorBinaryCipher, defaultBinaryRules);
	const decrypted = decryptBinaryFise(encrypted, xorBinaryCipher, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("encryptBinaryFise - all zero bytes", () => {
	const binaryData = new Uint8Array(100).fill(0);
	const encrypted = encryptBinaryFise(binaryData, xorBinaryCipher, defaultBinaryRules);
	const decrypted = decryptBinaryFise(encrypted, xorBinaryCipher, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("encryptBinaryFise - all 255 bytes", () => {
	const binaryData = new Uint8Array(100).fill(255);
	const encrypted = encryptBinaryFise(binaryData, xorBinaryCipher, defaultBinaryRules);
	const decrypted = decryptBinaryFise(encrypted, xorBinaryCipher, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("encryptBinaryFise - preserves all byte values (0-255)", () => {
	// Test all possible byte values
	const binaryData = new Uint8Array(256);
	for (let i = 0; i < 256; i++) {
		binaryData[i] = i;
	}
	const encrypted = encryptBinaryFise(binaryData, xorBinaryCipher, defaultBinaryRules);
	const decrypted = decryptBinaryFise(encrypted, xorBinaryCipher, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("encryptBinaryFise - with timestamp option", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const timestamp = 12345;
	const encrypted = encryptBinaryFise(binaryData, xorBinaryCipher, defaultBinaryRules, {
		timestamp
	});
	const decrypted = decryptBinaryFise(encrypted, xorBinaryCipher, defaultBinaryRules, {
		timestamp
	});

	assert.deepStrictEqual(decrypted, binaryData);
});

test("encryptBinaryFise - with metadata option", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const metadata = { productId: 123, userId: 456 };
	const encrypted = encryptBinaryFise(binaryData, xorBinaryCipher, defaultBinaryRules, {
		metadata
	});
	const decrypted = decryptBinaryFise(encrypted, xorBinaryCipher, defaultBinaryRules, {
		metadata
	});

	assert.deepStrictEqual(decrypted, binaryData);
});

test("encryptBinaryFise - with timestamp and metadata", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const timestamp = 12345;
	const metadata = { productId: 123 };
	const encrypted = encryptBinaryFise(binaryData, xorBinaryCipher, defaultBinaryRules, {
		timestamp,
		metadata
	});
	const decrypted = decryptBinaryFise(encrypted, xorBinaryCipher, defaultBinaryRules, {
		timestamp,
		metadata
	});

	assert.deepStrictEqual(decrypted, binaryData);
});

test("encryptBinaryFise - with custom salt length range", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const customRules = {
		...defaultBinaryRules,
		saltRange: { min: 15, max: 20 }
	};
	const encrypted = encryptBinaryFise(binaryData, xorBinaryCipher, customRules);
	const decrypted = decryptBinaryFise(encrypted, xorBinaryCipher, customRules);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("encryptBinaryFise - multiple roundtrips with same input", () => {
	const binaryData = stringToUint8Array("Test message");
	for (let i = 0; i < 10; i++) {
		const encrypted = encryptBinaryFise(binaryData, xorBinaryCipher, defaultBinaryRules);
		const decrypted = decryptBinaryFise(encrypted, xorBinaryCipher, defaultBinaryRules);
		assert.deepStrictEqual(decrypted, binaryData);
	}
});

test("encryptBinaryFise - different binary data produces different envelopes", () => {
	const data1 = stringToUint8Array("Hello");
	const data2 = stringToUint8Array("World");

	const encrypted1 = encryptBinaryFise(data1, xorBinaryCipher, defaultBinaryRules);
	const encrypted2 = encryptBinaryFise(data2, xorBinaryCipher, defaultBinaryRules);

	assert.ok(!arraysEqual(encrypted1, encrypted2));
});

test("encryptBinaryFise - shared rules with string encryption", () => {
	// Test that binary rules can be used (they're compatible)
	const binaryData = stringToUint8Array("Hello, world!");
	const encrypted = encryptBinaryFise(binaryData, xorBinaryCipher, defaultBinaryRules);
	const decrypted = decryptBinaryFise(encrypted, xorBinaryCipher, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("encryptBinaryFise - text-based rules adaptation", () => {
	// Test that text-based rules can be adapted for binary
	const binaryData = stringToUint8Array("Hello, world!");
	const encrypted = encryptBinaryFise(binaryData, xorBinaryCipher, defaultRules);
	const decrypted = decryptBinaryFise(encrypted, xorBinaryCipher, defaultRules);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("decryptBinaryFise - error: invalid envelope (too short)", () => {
	const invalidEnvelope = new Uint8Array([1, 2, 3]);
	assert.throws(
		() => {
			decryptBinaryFise(invalidEnvelope, xorBinaryCipher, defaultBinaryRules);
		},
		{
			message: /FISE: cannot/
		}
	);
});

test("decryptBinaryFise - error: invalid envelope (random bytes)", () => {
	const invalidEnvelope = new Uint8Array(100);
	for (let i = 0; i < 100; i++) {
		invalidEnvelope[i] = Math.floor(Math.random() * 256);
	}
	assert.throws(
		() => {
			decryptBinaryFise(invalidEnvelope, xorBinaryCipher, defaultBinaryRules);
		},
		{
			message: /FISE: cannot/
		}
	);
});

test("decryptBinaryFise - error: mismatched timestamp", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const encrypted = encryptBinaryFise(binaryData, xorBinaryCipher, defaultBinaryRules, {
		timestamp: 100
	});

	assert.throws(
		() => {
			decryptBinaryFise(encrypted, xorBinaryCipher, defaultBinaryRules, {
				timestamp: 200 // Different timestamp
			});
		},
		{
			message: /FISE: cannot/
		}
	);
});

test("decryptBinaryFise - error: mismatched metadata", () => {
	// Note: Metadata only affects decryption if the rules use it in offset/encodeLength/decodeLength
	// For defaultBinaryRules, metadata doesn't affect the calculation, so mismatched metadata
	// might not cause an error. This test verifies the behavior with custom rules that use metadata.
	const binaryData = stringToUint8Array("Hello, world!");
	
	// Create custom rules that use metadata in offset calculation
	const metadataRules = {
		...defaultBinaryRules,
		offset(cipherText, ctx) {
			const productId = ctx.metadata?.productId ?? 0;
			const t = ctx.timestamp ?? 0;
			const len = cipherText.length || 1;
			return (len * 7 + (t % 11) + (productId % 5)) % len;
		}
	};
	
	const encrypted = encryptBinaryFise(binaryData, xorBinaryCipher, metadataRules, {
		metadata: { productId: 123 }
	});

	assert.throws(
		() => {
			decryptBinaryFise(encrypted, xorBinaryCipher, metadataRules, {
				metadata: { productId: 456 } // Different metadata
			});
		},
		{
			message: /FISE: cannot/
		}
	);
});

test("encryptBinaryFise - function names are consistent", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	
	// Test that function names match exports
	const encrypted = encryptBinaryFise(binaryData, xorBinaryCipher, defaultBinaryRules);
	const decrypted = decryptBinaryFise(encrypted, xorBinaryCipher, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
	assert.ok(typeof encryptBinaryFise === 'function');
	assert.ok(typeof decryptBinaryFise === 'function');
});

test("encryptBinaryFise - image-like data (PNG header)", () => {
	// PNG file signature: 89 50 4E 47 0D 0A 1A 0A
	const pngHeader = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
	const encrypted = encryptBinaryFise(pngHeader, xorBinaryCipher, defaultBinaryRules);
	const decrypted = decryptBinaryFise(encrypted, xorBinaryCipher, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, pngHeader);
});

test("encryptBinaryFise - UTF-8 encoded text", () => {
	const texts = [
		"Hello 世界",
		"🌍🌎🌏",
		"Привет",
		"مرحبا",
		"こんにちは"
	];

	for (const text of texts) {
		const binaryData = stringToUint8Array(text);
		const encrypted = encryptBinaryFise(binaryData, xorBinaryCipher, defaultBinaryRules);
		const decrypted = decryptBinaryFise(encrypted, xorBinaryCipher, defaultBinaryRules);
		const decoded = new TextDecoder().decode(decrypted);
		
		assert.strictEqual(decoded, text);
	}
});

test("encryptBinaryFise - envelope structure verification", () => {
	const binaryData = stringToUint8Array("Test");
	const encrypted = encryptBinaryFise(binaryData, xorBinaryCipher, defaultBinaryRules);

	// Envelope should be larger than input (contains salt + encoded length)
	assert.ok(encrypted.length > binaryData.length);
	
	// Should be valid Uint8Array
	assert.ok(encrypted instanceof Uint8Array);
	
	// Should be decryptable
	const decrypted = decryptBinaryFise(encrypted, xorBinaryCipher, defaultBinaryRules);
	assert.deepStrictEqual(decrypted, binaryData);
});

test("encryptBinaryFise - very small data (1 byte)", () => {
	const binaryData = new Uint8Array([42]);
	const encrypted = encryptBinaryFise(binaryData, xorBinaryCipher, defaultBinaryRules);
	const decrypted = decryptBinaryFise(encrypted, xorBinaryCipher, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("encryptBinaryFise - very large data (1MB)", () => {
	const binaryData = new Uint8Array(1024 * 1024); // 1MB
	for (let i = 0; i < binaryData.length; i++) {
		binaryData[i] = i % 256;
	}
	const encrypted = encryptBinaryFise(binaryData, xorBinaryCipher, defaultBinaryRules);
	const decrypted = decryptBinaryFise(encrypted, xorBinaryCipher, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
});


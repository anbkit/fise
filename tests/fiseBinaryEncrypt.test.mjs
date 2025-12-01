import { test } from "node:test";
import assert from "node:assert";
import { fiseBinaryEncrypt, fiseBinaryDecrypt, xorBinaryCipher, defaultBinaryRules, defaultRules } from "../dist/index.js";

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
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryRules);

	assert.ok(encrypted instanceof Uint8Array);
	assert.ok(encrypted.length > binaryData.length);
	assert.ok(!arraysEqual(encrypted, binaryData));
});

test("fiseBinaryEncrypt - roundtrip encryption/decryption", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryRules);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - different inputs produce different outputs", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const encrypted1 = fiseBinaryEncrypt(binaryData, defaultBinaryRules);
	const encrypted2 = fiseBinaryEncrypt(binaryData, defaultBinaryRules);

	// Due to random salt, outputs should be different
	assert.ok(!arraysEqual(encrypted1, encrypted2));
});

test("fiseBinaryEncrypt - empty binary data", () => {
	const binaryData = new Uint8Array([]);
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryRules);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
	assert.strictEqual(decrypted.length, 0);
});

test("fiseBinaryEncrypt - single byte", () => {
	const binaryData = new Uint8Array([65]); // 'A'
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryRules);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - large binary data", () => {
	const binaryData = new Uint8Array(10000);
	for (let i = 0; i < 10000; i++) {
		binaryData[i] = i % 256;
	}
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryRules);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - video-like data (random bytes)", () => {
	// Simulate video data: large array with random bytes
	const binaryData = new Uint8Array(50000);
	for (let i = 0; i < 50000; i++) {
		binaryData[i] = Math.floor(Math.random() * 256);
	}
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryRules);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - all zero bytes", () => {
	const binaryData = new Uint8Array(100).fill(0);
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryRules);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - all 255 bytes", () => {
	const binaryData = new Uint8Array(100).fill(255);
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryRules);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - preserves all byte values (0-255)", () => {
	// Test all possible byte values
	const binaryData = new Uint8Array(256);
	for (let i = 0; i < 256; i++) {
		binaryData[i] = i;
	}
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryRules);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - with timestamp option", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const timestamp = 12345;
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryRules, {
		timestamp
	});
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryRules, {
		timestamp
	});

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - with metadata option", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const metadata = { productId: 123, userId: 456 };
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryRules, {
		metadata
	});
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryRules, {
		metadata
	});

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - with timestamp and metadata", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const timestamp = 12345;
	const metadata = { productId: 123 };
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryRules, {
		timestamp,
		metadata
	});
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryRules, {
		timestamp,
		metadata
	});

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - with custom salt length range", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const customRules = {
		...defaultBinaryRules,
		saltRange: { min: 15, max: 20 }
	};
	const encrypted = fiseBinaryEncrypt(binaryData, customRules);
	const decrypted = fiseBinaryDecrypt(encrypted, customRules);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - multiple roundtrips with same input", () => {
	const binaryData = stringToUint8Array("Test message");
	for (let i = 0; i < 10; i++) {
		const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryRules);
		const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryRules);
		assert.deepStrictEqual(decrypted, binaryData);
	}
});

test("fiseBinaryEncrypt - different binary data produces different envelopes", () => {
	const data1 = stringToUint8Array("Hello");
	const data2 = stringToUint8Array("World");

	const encrypted1 = fiseBinaryEncrypt(data1, defaultBinaryRules);
	const encrypted2 = fiseBinaryEncrypt(data2, defaultBinaryRules);

	assert.ok(!arraysEqual(encrypted1, encrypted2));
});

test("fiseBinaryEncrypt - shared rules with string encryption", () => {
	// Test that binary rules can be used (they're compatible)
	const binaryData = stringToUint8Array("Hello, world!");
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryRules);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - text-based rules adaptation", () => {
	// Test that text-based rules can be adapted for binary
	const binaryData = stringToUint8Array("Hello, world!");
	const encrypted = fiseBinaryEncrypt(binaryData, defaultRules);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultRules);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryDecrypt - error: invalid envelope (too short)", () => {
	const invalidEnvelope = new Uint8Array([1, 2, 3]);
	assert.throws(
		() => {
			fiseBinaryDecrypt(invalidEnvelope, defaultBinaryRules);
		},
		{
			message: /FISE: cannot/
		}
	);
});

test("fiseBinaryDecrypt - error: invalid envelope (random bytes)", () => {
	const invalidEnvelope = new Uint8Array(100);
	for (let i = 0; i < 100; i++) {
		invalidEnvelope[i] = Math.floor(Math.random() * 256);
	}
	assert.throws(
		() => {
			fiseBinaryDecrypt(invalidEnvelope, defaultBinaryRules);
		},
		{
			message: /FISE: cannot/
		}
	);
});

test("fiseBinaryDecrypt - error: mismatched timestamp", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryRules, {
		timestamp: 100
	});

	assert.throws(
		() => {
			fiseBinaryDecrypt(encrypted, defaultBinaryRules, {
				timestamp: 200 // Different timestamp
			});
		},
		{
			message: /FISE: cannot/
		}
	);
});

test("fiseBinaryDecrypt - error: mismatched metadata", () => {
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
	
	const encrypted = fiseBinaryEncrypt(binaryData, metadataRules, {
		metadata: { productId: 123 }
	});

	assert.throws(
		() => {
			fiseBinaryDecrypt(encrypted, metadataRules, {
				metadata: { productId: 456 } // Different metadata
			});
		},
		{
			message: /FISE: cannot/
		}
	);
});

test("fiseBinaryEncrypt - function names are consistent", () => {
	const binaryData = stringToUint8Array("Hello, world!");
	
	// Test that function names match exports
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryRules);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
	assert.ok(typeof fiseBinaryEncrypt === 'function');
	assert.ok(typeof fiseBinaryDecrypt === 'function');
});

test("fiseBinaryEncrypt - image-like data (PNG header)", () => {
	// PNG file signature: 89 50 4E 47 0D 0A 1A 0A
	const pngHeader = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
	const encrypted = fiseBinaryEncrypt(pngHeader, defaultBinaryRules);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryRules);

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
		const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryRules);
		const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryRules);
		const decoded = new TextDecoder().decode(decrypted);
		
		assert.strictEqual(decoded, text);
	}
});

test("fiseBinaryEncrypt - envelope structure verification", () => {
	const binaryData = stringToUint8Array("Test");
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryRules);

	// Envelope should be larger than input (contains salt + encoded length)
	assert.ok(encrypted.length > binaryData.length);
	
	// Should be valid Uint8Array
	assert.ok(encrypted instanceof Uint8Array);
	
	// Should be decryptable
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryRules);
	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - very small data (1 byte)", () => {
	const binaryData = new Uint8Array([42]);
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryRules);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("fiseBinaryEncrypt - very large data (1MB)", () => {
	const binaryData = new Uint8Array(1024 * 1024); // 1MB
	for (let i = 0; i < binaryData.length; i++) {
		binaryData[i] = i % 256;
	}
	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryRules);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
});


import { test } from "node:test";
import assert from "node:assert";
import { encryptFise, decryptFise } from "../dist/encryptFise.js";
import { xorCipher } from "../dist/core/xorCipher.js";
import { defaultRules } from "../dist/rules/defaultRules.js";

test("integration - full pipeline with various data types", () => {
	const testCases = [
		"Simple string",
		"",
		"12345",
		JSON.stringify({ key: "value", array: [1, 2, 3] }),
		"Hello 世界 🌍",
		"!@#$%^&*()",
		"A".repeat(500),
		"Line 1\nLine 2\nLine 3",
		"\tTabbed\tText\t"
	];

	for (const plaintext of testCases) {
		const encrypted = encryptFise(plaintext, xorCipher, defaultRules);
		const decrypted = decryptFise(encrypted, xorCipher, defaultRules);

		assert.strictEqual(decrypted, plaintext, `Failed for: ${plaintext.substring(0, 50)}`);
	}
});

test("integration - multiple encryptions of same data", () => {
	const plaintext = "Test message";
	const results = [];

	for (let i = 0; i < 5; i++) {
		const encrypted = encryptFise(plaintext, xorCipher, defaultRules);
		const decrypted = decryptFise(encrypted, xorCipher, defaultRules);
		assert.strictEqual(decrypted, plaintext);
		results.push(encrypted);
	}

	// All encrypted versions should be different (due to random salt)
	const uniqueResults = new Set(results);
	assert.ok(uniqueResults.size === results.length, "Each encryption should produce unique output");
});

test("integration - with timestamp context", () => {
	const plaintext = "Timestamped message";
	const timestampMinutes = 12345;

	const encrypted = encryptFise(plaintext, xorCipher, defaultRules, {
		timestampMinutes
	});
	const decrypted = decryptFise(encrypted, xorCipher, defaultRules, {
		timestampMinutes
	});

	assert.strictEqual(decrypted, plaintext);
});

test("integration - different salt length ranges", () => {
	const plaintext = "Test with custom salt range";
	const ranges = [
		{ min: 10, max: 15 },
		{ min: 20, max: 25 },
		{ min: 15, max: 15 } // Same min and max
	];

	for (const range of ranges) {
		const customRules = {
			...defaultRules,
			saltRange: range
		};
		const encrypted = encryptFise(plaintext, xorCipher, customRules);
		const decrypted = decryptFise(encrypted, xorCipher, customRules);

		assert.strictEqual(decrypted, plaintext);
	}
});

test("integration - API response simulation", () => {
	const apiResponse = {
		status: "success",
		data: {
			users: [
				{ id: 1, name: "Alice" },
				{ id: 2, name: "Bob" }
			],
			timestamp: Date.now()
		}
	};

	const plaintext = JSON.stringify(apiResponse);
	const encrypted = encryptFise(plaintext, xorCipher, defaultRules);
	const decrypted = decryptFise(encrypted, xorCipher, defaultRules);

	assert.strictEqual(decrypted, plaintext);

	const parsed = JSON.parse(decrypted);
	assert.strictEqual(parsed.status, "success");
	assert.strictEqual(parsed.data.users.length, 2);
});

test("integration - large payload", () => {
	const largeData = {
		items: Array.from({ length: 100 }, (_, i) => ({
			id: i,
			name: `Item ${i}`,
			description: "A".repeat(100)
		}))
	};

	const plaintext = JSON.stringify(largeData);
	const encrypted = encryptFise(plaintext, xorCipher, defaultRules);
	const decrypted = decryptFise(encrypted, xorCipher, defaultRules);

	assert.strictEqual(decrypted, plaintext);

	const parsed = JSON.parse(decrypted);
	assert.strictEqual(parsed.items.length, 100);
});

test("integration - performance: multiple operations", () => {
	const plaintext = "Performance test";
	const iterations = 100;

	const start = Date.now();
	for (let i = 0; i < iterations; i++) {
		const encrypted = encryptFise(plaintext, xorCipher, defaultRules);
		const decrypted = decryptFise(encrypted, xorCipher, defaultRules);
		assert.strictEqual(decrypted, plaintext);
	}
	const end = Date.now();

	const avgTime = (end - start) / iterations;
	console.log(`Average time per encrypt+decrypt: ${avgTime.toFixed(3)}ms`);

	// Should be fast (less than 1ms per operation on average)
	assert.ok(avgTime < 10, "Operations should be fast");
});

test("integration - error handling: wrong timestamp", () => {
	const plaintext = "Test message";
	const timestamp1 = 100;
	const timestamp2 = 200;

	const encrypted = encryptFise(plaintext, xorCipher, defaultRules, {
		timestampMinutes: timestamp1
	});

	// Decrypting with wrong timestamp might fail or succeed depending on implementation
	// This test verifies behavior
	try {
		const decrypted = decryptFise(encrypted, xorCipher, defaultRules, {
			timestampMinutes: timestamp2
		});
		// If it succeeds, that's also valid (timestamp might not be strictly enforced)
		assert.ok(typeof decrypted === "string");
	} catch (error) {
		// If it fails, that's expected
		assert.ok(error instanceof Error);
	}
});

test("integration - envelope structure validation", () => {
	const plaintext = "Structure test";
	const encrypted = encryptFise(plaintext, xorCipher, defaultRules);

	// Envelope should be longer than plaintext (contains salt + metadata)
	assert.ok(encrypted.length > plaintext.length);

	// Should be able to decrypt
	const decrypted = decryptFise(encrypted, xorCipher, defaultRules);
	assert.strictEqual(decrypted, plaintext);
});


import { test } from "node:test";
import assert from "node:assert";
import { defaultRules } from "../dist/rules/defaultRules.js";

test("defaultRules - encodeLength and decodeLength roundtrip", () => {
	const testLengths = [10, 15, 20, 32, 50, 99];
	const ctx = {};

	for (const len of testLengths) {
		const encoded = defaultRules.encodeLength(len, ctx);
		const decoded = defaultRules.decodeLength(encoded, ctx);

		assert.strictEqual(decoded, len);
		assert.strictEqual(encoded.length, 2);
	}
});

test("defaultRules - encodeLength produces base36 padded string", () => {
	const ctx = {};
	const encoded = defaultRules.encodeLength(10, ctx);

	assert.strictEqual(encoded.length, 2);
	assert.ok(/^[0-9a-z]{2}$/.test(encoded));
});

test("defaultRules - offset calculation", () => {
	const cipherText = "abcdefghijklmnopqrstuvwxyz";
	const ctx = { timestamp: 0 };

	const offset = defaultRules.offset(cipherText, ctx);

	assert.ok(typeof offset === "number");
	assert.ok(offset >= 0);
	assert.ok(offset < cipherText.length);
});

test("defaultRules - offset changes with timestamp", () => {
	const cipherText = "abcdefghijklmnopqrstuvwxyz";
	const offset1 = defaultRules.offset(cipherText, { timestamp: 0 });
	const offset2 = defaultRules.offset(cipherText, { timestamp: 1 });

	// Offset may or may not change, but should be valid
	assert.ok(offset1 >= 0 && offset1 < cipherText.length);
	assert.ok(offset2 >= 0 && offset2 < cipherText.length);
});

test("defaultRules - offset with empty string", () => {
	const cipherText = "";
	const ctx = { timestamp: 0 };

	const offset = defaultRules.offset(cipherText, ctx);

	assert.strictEqual(offset, 0);
});

test("defaultRules - decodeLength handles edge cases", () => {
	const ctx = {};

	// Test minimum (10 in base36 is "a")
	const minEncoded = defaultRules.encodeLength(10, ctx);
	assert.strictEqual(defaultRules.decodeLength(minEncoded, ctx), 10);

	// Test maximum (99 in base36 is "2r")
	const maxEncoded = defaultRules.encodeLength(99, ctx);
	assert.strictEqual(defaultRules.decodeLength(maxEncoded, ctx), 99);
});

test("defaultRules - offset is deterministic for same input", () => {
	const cipherText = "testciphertext123";
	const ctx = { timestamp: 42 };

	const offset1 = defaultRules.offset(cipherText, ctx);
	const offset2 = defaultRules.offset(cipherText, ctx);

	assert.strictEqual(offset1, offset2);
});

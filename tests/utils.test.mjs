import { test } from "node:test";
import assert from "node:assert";
import {
	fromBase64,
	randomIntegerInclusive,
	randomSalt,
	randomSaltBinary,
	toBase64
} from "../dist/core/utils.js";

test("randomSalt - generates string of correct length", () => {
	const len = 20;
	const salt = randomSalt(len);

	assert.strictEqual(salt.length, len);
	assert.ok(typeof salt === "string");
});

test("randomSalt - different calls produce different results", () => {
	const len = 20;
	const salts = Array.from({ length: 5 }, () => randomSalt(len));

	for (const salt of salts) {
		assert.strictEqual(salt.length, len);
	}
	assert.ok(
		new Set(salts).size > 1,
		"Random salts should not all be identical"
	);
});

test("randomSalt - uses alphanumeric characters", () => {
	const len = 100;
	const salt = randomSalt(len);

	// Should only contain a-z, A-Z, 0-9
	const alphanumericRegex = /^[a-zA-Z0-9]+$/;
	assert.ok(alphanumericRegex.test(salt), "Salt should only contain alphanumeric characters");
});

test("randomSalt - various lengths", () => {
	const lengths = [1, 10, 20, 50, 100];

	for (const len of lengths) {
		const salt = randomSalt(len);
		assert.strictEqual(salt.length, len);
	}
});

test("randomSaltBinary - supports Web Crypto chunk boundaries", () => {
	const salt = randomSaltBinary(70_000);
	assert.ok(salt instanceof Uint8Array);
	assert.strictEqual(salt.length, 70_000);
});

test("random salt helpers reject invalid lengths", () => {
	assert.throws(() => randomSalt(-1), { code: "INVALID_SALT" });
	assert.throws(() => randomSaltBinary(1.5), { code: "INVALID_SALT" });
	assert.throws(() => randomSalt(Number.MAX_SAFE_INTEGER), { code: "INVALID_SALT" });
	assert.throws(() => randomSaltBinary(Number.MAX_SAFE_INTEGER), { code: "INVALID_SALT" });
});

test("randomIntegerInclusive - stays inside the inclusive range", () => {
	assert.strictEqual(randomIntegerInclusive(7, 7), 7);
	for (let index = 0; index < 100; index++) {
		const value = randomIntegerInclusive(10, 99);
		assert.ok(value >= 10 && value <= 99);
	}
	assert.throws(() => randomIntegerInclusive(20, 10), { code: "INVALID_PROFILE" });
});

test("toBase64 and fromBase64 - roundtrip", () => {
	const original = "Hello, world!";
	const encoded = toBase64(original);
	const decoded = fromBase64(encoded);

	assert.strictEqual(decoded, original);
});

test("toBase64 and fromBase64 - empty string", () => {
	const original = "";
	const encoded = toBase64(original);
	const decoded = fromBase64(encoded);

	assert.strictEqual(decoded, original);
});

test("toBase64 and fromBase64 - unicode characters", () => {
	const original = "Hello 世界 🌍";
	const encoded = toBase64(original);
	const decoded = fromBase64(encoded);

	// Note: btoa/atob in browser may not handle unicode perfectly
	// but Buffer-based implementation should work
	assert.strictEqual(decoded, original);
});

test("toBase64 and fromBase64 - special characters", () => {
	const original = "!@#$%^&*()_+-=[]{}|;':\",./<>?";
	const encoded = toBase64(original);
	const decoded = fromBase64(encoded);

	assert.strictEqual(decoded, original);
});

test("toBase64 and fromBase64 - multiline string", () => {
	const original = "Line 1\nLine 2\nLine 3";
	const encoded = toBase64(original);
	const decoded = fromBase64(encoded);

	assert.strictEqual(decoded, original);
});

test("toBase64 and fromBase64 - long string", () => {
	const original = "A".repeat(1000);
	const encoded = toBase64(original);
	const decoded = fromBase64(encoded);

	assert.strictEqual(decoded, original);
});

test("toBase64 - produces valid base64", () => {
	const original = "Hello, world!";
	const encoded = toBase64(original);

	// Base64 strings should only contain A-Z, a-z, 0-9, +, /, and = for padding
	const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
	assert.ok(base64Regex.test(encoded), "Encoded output should be valid base64");
});

test("toBase64 and fromBase64 - JSON data", () => {
	const original = JSON.stringify({ name: "FISE", version: "0.1.0", data: [1, 2, 3] });
	const encoded = toBase64(original);
	const decoded = fromBase64(encoded);

	assert.strictEqual(decoded, original);
	const parsed = JSON.parse(decoded);
	assert.strictEqual(parsed.name, "FISE");
});

test("fromBase64 rejects non-canonical or invalid UTF-8 input", () => {
	assert.throws(() => fromBase64("not base64"), { code: "INVALID_CIPHERTEXT" });
	assert.throws(() => fromBase64("/w=="), { code: "INVALID_CIPHERTEXT" });
});

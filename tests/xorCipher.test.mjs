import { test } from "node:test";
import assert from "node:assert";
import { xorCipher } from "../dist/core/xorCipher.js";

test("xorCipher - basic encrypt/decrypt roundtrip", () => {
	const plaintext = "Hello, world!";
	const salt = "mysalt123";

	const encrypted = xorCipher.encrypt(plaintext, salt);
	const decrypted = xorCipher.decrypt(encrypted, salt);

	assert.strictEqual(decrypted, plaintext);
});

test("xorCipher - encrypt produces different output", () => {
	const plaintext = "Hello, world!";
	const salt = "mysalt123";

	const encrypted = xorCipher.encrypt(plaintext, salt);

	assert.ok(encrypted !== plaintext);
	assert.ok(typeof encrypted === "string");
});

test("xorCipher - same input with same salt produces same output", () => {
	const plaintext = "Hello, world!";
	const salt = "mysalt123";

	const encrypted1 = xorCipher.encrypt(plaintext, salt);
	const encrypted2 = xorCipher.encrypt(plaintext, salt);

	assert.strictEqual(encrypted1, encrypted2);
});

test("xorCipher - different salt produces different output", () => {
	const plaintext = "Hello, world!";
	const salt1 = "salt1";
	const salt2 = "salt2";

	const encrypted1 = xorCipher.encrypt(plaintext, salt1);
	const encrypted2 = xorCipher.encrypt(plaintext, salt2);

	assert.ok(encrypted1 !== encrypted2);
});

test("xorCipher - empty string", () => {
	const plaintext = "";
	const salt = "mysalt123";

	const encrypted = xorCipher.encrypt(plaintext, salt);
	const decrypted = xorCipher.decrypt(encrypted, salt);

	assert.strictEqual(decrypted, plaintext);
});

test("xorCipher - rejects an empty salt for non-empty input", () => {
	assert.throws(
		() => xorCipher.encrypt("a", ""),
		/FISE: string XOR salt must not be empty/
	);
	assert.throws(
		() => xorCipher.decrypt("YQ==", ""),
		/FISE: string XOR salt must not be empty/
	);
});

test("xorCipher - long string", () => {
	const plaintext = "A".repeat(1000);
	const salt = "mysalt123";

	const encrypted = xorCipher.encrypt(plaintext, salt);
	const decrypted = xorCipher.decrypt(encrypted, salt);

	assert.strictEqual(decrypted, plaintext);
});

test("xorCipher - salt shorter than plaintext (wraps around)", () => {
	const plaintext = "Hello, world! This is a longer message.";
	const salt = "abc";

	const encrypted = xorCipher.encrypt(plaintext, salt);
	const decrypted = xorCipher.decrypt(encrypted, salt);

	assert.strictEqual(decrypted, plaintext);
});

test("xorCipher - salt longer than plaintext", () => {
	const plaintext = "Hi";
	const salt = "verylongsalt123456789";

	const encrypted = xorCipher.encrypt(plaintext, salt);
	const decrypted = xorCipher.decrypt(encrypted, salt);

	assert.strictEqual(decrypted, plaintext);
});

test("xorCipher - unicode characters", () => {
	const plaintext = "Hello 世界 🌍";
	const salt = "mysalt123";

	const encrypted = xorCipher.encrypt(plaintext, salt);
	const decrypted = xorCipher.decrypt(encrypted, salt);

	assert.strictEqual(decrypted, plaintext);
});

test("xorCipher - preserves every UTF-16 code unit, including lone surrogates", () => {
	const plaintext = "\u0000\ud800A\udfff\uffff";
	const salt = "\ud801salt";
	const encrypted = xorCipher.encrypt(plaintext, salt);
	assert.strictEqual(xorCipher.decrypt(encrypted, salt), plaintext);
});

test("xorCipher - rejects malformed base64 and incomplete UTF-16 units", () => {
	assert.throws(() => xorCipher.decrypt("not base64", "salt"), {
		code: "INVALID_CIPHERTEXT"
	});
	assert.throws(() => xorCipher.decrypt("AA==", "salt"), {
		code: "INVALID_CIPHERTEXT"
	});
});

test("xorCipher - special characters", () => {
	const plaintext = "!@#$%^&*()_+-=[]{}|;':\",./<>?";
	const salt = "mysalt123";

	const encrypted = xorCipher.encrypt(plaintext, salt);
	const decrypted = xorCipher.decrypt(encrypted, salt);

	assert.strictEqual(decrypted, plaintext);
});

test("xorCipher - single character salt", () => {
	const plaintext = "Hello, world!";
	const salt = "a";

	const encrypted = xorCipher.encrypt(plaintext, salt);
	const decrypted = xorCipher.decrypt(encrypted, salt);

	assert.strictEqual(decrypted, plaintext);
});

test("xorCipher - output is base64 encoded", () => {
	const plaintext = "Hello, world!";
	const salt = "mysalt123";

	const encrypted = xorCipher.encrypt(plaintext, salt);

	// Base64 strings should only contain A-Z, a-z, 0-9, +, /, and = for padding
	const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
	assert.ok(base64Regex.test(encrypted), "Encrypted output should be valid base64");
});

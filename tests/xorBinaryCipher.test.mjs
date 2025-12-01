import { test } from "node:test";
import assert from "node:assert";
import { xorBinaryCipher, randomSaltBinary, fiseBinaryEncrypt, fiseBinaryDecrypt } from "../dist/index.js";
import { defaultBinaryRules } from "../dist/index.js";

// Helper to convert string to Uint8Array
function stringToUint8Array(str) {
	return new TextEncoder().encode(str);
}

test("xorBinaryCipher - basic encrypt/decrypt roundtrip", () => {
	const binaryData = new Uint8Array([72, 101, 108, 108, 111]); // "Hello" in bytes
	const salt = stringToUint8Array("mysalt123");

	const encrypted = xorBinaryCipher.encrypt(binaryData, salt);
	const decrypted = xorBinaryCipher.decrypt(encrypted, salt);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("xorBinaryCipher - encrypt produces different output", () => {
	const binaryData = new Uint8Array([1, 2, 3, 4, 5]);
	const salt = stringToUint8Array("mysalt123");

	const encrypted = xorBinaryCipher.encrypt(binaryData, salt);

	assert.ok(!arraysEqual(encrypted, binaryData));
	assert.ok(encrypted instanceof Uint8Array);
});

test("xorBinaryCipher - same input with same salt produces same output", () => {
	const binaryData = new Uint8Array([10, 20, 30, 40, 50]);
	const salt = stringToUint8Array("mysalt123");

	const encrypted1 = xorBinaryCipher.encrypt(binaryData, salt);
	const encrypted2 = xorBinaryCipher.encrypt(binaryData, salt);

	assert.deepStrictEqual(encrypted1, encrypted2);
});

test("xorBinaryCipher - different salt produces different output", () => {
	const binaryData = new Uint8Array([100, 200, 255, 50, 75, 100, 150, 200]);
	const salt1 = stringToUint8Array("salt1");
	const salt2 = stringToUint8Array("salt2");

	const encrypted1 = xorBinaryCipher.encrypt(binaryData, salt1);
	const encrypted2 = xorBinaryCipher.encrypt(binaryData, salt2);

	assert.ok(!arraysEqual(encrypted1, encrypted2));
});

test("xorBinaryCipher - empty binary data", () => {
	const binaryData = new Uint8Array([]);
	const salt = stringToUint8Array("mysalt123");

	const encrypted = xorBinaryCipher.encrypt(binaryData, salt);
	const decrypted = xorBinaryCipher.decrypt(encrypted, salt);

	assert.deepStrictEqual(decrypted, binaryData);
	assert.strictEqual(decrypted.length, 0);
});

test("xorBinaryCipher - large binary data", () => {
	const binaryData = new Uint8Array(1000);
	for (let i = 0; i < 1000; i++) {
		binaryData[i] = i % 256;
	}
	const salt = stringToUint8Array("mysalt123");

	const encrypted = xorBinaryCipher.encrypt(binaryData, salt);
	const decrypted = xorBinaryCipher.decrypt(encrypted, salt);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("xorBinaryCipher - salt shorter than data (wraps around)", () => {
	const binaryData = new Uint8Array(100);
	for (let i = 0; i < 100; i++) {
		binaryData[i] = i;
	}
	const salt = stringToUint8Array("abc");

	const encrypted = xorBinaryCipher.encrypt(binaryData, salt);
	const decrypted = xorBinaryCipher.decrypt(encrypted, salt);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("xorBinaryCipher - salt longer than data", () => {
	const binaryData = new Uint8Array([1, 2]);
	const salt = stringToUint8Array("verylongsalt123456789");

	const encrypted = xorBinaryCipher.encrypt(binaryData, salt);
	const decrypted = xorBinaryCipher.decrypt(encrypted, salt);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("xorBinaryCipher - all zero bytes", () => {
	const binaryData = new Uint8Array(50).fill(0);
	const salt = stringToUint8Array("mysalt123");

	const encrypted = xorBinaryCipher.encrypt(binaryData, salt);
	const decrypted = xorBinaryCipher.decrypt(encrypted, salt);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("xorBinaryCipher - all 255 bytes", () => {
	const binaryData = new Uint8Array(50).fill(255);
	const salt = stringToUint8Array("mysalt123");

	const encrypted = xorBinaryCipher.encrypt(binaryData, salt);
	const decrypted = xorBinaryCipher.decrypt(encrypted, salt);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("xorBinaryCipher - single byte salt", () => {
	const binaryData = new Uint8Array([1, 2, 3, 4, 5]);
	const salt = stringToUint8Array("a");

	const encrypted = xorBinaryCipher.encrypt(binaryData, salt);
	const decrypted = xorBinaryCipher.decrypt(encrypted, salt);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("xorBinaryCipher - output is binary (Uint8Array)", () => {
	const binaryData = new Uint8Array([72, 101, 108, 108, 111]);
	const salt = stringToUint8Array("mysalt123");

	const encrypted = xorBinaryCipher.encrypt(binaryData, salt);

	assert.ok(encrypted instanceof Uint8Array, "Encrypted output should be Uint8Array");
	assert.strictEqual(encrypted.length, binaryData.length, "Encrypted length should match input length");
});

test("xorBinaryCipher - integration with fiseBinaryEncrypt/fiseBinaryDecrypt", () => {
	const binaryData = new Uint8Array([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100]); // "Hello World"

	const encrypted = fiseBinaryEncrypt(binaryData, defaultBinaryRules);
	const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryRules);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("xorBinaryCipher - video-like binary data (large, random)", () => {
	// Simulate video data: large array with random bytes
	const binaryData = new Uint8Array(10000);
	for (let i = 0; i < 10000; i++) {
		binaryData[i] = Math.floor(Math.random() * 256);
	}
	const salt = stringToUint8Array("mysalt123");

	const encrypted = xorBinaryCipher.encrypt(binaryData, salt);
	const decrypted = xorBinaryCipher.decrypt(encrypted, salt);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("xorBinaryCipher - preserves all byte values (0-255)", () => {
	// Test all possible byte values
	const binaryData = new Uint8Array(256);
	for (let i = 0; i < 256; i++) {
		binaryData[i] = i;
	}
	const salt = stringToUint8Array("mysalt123");

	const encrypted = xorBinaryCipher.encrypt(binaryData, salt);
	const decrypted = xorBinaryCipher.decrypt(encrypted, salt);

	assert.deepStrictEqual(decrypted, binaryData);
});

test("xorBinaryCipher - XOR is symmetric (encrypt = decrypt)", () => {
	const binaryData = new Uint8Array([1, 2, 3, 4, 5]);
	const salt = stringToUint8Array("test");

	const encrypted = xorBinaryCipher.encrypt(binaryData, salt);
	const doubleEncrypted = xorBinaryCipher.encrypt(encrypted, salt);

	// XOR is symmetric: encrypt(encrypt(data)) = data
	assert.deepStrictEqual(doubleEncrypted, binaryData);
});

test("xorBinaryCipher - randomSaltBinary integration", () => {
	const binaryData = new Uint8Array([72, 101, 108, 108, 111]);
	const salt = randomSaltBinary(20);

	assert.ok(salt instanceof Uint8Array, "randomSaltBinary should return Uint8Array");
	assert.strictEqual(salt.length, 20, "Salt should have requested length");

	const encrypted = xorBinaryCipher.encrypt(binaryData, salt);
	const decrypted = xorBinaryCipher.decrypt(encrypted, salt);

	assert.deepStrictEqual(decrypted, binaryData);
});

// Helper to check if two Uint8Arrays are equal
function arraysEqual(a, b) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

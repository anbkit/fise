import assert from "node:assert/strict";
import test from "node:test";

import {
	defaultBinaryProfile,
	defaultStringProfile,
	fiseBinaryDecrypt,
	fiseBinaryEncrypt,
	fiseDecrypt,
	fiseEncrypt
} from "fise";

test("deterministic property sweep roundtrips arbitrary UTF-16 strings", () => {
	const random = mulberry32(0xf15e_0101);
	for (let sample = 0; sample < 300; sample++) {
		const length = sample < 64 ? sample : Math.floor(random() * 513);
		let plaintext = "";
		for (let index = 0; index < length; index++) {
			plaintext += String.fromCharCode(Math.floor(random() * 0x1_0000));
		}
		const timestamp = Math.floor(random() * 1_000_000) - 500_000;
		const envelope = fiseEncrypt(plaintext, defaultStringProfile, { timestamp });
		assert.equal(
			fiseDecrypt(envelope, defaultStringProfile, { timestamp }),
			plaintext,
			`failed string sample ${sample}`
		);
	}
});

test("deterministic property sweep roundtrips arbitrary byte arrays", () => {
	const random = mulberry32(0xb1a4_0101);
	for (let sample = 0; sample < 300; sample++) {
		const length = sample < 64 ? sample : Math.floor(random() * 2_049);
		const plaintext = Uint8Array.from(
			{ length },
			() => Math.floor(random() * 256)
		);
		const timestamp = Math.floor(random() * 1_000_000) - 500_000;
		const envelope = fiseBinaryEncrypt(plaintext, defaultBinaryProfile, { timestamp });
		assert.deepEqual(
			fiseBinaryDecrypt(envelope, defaultBinaryProfile, { timestamp }),
			plaintext,
			`failed binary sample ${sample}`
		);
	}
});

function mulberry32(seed) {
	let state = seed >>> 0;
	return () => {
		state += 0x6d2b79f5;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}

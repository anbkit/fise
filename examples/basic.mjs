import assert from "node:assert/strict";

import { Fise } from "fise";
import profile from "./fise.profile.mjs";

const fise = new Fise(profile);
const context = [
	"session_demo_01",
	"user_42",
	"tenant_acme",
	"catalog:v1"
];

for (const value of [
	"hello",
	{ id: 7, tags: ["generated", "profile"] },
	Uint8Array.from([0, 1, 127, 128, 255])
]) {
	const envelope = fise.encrypt(value, context);
	assert.ok(envelope instanceof Uint8Array);
	assert.deepEqual(fise.decrypt(envelope, context), value);
}

console.log(`PASS basic: one Profile ${profile.fingerprint} restored structured and binary data`);

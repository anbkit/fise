import assert from "node:assert/strict";

import { Fise } from "fise";
import profile from "./fise.profile.mjs";

const fise = new Fise(profile);
const assetId = "asset_receipt_1042";
const context = [
	"session_upload_01",
	"user_42",
	"tenant_acme",
	assetId,
	"receipt:v1"
];
const fileBytes = Uint8Array.from(
	{ length: 96 * 1024 },
	(_, index) => (index * 31 + 11) & 0xff
);

const envelope = fise.encrypt(fileBytes, context);
const restored = fise.decrypt(envelope, context);

assert.ok(restored instanceof Uint8Array);
assert.deepEqual(restored, fileBytes);
assert.notStrictEqual(restored, fileBytes);

console.log(`PASS binary-file: restored ${restored.length} bytes for ${assetId}`);

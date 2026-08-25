import assert from "node:assert/strict";

import {
	FiseError,
	defaultStringProfile,
	fiseDecrypt,
	fiseEncrypt
} from "fise";

const plaintext = "Hello from FISE 1.1";
const envelope = fiseEncrypt(plaintext, defaultStringProfile);
assert.equal(fiseDecrypt(envelope, defaultStringProfile), plaintext);

try {
	fiseDecrypt("legacy-or-plaintext-input", defaultStringProfile);
	assert.fail("legacy input must fail closed");
} catch (error) {
	assert.ok(error instanceof FiseError);
	assert.equal(error.code, "INVALID_ENVELOPE");
}

console.log("PASS basic-string: round trip + typed legacy rejection");

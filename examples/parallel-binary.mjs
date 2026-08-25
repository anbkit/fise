import assert from "node:assert/strict";

import {
	createParallelXorBinaryCipher,
	defaultBinaryProfile,
	fiseBinaryDecrypt,
	fiseBinaryDecryptAsync,
	fiseBinaryEncrypt,
	fiseBinaryEncryptAsync
} from "fise";

const backend = await createParallelXorBinaryCipher({
	workerCount: 2,
	minimumParallelBytes: 64 * 1024
});

try {
	const input = Uint8Array.from(
		{ length: 256 * 1024 + 17 },
		(_, index) => (index * 31 + 9) & 0xff
	);

	// The worker backend changes execution, not the ordinary FISE 1.1 wire.
	const workerEnvelope = await fiseBinaryEncryptAsync(
		input,
		defaultBinaryProfile,
		{ backend }
	);
	assert.deepEqual(
		fiseBinaryDecrypt(workerEnvelope, defaultBinaryProfile),
		input
	);

	const javascriptEnvelope = fiseBinaryEncrypt(input, defaultBinaryProfile);
	assert.deepEqual(
		await fiseBinaryDecryptAsync(
			javascriptEnvelope,
			defaultBinaryProfile,
			{ backend }
		),
		input
	);
} finally {
	await backend.close();
}

console.log("PASS parallel-binary: real workers + unchanged 1.1 wire");


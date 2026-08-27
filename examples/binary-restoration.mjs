import assert from "node:assert/strict";

import { Fise } from "fise";
import profile from "./fise.profile.mjs";

const fise = new Fise(profile);
const edgeFise = new Fise(profile, {
	binary: { mode: "edges", edgeBytes: 128 }
});
const input = Uint8Array.from({ length: 1_003 }, (_, index) => (index * 17 + 3) & 0xff);
const context = [
	"session_download_01",
	"user_42",
	"connection_7",
	"media:v1",
	3
];
const envelope = fise.encrypt(input, context);
const edgeEnvelope = edgeFise.encrypt(input, context);

assert.deepEqual(fise.decrypt(envelope, context), input);
assert.deepEqual(
	fise.decryptRange(envelope, { start: 250, endExclusive: 700 }, context),
	input.slice(250, 700)
);
assert.deepEqual(fise.decrypt(edgeEnvelope, context), input);
assert.deepEqual(
	fise.decryptRange(edgeEnvelope, { start: 100, endExclusive: 900 }, context),
	input.slice(100, 900)
);

const chunks = [];
for await (const chunk of fise.decryptProgressive(envelope, context, {
	chunkSize: 256
})) chunks.push(chunk);
assert.deepEqual(join(chunks), input);

console.log(`PASS binary-restoration: full/edge, selective, and ${chunks.length} lazy chunk restores`);

function join(values) {
	const output = new Uint8Array(values.reduce((length, value) => length + value.length, 0));
	let offset = 0;
	for (const value of values) {
		output.set(value, offset);
		offset += value.length;
	}
	return output;
}

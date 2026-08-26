import assert from "node:assert/strict";

import { Fise } from "fise";
import profile from "./fise.profile.mjs";

const fise = new Fise(profile);
const input = Uint8Array.from({ length: 1_003 }, (_, index) => (index * 17 + 3) & 0xff);
const context = [
	"session_download_01",
	"user_42",
	"connection_7",
	"media:v1",
	3
];
const container = fise.encryptFramed(input, context, { frameSize: 256 });

assert.deepEqual(fise.decryptFramed(container, context), input);
assert.deepEqual(
	fise.decryptRange(container, { start: 250, endExclusive: 700 }, context),
	input.slice(250, 700)
);

const frames = [];
for await (const frame of fise.decryptProgressive(container, context)) frames.push(frame);
assert.deepEqual(join(frames), input);

console.log(`PASS framed: full, selective, and ${frames.length} pull-driven frame restores`);

function join(values) {
	const output = new Uint8Array(values.reduce((length, value) => length + value.length, 0));
	let offset = 0;
	for (const value of values) {
		output.set(value, offset);
		offset += value.length;
	}
	return output;
}

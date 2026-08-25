import assert from "node:assert/strict";

import {
	defaultBinaryProfile,
	fiseFramedBinaryDecrypt,
	fiseFramedBinaryDecryptProgressive,
	fiseFramedBinaryDecryptRange,
	fiseFramedBinaryEncrypt
} from "fise";

const input = Uint8Array.from(
	{ length: 1_003 },
	(_, index) => (index * 17 + 3) & 0xff
);
const container = await fiseFramedBinaryEncrypt(input, defaultBinaryProfile, {
	frameSize: 256
});

assert.deepEqual(
	await fiseFramedBinaryDecrypt(container, defaultBinaryProfile),
	input
);
assert.deepEqual(
	await fiseFramedBinaryDecryptRange(
		container,
		defaultBinaryProfile,
		{ start: 250, endExclusive: 700 }
	),
	input.slice(250, 700)
);

const progressiveFrames = [];
for await (const frame of fiseFramedBinaryDecryptProgressive(
	container,
	defaultBinaryProfile
)) {
	progressiveFrames.push(frame);
}
assert.deepEqual(join(progressiveFrames), input);

let pulledFrames = 0;
for await (const _frame of fiseFramedBinaryDecryptProgressive(
	container,
	defaultBinaryProfile
)) {
	pulledFrames++;
	if (pulledFrames === 2) break;
}
assert.equal(pulledFrames, 2);

console.log(
	`PASS framed-binary: full + range + ${progressiveFrames.length} progressive byte frames + early stop`
);

function join(frames) {
	const output = new Uint8Array(
		frames.reduce((total, frame) => total + frame.length, 0)
	);
	let offset = 0;
	for (const frame of frames) {
		output.set(frame, offset);
		offset += frame.length;
	}
	return output;
}

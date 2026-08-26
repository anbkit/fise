#!/usr/bin/env node

import assert from "node:assert/strict";

import { Fise } from "../dist/index.js";
import profile from "../tests/v2/profile-a.generated.mjs";
import {
	assertBytes,
	deterministicBytes,
	emitBenchmarkOutput,
	formatMeasurement,
	measureSync,
	parseBenchmarkArguments,
	type Measurement
} from "./shared.js";

interface UnifiedResult {
	readonly payloadBytes: number;
	readonly envelopeBytes: number;
	readonly encrypt: Measurement;
	readonly decrypt: Measurement;
}

const arguments_ = parseBenchmarkArguments();
const fise = new Fise(profile);
const context = ["unified-api"];
const sizes = arguments_.full
	? [1_024, 16_384, 262_144, 1_048_576, 4_194_304]
	: [1_024, 65_536, 1_048_576];
const results: UnifiedResult[] = [];

for (const size of sizes) {
	const input = deterministicBytes(size);
	const iterations = arguments_.full ? Math.max(12, Math.floor(500_000 / size)) : 20;
	const warmup = 3;
	const encrypt = measureSync(
		() => fise.encrypt(input, context),
		{
			warmup,
			iterations,
			bytesPerOperation: input.length,
			verify: envelope => assert.ok(envelope.length > input.length)
		}
	);
	const envelope = fise.encrypt(input, context);
	const decrypt = measureSync(
		() => fise.decrypt(envelope, context),
		{
			warmup,
			iterations,
			bytesPerOperation: input.length,
			verify: output => assertBytes(output, input, "JavaScript decrypt")
		}
	);
	results.push({
		payloadBytes: input.length,
		envelopeBytes: envelope.length,
		encrypt,
		decrypt
	});
}

const structured = { title: "FISE 2.0", nested: { ok: true }, values: [1, null, "three"] };
assert.deepEqual(fise.decrypt(fise.encrypt(structured, context), context), structured);

const output = {
	schema: "fise.unified-benchmark/2",
	runtime: process.version,
	platform: `${process.platform}-${process.arch}`,
	mode: arguments_.full ? "full" : "default",
	measurementBoundary: "complete deterministic FISE 2.0 context-bound envelope creation/restoration",
	limitations: [
		"local microbenchmark only",
		"not a cryptographic-security measurement",
		"structured codec is checked for correctness but not timed"
	],
	results
};

emitBenchmarkOutput(arguments_, output, () => {
	console.log(`FISE 2.0 unified JavaScript benchmark (${output.mode})`);
	for (const result of results) {
		console.log(`\n${result.payloadBytes} input bytes; ${result.envelopeBytes} envelope bytes`);
		console.log(`  encrypt: ${formatMeasurement(result.encrypt)}`);
		console.log(`  decrypt: ${formatMeasurement(result.decrypt)}`);
	}
});

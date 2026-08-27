#!/usr/bin/env node

import { Fise } from "../dist/index.js";
import profile from "../tests/v2/profile-a.generated.mjs";
import {
	assertBytes,
	deterministicBytes,
	emitBenchmarkOutput,
	formatMeasurement,
	joinBytes,
	measureAsync,
	measureSync,
	parseBenchmarkArguments,
	type Measurement
} from "./shared.js";

interface BinarySuite {
	readonly inputBytes: number;
	readonly envelopeBytes: number;
	readonly chunkSize: number;
	readonly chunkCount: number;
	readonly fullRestoration: Measurement;
	readonly rangeRestoration: readonly [{
		readonly start: number;
		readonly endExclusive: number;
		readonly requestedBytes: number;
		readonly measurement: Measurement;
	}];
	readonly progressiveRestoration: Measurement;
}

const KIB = 1024;
const MIB = 1024 * KIB;
const arguments_ = parseBenchmarkArguments();
const fise = new Fise(profile);
const input = deterministicBytes(arguments_.full ? 8 * MIB : 2 * MIB, 19);
const envelope = fise.encrypt(input, ["binary-restoration"]);
const edgeBytes = arguments_.full ? 256 * KIB : 64 * KIB;
const edgeFise = new Fise(profile, {
	binary: { mode: "edges", edgeBytes }
});
const edgeEnvelope = edgeFise.encrypt(input, ["binary-restoration"]);
const chunkSizes = arguments_.full ? [16 * KIB, 64 * KIB, 256 * KIB] : [64 * KIB, 256 * KIB];
const context = ["binary-restoration"];
const suites: BinarySuite[] = [];
const coverageIterations = arguments_.full ? 20 : 8;
const fullEncryption = measureSync(
	() => fise.encrypt(input, context),
	{
		warmup: 2,
		iterations: coverageIterations,
		bytesPerOperation: input.length,
		verify: value => assertBytes(value, envelope, "full binary encryption")
	}
);
const edgeEncryption = measureSync(
	() => edgeFise.encrypt(input, context),
	{
		warmup: 2,
		iterations: coverageIterations,
		bytesPerOperation: input.length,
		verify: value => assertBytes(value, edgeEnvelope, "edge binary encryption")
	}
);

for (const chunkSize of chunkSizes) {
	const iterations = arguments_.full ? 20 : 8;
	const warmup = 2;
	const fullRestoration = measureSync(
		() => fise.decrypt(envelope, context),
		{
			warmup,
			iterations,
			bytesPerOperation: input.length,
			verify: value => assertBytes(value, input, "full binary restoration")
		}
	);
	const range = {
		start: Math.floor(input.length * 0.23),
		endExclusive: Math.floor(input.length * 0.61)
	};
	const expectedRange = input.slice(range.start, range.endExclusive);
	const rangeMeasurement = measureSync(
		() => fise.decryptRange(envelope, range, context),
		{
			warmup,
			iterations,
			bytesPerOperation: expectedRange.length,
			verify: value => assertBytes(value, expectedRange, "range restoration")
		}
	);
	const progressiveRestoration = await measureAsync(
		async () => {
			const chunks = [];
			for await (const chunk of fise.decryptProgressive(envelope, context, {
				chunkSize
			})) chunks.push(chunk);
			return joinBytes(chunks);
		},
		{
			warmup,
			iterations,
			bytesPerOperation: input.length,
			verify: value => assertBytes(value, input, "progressive restoration")
		}
	);
	suites.push({
		inputBytes: input.length,
		envelopeBytes: envelope.length,
		chunkSize,
		chunkCount: Math.ceil(input.length / chunkSize),
		fullRestoration,
		rangeRestoration: [{ ...range, requestedBytes: expectedRange.length, measurement: rangeMeasurement }],
		progressiveRestoration
	});
}

const output = {
	schema: "fise.binary-restoration-benchmark/2",
	runtime: process.version,
	platform: `${process.platform}-${process.arch}`,
	mode: arguments_.full ? "full" : "default",
	measurementBoundary: "in-memory ordinary FISE binary envelope; no network or incremental input",
	coverage: {
		edgeBytesPerSide: edgeBytes,
		untransformedMiddleBytes: input.length - edgeBytes * 2,
		fullEnvelopeBytes: envelope.length,
		edgeEnvelopeBytes: edgeEnvelope.length,
		fullEncryption,
		edgeEncryption
	},
	suites
};

emitBenchmarkOutput(arguments_, output, () => {
	console.log(`FISE 2.0 binary restoration benchmark (${output.mode})`);
	console.log(`  full encrypt: ${formatMeasurement(fullEncryption)}`);
	console.log(
		`  edge encrypt (${edgeBytes} bytes/side, ${input.length - edgeBytes * 2} clear middle bytes): ` +
		formatMeasurement(edgeEncryption)
	);
	for (const suite of suites) {
		console.log(
			`\n${suite.inputBytes} bytes / ${suite.chunkCount} progressive chunks / ` +
			`${suite.envelopeBytes} envelope bytes`
		);
		console.log(`  full:        ${formatMeasurement(suite.fullRestoration)}`);
		console.log(`  range:       ${formatMeasurement(suite.rangeRestoration[0].measurement)}`);
		console.log(`  progressive: ${formatMeasurement(suite.progressiveRestoration)}`);
	}
});

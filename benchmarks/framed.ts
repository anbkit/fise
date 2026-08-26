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

interface FramedSuite {
	readonly inputBytes: number;
	readonly containerBytes: number;
	readonly frameSize: number;
	readonly frameCount: number;
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
const frameSizes = arguments_.full ? [16 * KIB, 64 * KIB, 256 * KIB] : [64 * KIB, 256 * KIB];
const context = ["framed"];
const suites: FramedSuite[] = [];

for (const frameSize of frameSizes) {
	const container = fise.encryptFramed(input, context, { frameSize });
	const iterations = arguments_.full ? 20 : 8;
	const warmup = 2;
	const fullRestoration = measureSync(
		() => fise.decryptFramed(container, context),
		{
			warmup,
			iterations,
			bytesPerOperation: input.length,
			verify: value => assertBytes(value, input, "full framed restoration")
		}
	);
	const range = {
		start: Math.floor(input.length * 0.23),
		endExclusive: Math.floor(input.length * 0.61)
	};
	const expectedRange = input.slice(range.start, range.endExclusive);
	const rangeMeasurement = measureSync(
		() => fise.decryptRange(container, range, context),
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
			for await (const chunk of fise.decryptProgressive(container, context)) chunks.push(chunk);
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
		containerBytes: container.length,
		frameSize,
		frameCount: Math.ceil(input.length / frameSize),
		fullRestoration,
		rangeRestoration: [{ ...range, requestedBytes: expectedRange.length, measurement: rangeMeasurement }],
		progressiveRestoration
	});
}

const output = {
	schema: "fise.framed-benchmark/2",
	runtime: process.version,
	platform: `${process.platform}-${process.arch}`,
	mode: arguments_.full ? "full" : "default",
	measurementBoundary: "in-memory FISF 2.0 restoration; no network or incremental input",
	suites
};

emitBenchmarkOutput(arguments_, output, () => {
	console.log(`FISE 2.0 framed benchmark (${output.mode})`);
	for (const suite of suites) {
		console.log(
			`\n${suite.inputBytes} bytes / ${suite.frameCount} frames / ` +
			`${suite.containerBytes} container bytes`
		);
		console.log(`  full:        ${formatMeasurement(suite.fullRestoration)}`);
		console.log(`  range:       ${formatMeasurement(suite.rangeRestoration[0].measurement)}`);
		console.log(`  progressive: ${formatMeasurement(suite.progressiveRestoration)}`);
	}
});

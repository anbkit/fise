#!/usr/bin/env node

import { Fise } from "../dist/index.js";
import profile from "../tests/v2/profile-a.generated.mjs";
import {
	assertBytes,
	deterministicBytes,
	emitBenchmarkOutput,
	formatMeasurement,
	measureAsync,
	measureSync,
	parseBenchmarkArguments,
	type Measurement
} from "./shared.js";

interface OperationResult {
	readonly payloadBytes: number;
	readonly roundTrip: Measurement;
}

interface WorkerResult {
	readonly workerCount: number;
	readonly startupMs: number;
	readonly operations: readonly OperationResult[];
}

const KIB = 1024;
const MIB = 1024 * KIB;
const arguments_ = parseBenchmarkArguments();
const javascript = new Fise(profile);
const context = ["workers"];
const payloadSizes = arguments_.full ? [256 * KIB, MIB, 4 * MIB] : [256 * KIB, MIB];
const workerCounts = arguments_.full ? [1, 2, 4] : [1, 2];
const localOperations: OperationResult[] = [];

for (const payloadBytes of payloadSizes) {
	const input = deterministicBytes(payloadBytes, 23);
	const measurement = measureSync(
		() => javascript.decrypt(javascript.encrypt(input, context), context),
		{
			warmup: 2,
			iterations: arguments_.full ? 16 : 8,
			bytesPerOperation: input.length,
			verify: value => assertBytes(value, input, "local JavaScript round trip")
		}
	);
	localOperations.push({ payloadBytes, roundTrip: measurement });
}

const workers: WorkerResult[] = [];
for (const workerCount of workerCounts) {
	const startupAt = performance.now();
	const parallel = await javascript.parallel({ workerCount, minimumParallelBytes: 0 });
	const startupMs = performance.now() - startupAt;
	try {
		const operations: OperationResult[] = [];
		for (const payloadBytes of payloadSizes) {
			const input = deterministicBytes(payloadBytes, 23);
			const roundTrip = await measureAsync(
				async () => parallel.decrypt(await parallel.encrypt(input, context), context),
				{
					warmup: 2,
					iterations: arguments_.full ? 16 : 8,
					bytesPerOperation: input.length,
					verify: value => assertBytes(value, input, `${workerCount}-worker round trip`)
				}
			);
			assertBytes(
				javascript.decrypt(await parallel.encrypt(input, context), context),
				input,
				"worker to JavaScript interoperability"
			);
			operations.push({ payloadBytes, roundTrip });
		}
		workers.push({ workerCount, startupMs, operations });
	} finally {
		await parallel.close();
	}
}

const output = {
	schema: "fise.worker-benchmark/2",
	runtime: process.version,
	platform: `${process.platform}-${process.arch}`,
	mode: arguments_.full ? "full" : "default",
	measurementBoundary: "retained module workers using generated WASM and complete FISE 2.0 round trips",
	localJavaScript: { operations: localOperations },
	workers
};

emitBenchmarkOutput(arguments_, output, () => {
	console.log(`FISE 2.0 worker benchmark (${output.mode})`);
	for (const operation of localOperations) {
		console.log(`\nJS ${operation.payloadBytes} bytes: ${formatMeasurement(operation.roundTrip)}`);
	}
	for (const suite of workers) {
		console.log(`\n${suite.workerCount} worker(s); startup ${suite.startupMs.toFixed(3)} ms`);
		for (const operation of suite.operations) {
			console.log(`  ${operation.payloadBytes} bytes: ${formatMeasurement(operation.roundTrip)}`);
		}
	}
});

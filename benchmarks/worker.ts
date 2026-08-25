#!/usr/bin/env node

import assert from "node:assert/strict";

import { createFramedBinaryConformanceEnvelope } from "../dist/conformance.js";
import {
	createParallelXorBinaryCipher,
	defaultBinaryProfile,
	fiseBinaryDecryptAsync,
	fiseBinaryEncryptAsync,
	fiseFramedBinaryDecrypt,
	fiseFramedBinaryDecryptRange,
	xorBinaryCipher
} from "../dist/index.js";
import {
	assertBytesEqual,
	benchmarkEnvironment,
	deterministicBytes,
	emitBenchmarkOutput,
	formatMeasurement,
	measureAsync,
	measureAsyncPrepared,
	measureSync,
	observeMemory,
	parseBenchmarkArguments
} from "./shared.js";
import type { Measurement } from "./shared.js";

const KIB = 1024;
const MIB = 1024 * KIB;
const arguments_ = parseBenchmarkArguments();
const payloadSizes = arguments_.full
	? [16 * KIB, 64 * KIB, 256 * KIB, MIB, 4 * MIB, 16 * MIB]
	: [64 * KIB, 256 * KIB, MIB, 4 * MIB];
const workerCounts = [1, 2, 4];
const includeSamples = arguments_.output !== undefined;
const salt = deterministicBytes(67, 13);
const memoryBefore = observeMemory();

interface OperationResult {
	readonly payloadBytes: number;
	readonly rawTransform: Measurement;
	readonly ordinaryRoundTrip: Measurement;
}

interface WorkerSuiteResult {
	readonly workerCount: number;
	readonly minimumParallelBytes: number;
	readonly lifecycle: {
		readonly startup: Measurement;
		readonly firstOperation: Measurement;
		readonly close: Measurement;
	};
	readonly operations: readonly OperationResult[];
	readonly framed: {
		readonly concurrency: number;
		readonly fullRestoration: Measurement;
		readonly rangeRestoration: Measurement;
	};
}

const localOperations: OperationResult[] = [];
for (const size of payloadSizes) {
	const input = deterministicBytes(size);
	const expectedTransform = xorBinaryCipher.encrypt(input, salt);
	const policy = iterationPolicy(size, arguments_.full);
	const rawTransform = measureSync(
		() => xorBinaryCipher.encrypt(input, salt),
		{
			...policy,
			bytesPerOperation: input.length,
			includeSamples,
			verify: output => assertBytesEqual(
				output,
				expectedTransform,
				"local raw XOR transform"
			)
		}
	);
	const ordinaryRoundTrip = await measureAsync(
		async () => {
			const envelope = await fiseBinaryEncryptAsync(input, defaultBinaryProfile);
			return fiseBinaryDecryptAsync(envelope, defaultBinaryProfile);
		},
		{
			...policy,
			bytesPerOperation: input.length,
			includeSamples,
			verify: output => assertBytesEqual(
				output,
				input,
				"local ordinary binary round trip"
			)
		}
	);
	localOperations.push({
		payloadBytes: size,
		rawTransform,
		ordinaryRoundTrip
	});
}

const framedInput = deterministicBytes(arguments_.full ? 8 * MIB : 4 * MIB, 19);
const framedFrameSize = 256 * KIB;
const framedFrameCount = Math.ceil(framedInput.length / framedFrameSize);
const framedSalts = Array.from(
	{ length: framedFrameCount },
	(_, frameIndex) => deterministicBytes(16, frameIndex * 2 + 23)
);
const framedContainer = createFramedBinaryConformanceEnvelope(
	framedInput,
	framedSalts,
	defaultBinaryProfile,
	{ frameSize: framedFrameSize, timestamp: 0 }
);
const framedRange = createRepresentativeRange(framedInput.length);
const framedRangeExpected = framedInput.slice(
	framedRange.start,
	framedRange.endExclusive
);
const framedPolicy = {
	warmup: arguments_.full ? 5 : 3,
	iterations: arguments_.full ? 30 : 16,
	includeSamples
};
const localFramed = {
	fullRestoration: await measureAsync(
		() => fiseFramedBinaryDecrypt(
			framedContainer,
			defaultBinaryProfile,
			{ timestamp: 0, concurrency: 1 }
		),
		{
			...framedPolicy,
			bytesPerOperation: framedInput.length,
			verify: output => assertBytesEqual(output, framedInput, "local FISF full restoration")
		}
	),
	rangeRestoration: await measureAsync(
		() => fiseFramedBinaryDecryptRange(
			framedContainer,
			defaultBinaryProfile,
			framedRange,
			{ timestamp: 0, concurrency: 1 }
		),
		{
			...framedPolicy,
			bytesPerOperation: selectedFrameBytes(
				framedInput.length,
				framedFrameSize,
				framedRange
			),
			verify: output => assertBytesEqual(
				output,
				framedRangeExpected,
				"local FISF range restoration"
			)
		}
	)
};

const workerSuites: WorkerSuiteResult[] = [];
for (const workerCount of workerCounts) {
	const lifecycleIterations = arguments_.full ? 10 : 5;
	const lifecyclePolicy = {
		warmup: 1,
		iterations: lifecycleIterations,
		includeSamples
	};
	const startup = await measureAsync(
		() => createParallelXorBinaryCipher({
			workerCount,
			minimumParallelBytes: 0
		}),
		{
			...lifecyclePolicy,
			verify: backend => {
				assert.equal(backend.workerCount, workerCount);
			},
			afterEach: backend => backend.close()
		}
	);
	const close = await measureAsyncPrepared({
		...lifecyclePolicy,
		prepare: () => createParallelXorBinaryCipher({
			workerCount,
			minimumParallelBytes: 0
		}),
		operation: backend => backend.close(),
		verify: result => assert.equal(result, undefined)
	});
	const firstInput = deterministicBytes(MIB);
	const firstExpected = xorBinaryCipher.encrypt(firstInput, salt);
	const firstOperation = await measureAsyncPrepared({
		...lifecyclePolicy,
		bytesPerOperation: firstInput.length,
		prepare: () => createParallelXorBinaryCipher({
			workerCount,
			minimumParallelBytes: 0
		}),
		operation: backend => backend.encrypt(firstInput, salt),
		verify: output => assertBytesEqual(
			output,
			firstExpected,
			"first worker operation"
		),
		afterPrepared: backend => backend.close()
	});

	const backend = await createParallelXorBinaryCipher({
		workerCount,
		minimumParallelBytes: 0
	});
	try {
		const operations: OperationResult[] = [];
		for (const size of payloadSizes) {
			const input = deterministicBytes(size);
			const expectedTransform = xorBinaryCipher.encrypt(input, salt);
			const policy = iterationPolicy(size, arguments_.full);
			const rawTransform = await measureAsync(
				() => backend.encrypt(input, salt),
				{
					...policy,
					bytesPerOperation: input.length,
					includeSamples,
					verify: output => assertBytesEqual(
						output,
						expectedTransform,
						`worker-${workerCount} raw transform`
					)
				}
			);
			const ordinaryRoundTrip = await measureAsync(
				async () => {
					const envelope = await fiseBinaryEncryptAsync(
						input,
						defaultBinaryProfile,
						{ backend }
					);
					return fiseBinaryDecryptAsync(
						envelope,
						defaultBinaryProfile,
						{ backend }
					);
				},
				{
					...policy,
					bytesPerOperation: input.length,
					includeSamples,
					verify: output => assertBytesEqual(
						output,
						input,
						`worker-${workerCount} ordinary round trip`
					)
				}
			);
			operations.push({ payloadBytes: size, rawTransform, ordinaryRoundTrip });
		}

		const framed = {
			concurrency: 1,
			fullRestoration: await measureAsync(
				() => fiseFramedBinaryDecrypt(
					framedContainer,
					defaultBinaryProfile,
					{ timestamp: 0, concurrency: 1, backend }
				),
				{
					...framedPolicy,
					bytesPerOperation: framedInput.length,
					verify: output => assertBytesEqual(
						output,
						framedInput,
						`worker-${workerCount} FISF full restoration`
					)
				}
			),
			rangeRestoration: await measureAsync(
				() => fiseFramedBinaryDecryptRange(
					framedContainer,
					defaultBinaryProfile,
					framedRange,
					{ timestamp: 0, concurrency: 1, backend }
				),
				{
					...framedPolicy,
					bytesPerOperation: selectedFrameBytes(
						framedInput.length,
						framedFrameSize,
						framedRange
					),
					verify: output => assertBytesEqual(
						output,
						framedRangeExpected,
						`worker-${workerCount} FISF range restoration`
					)
				}
			)
		};
		workerSuites.push({
			workerCount,
			minimumParallelBytes: 0,
			lifecycle: { startup, firstOperation, close },
			operations,
			framed
		});
	} finally {
		await backend.close();
	}
}

const output = {
	schema: "fise.worker-benchmark/1",
	mode: arguments_.full ? "full" : "default",
	environment: benchmarkEnvironment(commandLabel(arguments_)),
	measurementMethod: {
		clock: "performance.now() monotonic milliseconds",
		correctness: "Every reported case executes and byte-compares one untimed preflight result.",
		backendLifecycle: "Startup, first operation, warm operations, and close are measured separately.",
		framedConcurrency: 1,
		workerPathIncludes: [
			"caller-owned input and salt snapshots",
			"per-worker chunk copies",
			"message dispatch and transferable ownership",
			"worker transform execution",
			"result assembly"
		],
		transferCopyBoundary: "The public backend exposes only aggregate worker-path cost; transfer and copy time are not isolated.",
		rawSamplesIncluded: includeSamples
	},
	framedCase: {
		inputBytes: framedInput.length,
		containerBytes: framedContainer.length,
		frameSize: framedFrameSize,
		frameCount: framedFrameCount,
		range: framedRange,
		requestedRangeBytes: framedRange.endExclusive - framedRange.start,
		selectedFrameBytes: selectedFrameBytes(
			framedInput.length,
			framedFrameSize,
			framedRange
		)
	},
	localJavaScript: {
		operations: localOperations,
		framed: localFramed
	},
	workers: workerSuites,
	memoryObservation: {
		before: memoryBefore,
		after: observeMemory(),
		note: "RSS includes process-wide activity; heap and array-buffer values are not per-operation allocation proofs."
	},
	notMeasured: [
		"isolated structured-clone time",
		"isolated transferable ownership time",
		"browser UI responsiveness",
		"mobile or constrained-device behavior",
		"universal worker crossover",
		"network behavior",
		"cryptographic security"
	]
};

emitBenchmarkOutput(arguments_, output, () => {
	console.log(`FISE worker benchmark (${output.mode})`);
	console.log(`Worker counts: ${workerCounts.join(", ")}; worker minimumParallelBytes: 0`);
	for (const local of localOperations) {
		console.log(
			`Local ${(local.payloadBytes / KIB).toFixed(0)} KiB raw: ` +
			formatMeasurement(local.rawTransform)
		);
	}
	for (const suite of workerSuites) {
		console.log(`\n${suite.workerCount} worker(s)`);
		console.log(`  Startup: ${formatMeasurement(suite.lifecycle.startup)}`);
		console.log(`  First 1 MiB operation: ${formatMeasurement(suite.lifecycle.firstOperation)}`);
		for (const operation of suite.operations) {
			console.log(
				`  ${(operation.payloadBytes / KIB).toFixed(0)} KiB raw: ` +
				formatMeasurement(operation.rawTransform)
			);
		}
		console.log(
			`  FISF full: ${formatMeasurement(suite.framed.fullRestoration)}`
		);
		console.log(
			`  FISF selected range: ${formatMeasurement(suite.framed.rangeRestoration)}`
		);
		console.log(`  Close: ${formatMeasurement(suite.lifecycle.close)}`);
	}
});

function iterationPolicy(
	payloadBytes: number,
	full: boolean
): { warmup: number; iterations: number } {
	if (payloadBytes <= 64 * KIB) return { warmup: 8, iterations: full ? 100 : 60 };
	if (payloadBytes <= 256 * KIB) return { warmup: 6, iterations: full ? 80 : 50 };
	if (payloadBytes <= MIB) return { warmup: 5, iterations: full ? 50 : 30 };
	if (payloadBytes <= 4 * MIB) return { warmup: 3, iterations: full ? 24 : 12 };
	return { warmup: 2, iterations: 10 };
}

function createRepresentativeRange(plaintextLength: number): {
	start: number;
	endExclusive: number;
} {
	const requestedBytes = Math.round(plaintextLength * 0.1);
	const start = Math.min(
		plaintextLength - requestedBytes,
		Math.floor(plaintextLength * 0.37) + 17
	);
	return { start, endExclusive: start + requestedBytes };
}

function selectedFrameBytes(
	plaintextLength: number,
	frameSize: number,
	range: { start: number; endExclusive: number }
): number {
	const firstFrame = Math.floor(range.start / frameSize);
	const endFrameExclusive = Math.ceil(range.endExclusive / frameSize);
	return (
		Math.min(endFrameExclusive * frameSize, plaintextLength) -
		firstFrame * frameSize
	);
}

function commandLabel(arguments_: { full: boolean; json: boolean; output?: string }): string {
	const flags = [
		...(arguments_.full ? ["--full"] : []),
		...(arguments_.json ? ["--json"] : []),
		...(arguments_.output ? ["--output", arguments_.output] : [])
	];
	return `npm run benchmark:worker${flags.length > 0 ? ` -- ${flags.join(" ")}` : ""}`;
}

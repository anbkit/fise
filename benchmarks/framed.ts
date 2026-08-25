#!/usr/bin/env node

import assert from "node:assert/strict";

import { createFramedBinaryConformanceEnvelope } from "../dist/conformance.js";
import {
	defaultBinaryProfile,
	fiseFramedBinaryDecrypt,
	fiseFramedBinaryDecryptProgressive,
	fiseFramedBinaryDecryptRange
} from "../dist/index.js";
import type { FiseBinaryRange } from "../dist/framedBinary.js";
import type { Measurement } from "./shared.js";
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
	parseBenchmarkArguments,
	throughputMiBPerSecond
} from "./shared.js";

const KIB = 1024;
const MIB = 1024 * KIB;

interface RangeCase extends FiseBinaryRange {
	readonly name: string;
	readonly alignment: "aligned" | "unaligned";
	readonly targetRatio: number | null;
}

interface RangeResult extends RangeCase {
	readonly requestedBytes: number;
	readonly requestedPlaintextRatio: number;
	readonly selectedFrameCount: number;
	readonly selectedPlaintextBytes: number;
	readonly requestedThroughputMiBPerSecond: number | null;
	readonly measurement: Measurement;
}

interface ProgressivePullResult {
	readonly kind: "first-consumer-pull" | "fixed-pulls";
	readonly requestedPulls: number;
	readonly restoredBytes: number;
	readonly measurement: Measurement;
}

interface FramedSuiteResult {
	readonly inputBytes: number;
	readonly containerBytes: number;
	readonly wireOverheadBytes: number;
	readonly wireExpansionRatio: number;
	readonly frameSize: number;
	readonly frameCount: number;
	readonly fullRestoration: Measurement;
	readonly rangeRestoration: readonly RangeResult[];
	readonly progressiveRestoration: {
		readonly iteratorCreation: Measurement;
		readonly pullCases: readonly ProgressivePullResult[];
		readonly completeDrain: Measurement;
	};
}

const arguments_ = parseBenchmarkArguments();
const inputBytes = arguments_.full ? 8 * MIB : 2 * MIB;
const frameSizes = arguments_.full
	? [16 * KIB, 64 * KIB, 256 * KIB, MIB]
	: [64 * KIB, 256 * KIB];
const warmup = arguments_.full ? 8 : 5;
const iterations = arguments_.full ? 60 : 40;
const includeSamples = arguments_.output !== undefined;
const input = deterministicBytes(inputBytes);
const memoryBefore = observeMemory();
const suites: FramedSuiteResult[] = [];

for (const frameSize of frameSizes) {
	const frameCount = Math.ceil(input.length / frameSize);
	const salts = Array.from(
		{ length: frameCount },
		(_, frameIndex) => deterministicBytes(16, frameIndex * 2 + 17)
	);
	const container = createFramedBinaryConformanceEnvelope(
		input,
		salts,
		defaultBinaryProfile,
		{ frameSize, timestamp: 0 }
	);
	const common = {
		warmup,
		iterations,
		includeSamples
	};
	const full = await measureAsync(
		() => fiseFramedBinaryDecrypt(container, defaultBinaryProfile, { timestamp: 0 }),
		{
			...common,
			bytesPerOperation: input.length,
			verify: output => assertBytesEqual(output, input, "full FISF restoration")
		}
	);
	const ranges: RangeResult[] = [];
	for (const range of createRangeCases(input.length, frameSize)) {
		const publicRange = {
			start: range.start,
			endExclusive: range.endExclusive
		};
		const expected = input.slice(range.start, range.endExclusive);
		const selected = selectedFrameMetadata(
			input.length,
			frameSize,
			range
		);
		const measurement = await measureAsync(
			() => fiseFramedBinaryDecryptRange(
				container,
				defaultBinaryProfile,
				publicRange,
				{ timestamp: 0 }
			),
			{
				...common,
				bytesPerOperation: selected.selectedPlaintextBytes,
				verify: output => assertBytesEqual(output, expected, `range ${range.name}`)
			}
		);
		ranges.push({
			...range,
			requestedBytes: range.endExclusive - range.start,
			requestedPlaintextRatio: (
				(range.endExclusive - range.start) / input.length
			),
			...selected,
			requestedThroughputMiBPerSecond: throughputMiBPerSecond(
				range.endExclusive - range.start,
				measurement.stats.meanMs
			),
			measurement
		});
	}

	const iteratorCreation = measureSync(
		() => fiseFramedBinaryDecryptProgressive(
			container,
			defaultBinaryProfile,
			{ timestamp: 0 }
		),
		{
			...common,
			verify: iterator => {
				assert.equal(typeof iterator.next, "function");
			},
			afterEach: iterator => {
				void iterator.return();
			}
		}
	);
	const progressive: ProgressivePullResult[] = [];
	for (const requestedPulls of uniquePullCounts(frameCount)) {
		const expectedLength = Math.min(input.length, requestedPulls * frameSize);
		const measurement = await measureAsyncPrepared({
			...common,
			bytesPerOperation: expectedLength,
			prepare: () => fiseFramedBinaryDecryptProgressive(
				container,
				defaultBinaryProfile,
				{ timestamp: 0 }
			),
			operation: iterator => pullFrames(iterator, requestedPulls),
			verify: frames => assertBytesEqual(
				join(frames),
				input.slice(0, expectedLength),
				`progressive ${requestedPulls}-pull restoration`
			),
			afterPrepared: async iterator => {
				await iterator.return();
			}
		});
		progressive.push({
			kind: requestedPulls === 1 ? "first-consumer-pull" : "fixed-pulls",
			requestedPulls,
			restoredBytes: expectedLength,
			measurement
		});
	}
	const completeDrain = await measureAsyncPrepared({
		...common,
		bytesPerOperation: input.length,
		prepare: () => fiseFramedBinaryDecryptProgressive(
			container,
			defaultBinaryProfile,
			{ timestamp: 0 }
		),
		operation: drainFrames,
		verify: frames => assertBytesEqual(
			join(frames),
			input,
			"complete progressive drain"
		)
	});

	suites.push({
		inputBytes: input.length,
		containerBytes: container.length,
		wireOverheadBytes: container.length - input.length,
		wireExpansionRatio: container.length / input.length,
		frameSize,
		frameCount,
		fullRestoration: full,
		rangeRestoration: ranges,
		progressiveRestoration: {
			iteratorCreation,
			pullCases: progressive,
			completeDrain
		}
	});
}

const output = {
	schema: "fise.framed-benchmark/1",
	mode: arguments_.full ? "full" : "default",
	environment: benchmarkEnvironment(commandLabel(arguments_)),
	measurementMethod: {
		clock: "performance.now() monotonic milliseconds",
		setupExcluded: [
			"deterministic payload generation",
			"deterministic FISF container creation",
			"expected-output generation"
		],
		correctness: "Every reported case executes and byte-compares one untimed preflight result.",
		progressiveBoundary: "Iterator creation is measured separately from consumer pulls; pull/drain timing excludes consumer consolidation of yielded frames.",
		rawSamplesIncluded: includeSamples
	},
	memoryObservation: {
		before: memoryBefore,
		after: observeMemory(),
		note: "Process-level observations only; no exact per-operation allocation claim."
	},
	notMeasured: [
		"network download savings",
		"HTTP range acquisition",
		"incremental input",
		"lazy JSON parsing",
		"human adaptation effort",
		"cryptographic security",
		"universal device performance"
	],
	suites
};

emitBenchmarkOutput(arguments_, output, () => {
	console.log(`FISE framed benchmark (${output.mode})`);
	console.log(`${input.length} plaintext bytes; ${iterations} iterations after ${warmup} warmups`);
	for (const suite of suites) {
		console.log(
			`\nFrame size ${(suite.frameSize / KIB).toFixed(0)} KiB; ` +
			`${suite.frameCount} frames; ${suite.containerBytes} container bytes`
		);
		console.log(`  Full: ${formatMeasurement(suite.fullRestoration)}`);
		for (const range of suite.rangeRestoration) {
			console.log(
				`  Range ${range.name}: ${range.selectedFrameCount} frames / ` +
				`${range.requestedBytes} requested bytes / ${formatMeasurement(range.measurement)}`
			);
		}
		console.log(
			`  Iterator creation: ` +
			formatMeasurement(suite.progressiveRestoration.iteratorCreation)
		);
		for (const progressive of suite.progressiveRestoration.pullCases) {
			console.log(
				`  Progressive ${progressive.requestedPulls} pull(s): ` +
				formatMeasurement(progressive.measurement)
			);
		}
		console.log(
			`  Progressive complete drain: ` +
			formatMeasurement(suite.progressiveRestoration.completeDrain)
		);
	}
});

function createRangeCases(plaintextLength: number, frameSize: number): RangeCase[] {
	const cases: RangeCase[] = [];
	const frameCount = Math.ceil(plaintextLength / frameSize);
	const singleFrame = Math.min(1, frameCount - 1);
	cases.push({
		name: "one-frame-aligned",
		alignment: "aligned",
		targetRatio: null,
		start: singleFrame * frameSize,
		endExclusive: Math.min((singleFrame + 1) * frameSize, plaintextLength)
	});
	cases.push({
		name: "one-frame-unaligned",
		alignment: "unaligned",
		targetRatio: null,
		start: Math.min(singleFrame * frameSize + Math.floor(frameSize / 3), plaintextLength - 1),
		endExclusive: Math.min(singleFrame * frameSize + Math.floor(frameSize * 2 / 3), plaintextLength)
	});
	for (const ratio of [0.01, 0.1, 0.25, 0.5, 1]) {
		cases.push(alignedRatioRange(plaintextLength, frameSize, ratio));
		if (ratio < 1) cases.push(unalignedRatioRange(plaintextLength, frameSize, ratio));
	}
	return cases;
}

function alignedRatioRange(
	plaintextLength: number,
	frameSize: number,
	ratio: number
): RangeCase {
	if (ratio === 1) {
		return {
			name: "100%-aligned",
			alignment: "aligned",
			targetRatio: ratio,
			start: 0,
			endExclusive: plaintextLength
		};
	}
	const totalFrames = Math.ceil(plaintextLength / frameSize);
	const selectedFrames = Math.max(1, Math.round(totalFrames * ratio));
	const startFrame = Math.floor((totalFrames - selectedFrames) / 2);
	return {
		name: `${Math.round(ratio * 100)}%-aligned`,
		alignment: "aligned",
		targetRatio: ratio,
		start: startFrame * frameSize,
		endExclusive: Math.min(
			(startFrame + selectedFrames) * frameSize,
			plaintextLength
		)
	};
}

function unalignedRatioRange(
	plaintextLength: number,
	frameSize: number,
	ratio: number
): RangeCase {
	const requestedBytes = Math.max(1, Math.round(plaintextLength * ratio));
	const centeredStart = Math.floor((plaintextLength - requestedBytes) / 2);
	let start = Math.min(
		plaintextLength - requestedBytes,
		centeredStart + Math.max(1, Math.floor(frameSize / 3))
	);
	if (start % frameSize === 0 && start + requestedBytes < plaintextLength) start++;
	return {
		name: `${Math.round(ratio * 100)}%-unaligned`,
		alignment: "unaligned",
		targetRatio: ratio,
		start,
		endExclusive: start + requestedBytes
	};
}

function selectedFrameMetadata(
	plaintextLength: number,
	frameSize: number,
	range: FiseBinaryRange
): { selectedFrameCount: number; selectedPlaintextBytes: number } {
	if (range.start === range.endExclusive) {
		return { selectedFrameCount: 0, selectedPlaintextBytes: 0 };
	}
	const firstFrame = Math.floor(range.start / frameSize);
	const endFrameExclusive = Math.ceil(range.endExclusive / frameSize);
	const selectedStart = firstFrame * frameSize;
	const selectedEnd = Math.min(endFrameExclusive * frameSize, plaintextLength);
	return {
		selectedFrameCount: endFrameExclusive - firstFrame,
		selectedPlaintextBytes: selectedEnd - selectedStart
	};
}

function uniquePullCounts(frameCount: number): number[] {
	return [...new Set([1, Math.min(4, frameCount)])].filter(count => count > 0);
}

async function pullFrames(
	iterator: AsyncGenerator<Uint8Array, void, void>,
	count: number
): Promise<Uint8Array[]> {
	const frames: Uint8Array[] = [];
	for (let index = 0; index < count; index++) {
		const result = await iterator.next();
		assert.equal(result.done, false, "progressive iterator completed too early");
		frames.push(result.value);
	}
	return frames;
}

async function drainFrames(
	iterator: AsyncGenerator<Uint8Array, void, void>
): Promise<Uint8Array[]> {
	const frames: Uint8Array[] = [];
	for await (const frame of iterator) frames.push(frame);
	return frames;
}

function join(frames: readonly Uint8Array[]): Uint8Array {
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

function commandLabel(arguments_: { full: boolean; json: boolean; output?: string }): string {
	const flags = [
		...(arguments_.full ? ["--full"] : []),
		...(arguments_.json ? ["--json"] : []),
		...(arguments_.output ? ["--output", arguments_.output] : [])
	];
	return `npm run benchmark:framed${flags.length > 0 ? ` -- ${flags.join(" ")}` : ""}`;
}

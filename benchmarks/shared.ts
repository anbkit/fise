import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

export interface BenchmarkArguments {
	readonly full: boolean;
	readonly json: boolean;
	readonly output?: string;
}

export interface TimingStats {
	readonly meanMs: number;
	readonly medianMs: number;
	readonly p95Ms: number;
	readonly p99Ms: number;
	readonly standardDeviationMs: number;
	readonly minMs: number;
	readonly maxMs: number;
	readonly operationsPerSecond: number | null;
	readonly throughputMiBPerSecond: number | null;
}

export interface Measurement {
	readonly warmupCount: number;
	readonly iterationCount: number;
	readonly stats: TimingStats;
	readonly samplesMs?: readonly number[];
}

export interface MemoryObservation {
	readonly rssBytes: number;
	readonly heapUsedBytes: number;
	readonly heapTotalBytes: number;
	readonly externalBytes: number;
	readonly arrayBuffersBytes: number;
	readonly globalGcAvailable: boolean;
}

interface MeasurementOptions<T> {
	readonly warmup: number;
	readonly iterations: number;
	readonly bytesPerOperation?: number;
	readonly includeSamples?: boolean;
	readonly verify: (value: T) => void | Promise<void>;
	readonly afterEach?: (value: T) => void | Promise<void>;
}

interface PreparedMeasurementOptions<Context, T>
	extends MeasurementOptions<T> {
	readonly prepare: () => Context | Promise<Context>;
	readonly operation: (context: Context) => T | Promise<T>;
	readonly afterPrepared?: (context: Context, value: T) => void | Promise<void>;
}

export function parseBenchmarkArguments(): BenchmarkArguments {
	const { values } = parseArgs({
		options: {
			full: { type: "boolean", default: false },
			json: { type: "boolean", default: false },
			output: { type: "string" }
		},
		allowPositionals: false,
		strict: true
	});
	return Object.freeze({
		full: values.full,
		json: values.json,
		output: values.output
	});
}

export function deterministicBytes(length: number, factor = 31): Uint8Array {
	return Uint8Array.from(
		{ length },
		(_, index) => (index * factor + 17) & 0xff
	);
}

export function assertBytesEqual(
	actual: Uint8Array,
	expected: Uint8Array,
	label: string
): void {
	assert.equal(actual.length, expected.length, `${label}: byte length differs`);
	for (let index = 0; index < actual.length; index++) {
		if (actual[index] !== expected[index]) {
			throw new assert.AssertionError({
				message: `${label}: byte ${index} differs`,
				actual: actual[index],
				expected: expected[index],
				operator: "strictEqual"
			});
		}
	}
}

export function observeMemory(): MemoryObservation {
	const usage = process.memoryUsage();
	return Object.freeze({
		rssBytes: usage.rss,
		heapUsedBytes: usage.heapUsed,
		heapTotalBytes: usage.heapTotal,
		externalBytes: usage.external,
		arrayBuffersBytes: usage.arrayBuffers,
		globalGcAvailable: typeof global.gc === "function"
	});
}

export function benchmarkEnvironment(command: string): Readonly<Record<string, unknown>> {
	return Object.freeze({
		timestampUtc: new Date().toISOString(),
		command,
		runtime: process.version,
		platform: process.platform,
		architecture: process.arch,
		cpuModel: cpus()[0]?.model ?? null,
		logicalCpuCount: cpus().length,
		totalMemoryBytes: totalmem(),
		gitCommit: readGit(["rev-parse", "HEAD"]),
		gitDirty: readGit(["status", "--porcelain"]) !== "",
		globalGcAvailable: typeof global.gc === "function"
	});
}

export function measureSync<T>(
	operation: () => T,
	options: MeasurementOptions<T>
): Measurement {
	const verification = operation();
	const verificationResult = options.verify(verification);
	assert.equal(
		verificationResult,
		undefined,
		"Synchronous benchmark verification must not return a promise."
	);
	const verificationCleanup = options.afterEach?.(verification);
	assert.equal(
		verificationCleanup,
		undefined,
		"Synchronous benchmark cleanup must not return a promise."
	);

	for (let index = 0; index < options.warmup; index++) {
		const value = operation();
		const cleanup = options.afterEach?.(value);
		assert.equal(cleanup, undefined, "Synchronous benchmark cleanup must not return a promise.");
	}

	const samples: number[] = [];
	for (let index = 0; index < options.iterations; index++) {
		const startedAt = performance.now();
		const value = operation();
		samples.push(performance.now() - startedAt);
		const cleanup = options.afterEach?.(value);
		assert.equal(cleanup, undefined, "Synchronous benchmark cleanup must not return a promise.");
	}
	return createMeasurement(samples, options);
}

export async function measureAsync<T>(
	operation: () => T | Promise<T>,
	options: MeasurementOptions<T>
): Promise<Measurement> {
	const verification = await operation();
	await options.verify(verification);
	await options.afterEach?.(verification);

	for (let index = 0; index < options.warmup; index++) {
		const value = await operation();
		await options.afterEach?.(value);
	}

	const samples: number[] = [];
	for (let index = 0; index < options.iterations; index++) {
		const startedAt = performance.now();
		const value = await operation();
		samples.push(performance.now() - startedAt);
		await options.afterEach?.(value);
	}
	return createMeasurement(samples, options);
}

export async function measureAsyncPrepared<Context, T>(
	options: PreparedMeasurementOptions<Context, T>
): Promise<Measurement> {
	const verifyContext = await options.prepare();
	const verification = await options.operation(verifyContext);
	await options.verify(verification);
	await options.afterPrepared?.(verifyContext, verification);
	await options.afterEach?.(verification);

	for (let index = 0; index < options.warmup; index++) {
		const context = await options.prepare();
		const value = await options.operation(context);
		await options.afterPrepared?.(context, value);
		await options.afterEach?.(value);
	}

	const samples: number[] = [];
	for (let index = 0; index < options.iterations; index++) {
		const context = await options.prepare();
		const startedAt = performance.now();
		const value = await options.operation(context);
		samples.push(performance.now() - startedAt);
		await options.afterPrepared?.(context, value);
		await options.afterEach?.(value);
	}
	return createMeasurement(samples, options);
}

export function summarizeSamples(
	samplesMs: readonly number[],
	bytesPerOperation = 0
): TimingStats {
	assert.ok(samplesMs.length > 0, "A benchmark requires at least one measured sample.");
	const sorted = [...samplesMs].sort((left, right) => left - right);
	const meanMs = samplesMs.reduce((total, value) => total + value, 0) / samplesMs.length;
	const middle = Math.floor(sorted.length / 2);
	const medianMs = sorted.length % 2 === 0
		? (sorted[middle - 1] + sorted[middle]) / 2
		: sorted[middle];
	const percentile = (fraction: number): number =>
		sorted[Math.min(
			sorted.length - 1,
			Math.max(0, Math.ceil(sorted.length * fraction) - 1)
		)];
	const standardDeviationMs = Math.sqrt(
		samplesMs.reduce(
			(total, value) => total + (value - meanMs) ** 2,
			0
		) / samplesMs.length
	);
	return Object.freeze({
		meanMs,
		medianMs,
		p95Ms: percentile(0.95),
		p99Ms: percentile(0.99),
		standardDeviationMs,
		minMs: sorted[0],
		maxMs: sorted[sorted.length - 1],
		operationsPerSecond: meanMs === 0 ? null : 1_000 / meanMs,
		throughputMiBPerSecond: throughputMiBPerSecond(bytesPerOperation, meanMs)
	});
}

export function throughputMiBPerSecond(
	bytesPerOperation: number,
	meanMs: number
): number | null {
	if (bytesPerOperation === 0 || meanMs === 0) return null;
	return (bytesPerOperation / (1024 * 1024)) / (meanMs / 1_000);
}

export function formatMeasurement(measurement: Measurement): string {
	const stats = measurement.stats;
	const throughput = stats.throughputMiBPerSecond === null
		? ""
		: ` / ${stats.throughputMiBPerSecond.toFixed(1)} MiB/s`;
	return (
		`${stats.meanMs.toFixed(3)} ms mean / ${stats.medianMs.toFixed(3)} ms median / ` +
		`${stats.p95Ms.toFixed(3)} ms P95 / ${stats.p99Ms.toFixed(3)} ms P99 / ` +
		`${stats.standardDeviationMs.toFixed(3)} ms SD${throughput}`
	);
}

export function emitBenchmarkOutput(
	arguments_: BenchmarkArguments,
	output: unknown,
	printHuman: () => void
): void {
	if (arguments_.output) {
		const absolutePath = resolve(arguments_.output);
		mkdirSync(dirname(absolutePath), { recursive: true });
		writeFileSync(absolutePath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
		if (!arguments_.json) console.log(`Machine-readable output: ${absolutePath}`);
	}
	if (arguments_.json) {
		process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
	} else {
		printHuman();
	}
}

function createMeasurement<T>(
	samples: readonly number[],
	options: MeasurementOptions<T>
): Measurement {
	return Object.freeze({
		warmupCount: options.warmup,
		iterationCount: options.iterations,
		stats: summarizeSamples(samples, options.bytesPerOperation),
		...(options.includeSamples ? { samplesMs: Object.freeze([...samples]) } : {})
	});
}

function readGit(arguments_: readonly string[]): string | null {
	const result = spawnSync("git", arguments_, { encoding: "utf8" });
	return result.status === 0 ? result.stdout.trim() : null;
}

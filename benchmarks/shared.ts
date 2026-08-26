import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

export interface BenchmarkArguments {
	readonly full: boolean;
	readonly json: boolean;
	readonly output?: string;
}

export interface Measurement {
	readonly warmupCount: number;
	readonly iterationCount: number;
	readonly meanMs: number;
	readonly medianMs: number;
	readonly p95Ms: number;
	readonly throughputMiBPerSecond: number | null;
}

interface MeasureOptions<T> {
	readonly warmup: number;
	readonly iterations: number;
	readonly bytesPerOperation?: number;
	readonly verify: (value: T) => void | Promise<void>;
}

export function parseBenchmarkArguments(): BenchmarkArguments {
	const { values } = parseArgs({
		options: {
			full: { type: "boolean", default: false },
			json: { type: "boolean", default: false },
			output: { type: "string" }
		},
		strict: true,
		allowPositionals: false
	});
	return Object.freeze({
		full: values.full,
		json: values.json,
		...(values.output === undefined ? {} : { output: values.output })
	});
}

export function deterministicBytes(length: number, factor = 31): Uint8Array {
	return Uint8Array.from({ length }, (_, index) => (index * factor + 17) & 0xff);
}

export function assertBytes(actual: unknown, expected: Uint8Array, label: string): void {
	assert.ok(actual instanceof Uint8Array, `${label}: output is not Uint8Array`);
	assert.equal(actual.length, expected.length, `${label}: byte length differs`);
	for (let index = 0; index < actual.length; index++) {
		assert.equal(actual[index], expected[index], `${label}: byte ${index} differs`);
	}
}

export function measureSync<T>(
	operation: () => T,
	options: MeasureOptions<T>
): Measurement {
	const verification = operation();
	const verified = options.verify(verification);
	assert.equal(verified, undefined, "sync benchmark verification returned a promise");
	for (let index = 0; index < options.warmup; index++) operation();
	const samples: number[] = [];
	for (let index = 0; index < options.iterations; index++) {
		const startedAt = performance.now();
		operation();
		samples.push(performance.now() - startedAt);
	}
	return summarize(samples, options, options.bytesPerOperation ?? 0);
}

export async function measureAsync<T>(
	operation: () => T | Promise<T>,
	options: MeasureOptions<T>
): Promise<Measurement> {
	await options.verify(await operation());
	for (let index = 0; index < options.warmup; index++) await operation();
	const samples: number[] = [];
	for (let index = 0; index < options.iterations; index++) {
		const startedAt = performance.now();
		await operation();
		samples.push(performance.now() - startedAt);
	}
	return summarize(samples, options, options.bytesPerOperation ?? 0);
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
	if (arguments_.json) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
	else printHuman();
}

export function formatMeasurement(measurement: Measurement): string {
	const throughput = measurement.throughputMiBPerSecond === null
		? ""
		: ` / ${measurement.throughputMiBPerSecond.toFixed(1)} MiB/s`;
	return (
		`${measurement.meanMs.toFixed(3)} ms mean / ` +
		`${measurement.medianMs.toFixed(3)} ms median / ` +
		`${measurement.p95Ms.toFixed(3)} ms P95${throughput}`
	);
}

export function joinBytes(chunks: readonly Uint8Array[]): Uint8Array {
	const output = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.length;
	}
	return output;
}

function summarize<T>(
	samples: readonly number[],
	options: MeasureOptions<T>,
	bytesPerOperation: number
): Measurement {
	assert.ok(samples.length > 0, "benchmark requires measured samples");
	const ordered = [...samples].sort((left, right) => left - right);
	const meanMs = samples.reduce((sum, value) => sum + value, 0) / samples.length;
	const middle = Math.floor(ordered.length / 2);
	const medianMs = ordered.length % 2 === 0
		? (ordered[middle - 1] + ordered[middle]) / 2
		: ordered[middle];
	const p95Ms = ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)];
	return Object.freeze({
		warmupCount: options.warmup,
		iterationCount: options.iterations,
		meanMs,
		medianMs,
		p95Ms,
		throughputMiBPerSecond: bytesPerOperation === 0 || meanMs === 0
			? null
			: (bytesPerOperation / (1024 * 1024)) / (meanMs / 1_000)
	});
}

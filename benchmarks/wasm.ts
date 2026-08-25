#!/usr/bin/env node

import {
	createWasmXorBinaryCipher,
	defaultBinaryProfile,
	fiseBinaryDecrypt,
	fiseBinaryEncrypt,
	withBinaryBackend,
	xorBinaryCipher
} from "../src/index.js";
import { FiseBinaryCipher } from "../src/types.js";

interface Stats {
	mean: number;
	median: number;
	p95: number;
	p99: number;
	standardDeviation: number;
	throughputMiBPerSecond: number | null;
}

interface Measurement {
	readonly iterations: number;
	readonly warmup: number;
	readonly stats: Stats;
}

function deterministicBytes(length: number, factor = 31): Uint8Array {
	return Uint8Array.from({ length }, (_, index) => (index * factor + 17) & 0xff);
}

function statsFor(times: readonly number[], bytesPerOperation: number): Stats {
	const sorted = [...times].sort((left, right) => left - right);
	const mean = times.reduce((total, time) => total + time, 0) / times.length;
	const middle = Math.floor(sorted.length / 2);
	const median = sorted.length % 2 === 0
		? (sorted[middle - 1] + sorted[middle]) / 2
		: sorted[middle];
	const percentile = (fraction: number): number =>
		sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
	const standardDeviation = Math.sqrt(
		times.reduce((sum, time) => sum + (time - mean) ** 2, 0) / times.length
	);
	return {
		mean,
		median,
		p95: percentile(0.95),
		p99: percentile(0.99),
		standardDeviation,
		throughputMiBPerSecond: bytesPerOperation === 0
			? null
			: mean === 0
				? Number.POSITIVE_INFINITY
				: (bytesPerOperation / (1024 * 1024)) / (mean / 1_000)
	};
}

function measure(
	operation: () => Uint8Array,
	iterations: number,
	bytesPerOperation: number,
	warmup = 20
): Measurement {
	let checksum = 0;
	for (let index = 0; index < warmup; index++) {
		const output = operation();
		checksum ^= output[0] ?? 0;
	}

	const times: number[] = [];
	for (let index = 0; index < iterations; index++) {
		const startedAt = performance.now();
		const output = operation();
		times.push(performance.now() - startedAt);
		checksum ^= output[0] ?? 0;
	}

	if (checksum === -1) console.log("unreachable");
	return { iterations, warmup, stats: statsFor(times, bytesPerOperation) };
}

async function measureCachedInstantiation(iterations: number): Promise<Measurement> {
	const warmup = 5;
	for (let index = 0; index < warmup; index++) await createWasmXorBinaryCipher();
	const times: number[] = [];
	for (let index = 0; index < iterations; index++) {
		const startedAt = performance.now();
		await createWasmXorBinaryCipher();
		times.push(performance.now() - startedAt);
	}
	return { iterations, warmup, stats: statsFor(times, 0) };
}

function benchmarkFullRoundTrip(
	input: Uint8Array,
	cipher: FiseBinaryCipher,
	iterations: number
): Measurement {
	const profile = withBinaryBackend(defaultBinaryProfile, cipher);
	return measure(() => {
		const envelope = fiseBinaryEncrypt(input, profile);
		return fiseBinaryDecrypt(envelope, profile);
	}, iterations, input.length);
}

function format(measurement: Measurement): string {
	const stats = measurement.stats;
	const timing = (
		`${stats.mean.toFixed(3)} ms mean / ${stats.median.toFixed(3)} ms median / ` +
		`${stats.p95.toFixed(3)} ms P95 / ${stats.p99.toFixed(3)} ms P99 / ` +
		`${stats.standardDeviation.toFixed(3)} ms SD`
	);
	return stats.throughputMiBPerSecond === null
		? timing
		: `${timing} / ${stats.throughputMiBPerSecond.toFixed(1)} MiB/s`;
}

async function main(): Promise<void> {
	const jsonOutput = process.argv.includes("--json");
	const compileStartedAt = performance.now();
	const wasmCipher = await createWasmXorBinaryCipher();
	const coldCompileAndFirstInstanceMs = performance.now() - compileStartedAt;
	const cachedInstantiation = await measureCachedInstantiation(50);
	const salt = deterministicBytes(67, 13);
	const results = [];

	for (const size of [1_024, 16_384, 262_144, 1_048_576]) {
		const input = deterministicBytes(size);
		const iterations = size <= 16_384 ? 2_000 : size <= 262_144 ? 300 : 100;
		const jsCipher = measure(
			() => xorBinaryCipher.encrypt(input, salt),
			iterations,
			input.length
		);
		const wasm = measure(
			() => wasmCipher.encrypt(input, salt),
			iterations,
			input.length
		);
		const fullIterations = Math.max(100, Math.floor(iterations / 5));
		const jsRoundTrip = benchmarkFullRoundTrip(input, xorBinaryCipher, fullIterations);
		const wasmRoundTrip = benchmarkFullRoundTrip(input, wasmCipher, fullIterations);
		const exampleEnvelope = fiseBinaryEncrypt(input, defaultBinaryProfile);
		results.push({
			payloadBytes: size,
			cipherIterations: iterations,
			fullRoundTripIterations: fullIterations,
			wire: {
				envelopeBytes: exampleEnvelope.length,
				additiveBytes: exampleEnvelope.length - input.length,
				expansionRatio: exampleEnvelope.length / input.length
			},
			jsCipher,
			wasmCipher: wasm,
			jsFullRoundTrip: jsRoundTrip,
			wasmFullRoundTrip: wasmRoundTrip
		});
	}

	const output = {
		schema: "fise.wasm-benchmark/1",
		runtime: process.version,
		platform: `${process.platform}-${process.arch}`,
		coldCompileAndFirstInstanceMs,
		cachedInstantiation,
		measurementScope: "raw xor-u8-v1 transform and complete binary FISE round trips",
		results
	};
	if (jsonOutput) {
		process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
		return;
	}

	console.log(`Node ${output.runtime}; ${output.platform}`);
	console.log(
		`WASM cold compile + first instance (single sample): ` +
		`${coldCompileAndFirstInstanceMs.toFixed(3)} ms`
	);
	console.log(`WASM cached instance creation: ${format(cachedInstantiation)}`);
	for (const result of results) {
		console.log(
			`\n${(result.payloadBytes / 1024).toFixed(0)} KiB ` +
			`(${result.cipherIterations} cipher / ${result.fullRoundTripIterations} full iterations)`
		);
		console.log(`  JS cipher:       ${format(result.jsCipher)}`);
		console.log(`  WASM cipher:     ${format(result.wasmCipher)}`);
		console.log(`  JS full R/T:     ${format(result.jsFullRoundTrip)}`);
		console.log(`  WASM full R/T:   ${format(result.wasmFullRoundTrip)}`);
		console.log(
			`  Binary wire:    ${result.wire.envelopeBytes} bytes / ` +
			`+${result.wire.additiveBytes} / ${result.wire.expansionRatio.toFixed(3)}x`
		);
	}
}

await main();

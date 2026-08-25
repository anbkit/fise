#!/usr/bin/env node

/**
 * FISE Performance Benchmark Suite
 *
 * Measures encrypt/decrypt performance across various payload sizes
 * and provides detailed statistics.
 */

import { fiseEncrypt, fiseDecrypt } from "../src/fiseEncrypt.js";
import { defaultStringProfile } from "../src/profiles/defaultStringProfile.js";

interface BenchmarkResult {
	size: number;
	iterations: number;
	warmup: number;
	encrypt: {
		mean: number;
		median: number;
		p95: number;
		p99: number;
		standardDeviation: number;
		min: number;
		max: number;
	};
	decrypt: {
		mean: number;
		median: number;
		p95: number;
		p99: number;
		standardDeviation: number;
		min: number;
		max: number;
	};
	throughput: {
		encrypt: number; // KB/s
		decrypt: number; // KB/s
	};
	wire: {
		envelopeBytes: number;
		additiveBytes: number;
		expansionRatio: number;
	};
}

function calculateStats(times: number[]): {
	mean: number;
	median: number;
	p95: number;
	p99: number;
	standardDeviation: number;
	min: number;
	max: number;
} {
	const sorted = [...times].sort((a, b) => a - b);
	const mean = times.reduce((a, b) => a + b, 0) / times.length;
	const middle = Math.floor(sorted.length / 2);
	const median = sorted.length % 2 === 0
		? (sorted[middle - 1] + sorted[middle]) / 2
		: sorted[middle];
	const percentile = (fraction: number): number =>
		sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
	const p95 = percentile(0.95);
	const p99 = percentile(0.99);
	const standardDeviation = Math.sqrt(
		times.reduce((sum, time) => sum + (time - mean) ** 2, 0) / times.length
	);
	const min = sorted[0];
	const max = sorted[sorted.length - 1];

	return { mean, median, p95, p99, standardDeviation, min, max };
}

function benchmark(
	size: number,
	iterations: number = 1000,
	warmup: number = 10
): BenchmarkResult {
	const plaintext = "A".repeat(size);

	// Warm up
	for (let i = 0; i < warmup; i++) {
		fiseEncrypt(plaintext, defaultStringProfile);
	}

	// Benchmark encrypt
	const encryptTimes: number[] = [];
	for (let i = 0; i < iterations; i++) {
		const start = process.hrtime.bigint();
		fiseEncrypt(plaintext, defaultStringProfile);
		const end = process.hrtime.bigint();
		encryptTimes.push(Number(end - start) / 1_000_000); // Convert to ms
	}

	// Get encrypted data for decrypt benchmark
	const encrypted = fiseEncrypt(plaintext, defaultStringProfile);

	// Warm up decrypt
	for (let i = 0; i < warmup; i++) {
		fiseDecrypt(encrypted, defaultStringProfile);
	}

	// Benchmark decrypt
	const decryptTimes: number[] = [];
	for (let i = 0; i < iterations; i++) {
		const start = process.hrtime.bigint();
		fiseDecrypt(encrypted, defaultStringProfile);
		const end = process.hrtime.bigint();
		decryptTimes.push(Number(end - start) / 1_000_000); // Convert to ms
	}

	const encryptStats = calculateStats(encryptTimes);
	const decryptStats = calculateStats(decryptTimes);

	// Calculate throughput (KB/s)
	const encryptThroughput = (size * 1000) / encryptStats.mean / 1024;
	const decryptThroughput = (size * 1000) / decryptStats.mean / 1024;

	return {
		size,
		iterations,
		warmup,
		encrypt: encryptStats,
		decrypt: decryptStats,
		throughput: {
			encrypt: encryptThroughput,
			decrypt: decryptThroughput
		},
		wire: {
			envelopeBytes: encrypted.length,
			additiveBytes: encrypted.length - size,
			expansionRatio: size === 0 ? 0 : encrypted.length / size
		}
	};
}

function formatNumber(num: number, decimals: number = 3): string {
	return num.toFixed(decimals);
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function printResults(results: BenchmarkResult[]): void {
	console.log("\n" + "=".repeat(80));
	console.log("FISE Performance Benchmark Results");
	console.log("=".repeat(80));
	console.log(`Node.js: ${process.version}`);
	console.log(`Platform: ${process.platform} ${process.arch}`);
	console.log(`Iterations per test: ${results[0]?.iterations || 0}`);
	console.log("=".repeat(80) + "\n");

	console.log("Encrypt Performance:");
	console.log("-".repeat(80));
	console.log(
		`${"Size".padEnd(12)} ${"Mean".padEnd(10)} ${"Median".padEnd(10)} ${"P95".padEnd(10)} ${"P99".padEnd(10)} ${"Std dev".padEnd(10)} ${"Throughput".padEnd(12)}`
	);
	console.log("-".repeat(80));
	for (const r of results) {
		console.log(
			`${formatBytes(r.size).padEnd(12)} ` +
			`${formatNumber(r.encrypt.mean).padEnd(10)}ms ` +
			`${formatNumber(r.encrypt.median).padEnd(10)}ms ` +
				`${formatNumber(r.encrypt.p95).padEnd(10)}ms ` +
				`${formatNumber(r.encrypt.p99).padEnd(10)}ms ` +
				`${formatNumber(r.encrypt.standardDeviation).padEnd(10)}ms ` +
				`${formatNumber(r.throughput.encrypt).padEnd(12)} KB/s`
		);
	}

	console.log("\nDecrypt Performance:");
	console.log("-".repeat(80));
	console.log(
		`${"Size".padEnd(12)} ${"Mean".padEnd(10)} ${"Median".padEnd(10)} ${"P95".padEnd(10)} ${"P99".padEnd(10)} ${"Std dev".padEnd(10)} ${"Throughput".padEnd(12)}`
	);
	console.log("-".repeat(80));
	for (const r of results) {
		console.log(
			`${formatBytes(r.size).padEnd(12)} ` +
			`${formatNumber(r.decrypt.mean).padEnd(10)}ms ` +
			`${formatNumber(r.decrypt.median).padEnd(10)}ms ` +
				`${formatNumber(r.decrypt.p95).padEnd(10)}ms ` +
				`${formatNumber(r.decrypt.p99).padEnd(10)}ms ` +
				`${formatNumber(r.decrypt.standardDeviation).padEnd(10)}ms ` +
				`${formatNumber(r.throughput.decrypt).padEnd(12)} KB/s`
		);
	}

	console.log("\nString wire size (ASCII input):");
	console.log("-".repeat(80));
	console.log(
		`${"Input".padEnd(12)} ${"Envelope".padEnd(12)} ${"Added".padEnd(12)} ${"Ratio".padEnd(12)}`
	);
	console.log("-".repeat(80));
	for (const result of results) {
		console.log(
			`${formatBytes(result.size).padEnd(12)} ` +
			`${formatBytes(result.wire.envelopeBytes).padEnd(12)} ` +
			`${formatBytes(result.wire.additiveBytes).padEnd(12)} ` +
			`${result.wire.expansionRatio.toFixed(3)}x`
		);
	}

	console.log("\n" + "=".repeat(80));
	console.log("Summary");
	console.log("=".repeat(80));
	console.log(
		`Smallest payload (${formatBytes(results[0]?.size || 0)}): ` +
		`Encrypt ${formatNumber(results[0]?.encrypt.mean || 0)}ms, ` +
		`Decrypt ${formatNumber(results[0]?.decrypt.mean || 0)}ms`
	);
	console.log(
		`Largest payload (${formatBytes(results[results.length - 1]?.size || 0)}): ` +
		`Encrypt ${formatNumber(results[results.length - 1]?.encrypt.mean || 0)}ms, ` +
		`Decrypt ${formatNumber(results[results.length - 1]?.decrypt.mean || 0)}ms`
	);
	console.log("=".repeat(80) + "\n");
}

function main() {
	const jsonOutput = process.argv.includes("--json");
	if (!jsonOutput) console.log("Running FISE benchmarks...\n");

	// Test different payload sizes
	const sizes = [100, 500, 1000, 5000, 10000, 50000];
	const iterations = 1000;

	const results: BenchmarkResult[] = [];

	for (const size of sizes) {
		if (!jsonOutput) process.stdout.write(`Benchmarking ${formatBytes(size)}... `);
		const result = benchmark(size, iterations);
		results.push(result);
		if (!jsonOutput) console.log("✓");
	}

	if (jsonOutput) {
		process.stdout.write(`${JSON.stringify({
			schema: "fise.string-benchmark/1",
			runtime: process.version,
			platform: `${process.platform}-${process.arch}`,
			measurementScope: "default string full encode and decode with ASCII payloads",
			results
		}, null, 2)}\n`);
		return;
	}
	printResults(results);
}

// Run if executed directly
if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('benchmark')) {
	main();
}

export { benchmark, BenchmarkResult };

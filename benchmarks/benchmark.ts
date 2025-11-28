#!/usr/bin/env node

/**
 * FISE Performance Benchmark Suite
 * 
 * Measures encrypt/decrypt performance across various payload sizes
 * and provides detailed statistics.
 */

import { encryptFise, decryptFise } from "./encryptFise.js";
import { xorCipher } from "./core/xorCipher.js";
import { defaultRules } from "./rules/defaultRules.js";
import { writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

interface BenchmarkResult {
	size: number;
	iterations: number;
	encrypt: {
		mean: number;
		median: number;
		p95: number;
		p99: number;
		min: number;
		max: number;
	};
	decrypt: {
		mean: number;
		median: number;
		p95: number;
		p99: number;
		min: number;
		max: number;
	};
	throughput: {
		encrypt: number; // KB/s
		decrypt: number; // KB/s
	};
}

function calculateStats(times: number[]): {
	mean: number;
	median: number;
	p95: number;
	p99: number;
	min: number;
	max: number;
} {
	const sorted = [...times].sort((a, b) => a - b);
	const mean = times.reduce((a, b) => a + b, 0) / times.length;
	const median = sorted[Math.floor(sorted.length / 2)];
	const p95 = sorted[Math.floor(sorted.length * 0.95)];
	const p99 = sorted[Math.floor(sorted.length * 0.99)];
	const min = sorted[0];
	const max = sorted[sorted.length - 1];

	return { mean, median, p95, p99, min, max };
}

function benchmark(
	size: number,
	iterations: number = 1000,
	warmup: number = 10
): BenchmarkResult {
	const plaintext = "A".repeat(size);

	// Warm up
	for (let i = 0; i < warmup; i++) {
		encryptFise(plaintext, xorCipher, defaultRules);
	}

	// Benchmark encrypt
	const encryptTimes: number[] = [];
	for (let i = 0; i < iterations; i++) {
		const start = process.hrtime.bigint();
		encryptFise(plaintext, xorCipher, defaultRules);
		const end = process.hrtime.bigint();
		encryptTimes.push(Number(end - start) / 1_000_000); // Convert to ms
	}

	// Get encrypted data for decrypt benchmark
	const encrypted = encryptFise(plaintext, xorCipher, defaultRules);

	// Warm up decrypt
	for (let i = 0; i < warmup; i++) {
		decryptFise(encrypted, xorCipher, defaultRules);
	}

	// Benchmark decrypt
	const decryptTimes: number[] = [];
	for (let i = 0; i < iterations; i++) {
		const start = process.hrtime.bigint();
		decryptFise(encrypted, xorCipher, defaultRules);
		const end = process.hrtime.bigint();
		decryptTimes.push(Number(end - start) / 1_000_000); // Convert to ms
	}

	const encryptStats = calculateStats(encryptTimes);
	const decryptStats = calculateStats(decryptTimes);

	// Calculate throughput (KB/s)
	const encryptThroughput = (size / encryptStats.mean) / 1024;
	const decryptThroughput = (size / decryptStats.mean) / 1024;

	return {
		size,
		iterations,
		encrypt: encryptStats,
		decrypt: decryptStats,
		throughput: {
			encrypt: encryptThroughput,
			decrypt: decryptThroughput
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
		`${"Size".padEnd(12)} ${"Mean".padEnd(10)} ${"Median".padEnd(10)} ${"P95".padEnd(10)} ${"P99".padEnd(10)} ${"Throughput".padEnd(12)}`
	);
	console.log("-".repeat(80));
	for (const r of results) {
		console.log(
			`${formatBytes(r.size).padEnd(12)} ` +
				`${formatNumber(r.encrypt.mean).padEnd(10)}ms ` +
				`${formatNumber(r.encrypt.median).padEnd(10)}ms ` +
				`${formatNumber(r.encrypt.p95).padEnd(10)}ms ` +
				`${formatNumber(r.encrypt.p99).padEnd(10)}ms ` +
				`${formatNumber(r.throughput.encrypt).padEnd(12)} KB/s`
		);
	}

	console.log("\nDecrypt Performance:");
	console.log("-".repeat(80));
	console.log(
		`${"Size".padEnd(12)} ${"Mean".padEnd(10)} ${"Median".padEnd(10)} ${"P95".padEnd(10)} ${"P99".padEnd(10)} ${"Throughput".padEnd(12)}`
	);
	console.log("-".repeat(80));
	for (const r of results) {
		console.log(
			`${formatBytes(r.size).padEnd(12)} ` +
				`${formatNumber(r.decrypt.mean).padEnd(10)}ms ` +
				`${formatNumber(r.decrypt.median).padEnd(10)}ms ` +
				`${formatNumber(r.decrypt.p95).padEnd(10)}ms ` +
				`${formatNumber(r.decrypt.p99).padEnd(10)}ms ` +
				`${formatNumber(r.throughput.decrypt).padEnd(12)} KB/s`
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

function updatePerformanceDoc(results: BenchmarkResult[]): void {
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = dirname(__filename);
	const perfPath = join(__dirname, "..", "docs", "PERFORMANCE.md");

	let content = readFileSync(perfPath, "utf-8");

	// Update the benchmark table
	const sizes = results.map((r) => r.size);
	const tableRows = results.map((r) => {
		const sizeLabel =
			r.size < 1024
				? `${r.size} chars`
				: r.size < 1024 * 1024
					? `${(r.size / 1024).toFixed(1)} KB`
					: `${(r.size / (1024 * 1024)).toFixed(1)} MB`;
		const encryptTime = formatNumber(r.encrypt.mean);
		const decryptTime = formatNumber(r.decrypt.mean);
		const totalTime = formatNumber(r.encrypt.mean + r.decrypt.mean);
		return `| ${sizeLabel.padEnd(12)} | ~${encryptTime.padEnd(8)} ms | ~${decryptTime.padEnd(8)} ms | ~${totalTime.padEnd(8)} ms |`;
	});

	const tableHeader = `| Payload Size | Encrypt (avg) | Decrypt (avg) | Total (avg) |`;
	const tableSeparator = `| ------------ | ------------- | ------------- | ----------- |`;
	const newTable = [tableHeader, tableSeparator, ...tableRows].join("\n");

	// Replace the existing table
	const tableRegex =
		/\| Payload Size \| Encrypt \(avg\) \| Decrypt \(avg\) \| Total \(avg\) \|\n\|[^\n]+\n(\|[^\n]+\n)+/;
	content = content.replace(tableRegex, newTable + "\n");

	// Update the timestamp/version info if there's a section for it
	const timestamp = new Date().toISOString().split("T")[0];
	const nodeVersion = process.version;
	const platform = `${process.platform} ${process.arch}`;

	// Add or update a "Last Updated" section
	if (content.includes("Last Updated")) {
		content = content.replace(
			/Last Updated:.*/,
			`Last Updated: ${timestamp} (Node ${nodeVersion}, ${platform})`
		);
	} else {
		// Add it after the first heading
		content = content.replace(
			/(## Sample benchmark[^\n]+\n)/,
			`$1\n> **Last Updated**: ${timestamp} (Node ${nodeVersion}, ${platform})\n\n`
		);
	}

	writeFileSync(perfPath, content, "utf-8");
	console.log(`\n✓ Updated ${perfPath}`);
}

function main() {
	console.log("Running FISE benchmarks...\n");

	// Test different payload sizes
	const sizes = [100, 500, 1000, 5000, 10000, 50000];
	const iterations = 1000;

	const results: BenchmarkResult[] = [];

	for (const size of sizes) {
		process.stdout.write(`Benchmarking ${formatBytes(size)}... `);
		const result = benchmark(size, iterations);
		results.push(result);
		console.log("✓");
	}

	printResults(results);

	// Update PERFORMANCE.md
	try {
		updatePerformanceDoc(results);
	} catch (error) {
		console.error("\n⚠ Warning: Could not update PERFORMANCE.md:", error);
	}
}

// Run if executed directly
if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('benchmark')) {
	main();
}

export { benchmark, BenchmarkResult };


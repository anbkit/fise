#!/usr/bin/env node

import assert from "node:assert/strict";
import { brotliCompressSync, gzipSync } from "node:zlib";

import { Fise } from "../dist/index.js";
import { canonicalJson } from "../dist/v2/codec.js";
import profile from "../tests/v2/profile-a.generated.mjs";
import {
	emitBenchmarkOutput,
	formatMeasurement,
	measureSync,
	parseBenchmarkArguments,
	type Measurement
} from "./shared.js";

interface StructuredSuite {
	readonly records: number;
	readonly canonicalJsonBytes: number;
	readonly fiseJsonBytes: number;
	readonly gzipCanonicalBytes: number;
	readonly gzipFiseBytes: number;
	readonly brotliCanonicalBytes: number;
	readonly brotliFiseBytes: number;
	readonly encrypt: Measurement;
	readonly decrypt: Measurement;
}

const arguments_ = parseBenchmarkArguments();
const fise = new Fise(profile);
const context = ["structured-transport"];
const recordCounts = arguments_.full ? [1, 10, 100, 1_000, 5_000] : [1, 100, 1_000];
const suites: StructuredSuite[] = [];

for (const records of recordCounts) {
	const value = structuredFixture(records);
	const canonical = canonicalJson(value);
	const envelope = fise.encrypt(value, context);
	assert.equal(typeof envelope, "string");
	const fiseJson = JSON.stringify({ data: envelope });
	const iterations = arguments_.full ? Math.max(8, Math.floor(10_000 / records)) : 12;
	const encrypt = measureSync(
		() => fise.encrypt(value, context),
		{
			warmup: 2,
			iterations,
			bytesPerOperation: Buffer.byteLength(canonical),
			verify: output => assert.equal(typeof output, "string")
		}
	);
	const decrypt = measureSync(
		() => fise.decrypt(envelope, context),
		{
			warmup: 2,
			iterations,
			bytesPerOperation: Buffer.byteLength(canonical),
			verify: output => assert.deepEqual(output, value)
		}
	);
	suites.push({
		records,
		canonicalJsonBytes: Buffer.byteLength(canonical),
		fiseJsonBytes: Buffer.byteLength(fiseJson),
		gzipCanonicalBytes: gzipSync(canonical).length,
		gzipFiseBytes: gzipSync(fiseJson).length,
		brotliCanonicalBytes: brotliCompressSync(canonical).length,
		brotliFiseBytes: brotliCompressSync(fiseJson).length,
		encrypt,
		decrypt
	});
}

const output = {
	schema: "fise.structured-transport-benchmark/2",
	runtime: process.version,
	platform: `${process.platform}-${process.arch}`,
	mode: arguments_.full ? "full" : "default",
	measurementBoundary:
		"canonical structured JSON versus adaptive FISE Base64URL inside one JSON field",
	limitations: [
		"local deterministic fixture only",
		"gzip and Brotli sizes are transport comparisons, not latency measurements",
		"compression ratio depends on application data"
	],
	suites
};

emitBenchmarkOutput(arguments_, output, () => {
	console.log(`FISE 2.0 structured transport benchmark (${output.mode})`);
	for (const suite of suites) {
		console.log(`\n${suite.records} records / ${suite.canonicalJsonBytes} canonical JSON bytes`);
		console.log(
			`  transfer: raw ${suite.canonicalJsonBytes}, FISE JSON ${suite.fiseJsonBytes}, ` +
			`gzip ${suite.gzipCanonicalBytes}/${suite.gzipFiseBytes}, ` +
			`Brotli ${suite.brotliCanonicalBytes}/${suite.brotliFiseBytes}`
		);
		console.log(`  encrypt:  ${formatMeasurement(suite.encrypt)}`);
		console.log(`  decrypt:  ${formatMeasurement(suite.decrypt)}`);
	}
});

function structuredFixture(recordCount: number) {
	return {
		records: Array.from({ length: recordCount }, (_, index) => ({
			amount: ((index * 104_729) % 100_000) / 100,
			createdAt:
				`2026-08-${String(index % 28 + 1).padStart(2, "0")}T` +
				`${String(index % 24).padStart(2, "0")}:` +
				`${String(index % 60).padStart(2, "0")}:00Z`,
			description:
				`Order ${index} contains catalog item ${(index * 37) % 997} ` +
				`for region ${index % 17}`,
			id: `ord_${index.toString(36).padStart(8, "0")}`,
			status: ["ready", "pending", "shipped", "cancelled"][index % 4],
			userId: `user_${((index * 7_919) % 100_003).toString(36)}`
		}))
	};
}

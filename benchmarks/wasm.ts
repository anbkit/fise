#!/usr/bin/env node

import { Fise } from "../dist/index.js";
import profile from "../tests/v2/profile-a.generated.mjs";
import {
	assertBytes,
	deterministicBytes,
	emitBenchmarkOutput,
	formatMeasurement,
	measureSync,
	parseBenchmarkArguments,
	type Measurement
} from "./shared.js";

interface WasmResult {
	readonly payloadBytes: number;
	readonly javascriptRoundTrip: Measurement;
	readonly wasmRoundTrip: Measurement;
}

const arguments_ = parseBenchmarkArguments();
const javascript = new Fise(profile);
const compileStartedAt = performance.now();
const wasm = await javascript.withWasm();
const compileAndInstantiateMs = performance.now() - compileStartedAt;
const context = ["wasm"];
const sizes = arguments_.full
	? [16_384, 262_144, 1_048_576, 4_194_304]
	: [16_384, 262_144, 1_048_576];
const results: WasmResult[] = [];

for (const size of sizes) {
	const input = deterministicBytes(size, 37);
	const iterations = arguments_.full ? 20 : 12;
	const warmup = 3;
	const javascriptRoundTrip = measureSync(
		() => javascript.decrypt(javascript.encrypt(input, context), context),
		{
			warmup,
			iterations,
			bytesPerOperation: input.length,
			verify: value => assertBytes(value, input, "JavaScript round trip")
		}
	);
	const wasmRoundTrip = measureSync(
		() => wasm.decrypt(wasm.encrypt(input, context), context),
		{
			warmup,
			iterations,
			bytesPerOperation: input.length,
			verify: value => assertBytes(value, input, "WASM round trip")
		}
	);
	assertBytes(wasm.decrypt(javascript.encrypt(input, context), context), input, "JS to WASM");
	assertBytes(javascript.decrypt(wasm.encrypt(input, context), context), input, "WASM to JS");
	results.push({ payloadBytes: size, javascriptRoundTrip, wasmRoundTrip });
}

const output = {
	schema: "fise.wasm-benchmark/2",
	runtime: process.version,
	platform: `${process.platform}-${process.arch}`,
	mode: arguments_.full ? "full" : "default",
	compileAndInstantiateMs,
	measurementBoundary: "complete FISE 2.0 round trips using one generated JS or WASM profile kernel",
	results
};

emitBenchmarkOutput(arguments_, output, () => {
	console.log(`FISE 2.0 generated WASM benchmark (${output.mode})`);
	console.log(`Compile + instantiate: ${compileAndInstantiateMs.toFixed(3)} ms`);
	for (const result of results) {
		console.log(`\n${result.payloadBytes} bytes`);
		console.log(`  JavaScript: ${formatMeasurement(result.javascriptRoundTrip)}`);
		console.log(`  WASM:       ${formatMeasurement(result.wasmRoundTrip)}`);
	}
});

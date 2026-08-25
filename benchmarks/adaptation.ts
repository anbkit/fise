#!/usr/bin/env node

import {
	defineBinaryProfile,
	fiseBinaryDecrypt,
	fiseBinaryEncrypt,
	xorBinaryCipher
} from "../src/index.js";
import { fiseJsonDecrypt, fiseJsonEncrypt } from "../src/http.js";

interface Stats {
	meanMs: number;
	medianMs: number;
	p95Ms: number;
	p99Ms: number;
	standardDeviationMs: number;
	operationsPerSecond: number;
}

const VERSIONED_JSON_MAGIC = Uint8Array.from([0x56, 0x4a, 0x53, 0x4e, 0x01]);

const profileA = defineBinaryProfile({
	id: "benchmark.catalog.a",
	representation: "binary",
	transform: xorBinaryCipher,
	layout: {
		markerSize: 2,
		saltRange: { min: 16, max: 16 },
		offset(input) {
			return (input.transformedLength * 7) % (input.transformedLength || 1);
		},
		createMarker(input) {
			return Uint8Array.from([input.saltLength >>> 8, input.saltLength & 0xff]);
		}
	}
});

const profileB = defineBinaryProfile({
	...profileA,
	id: "benchmark.catalog.b",
	layout: {
		...profileA.layout,
		offset(input) {
			return (
				input.transformedLength * 13 + input.saltLength * 3
			) % (input.transformedLength || 1);
		}
	}
});

function measure(operation: () => unknown, iterations: number): Stats {
	for (let index = 0; index < 20; index++) operation();
	const samples: number[] = [];
	for (let index = 0; index < iterations; index++) {
		const startedAt = performance.now();
		operation();
		samples.push(performance.now() - startedAt);
	}
	samples.sort((left, right) => left - right);
	const meanMs = samples.reduce((sum, value) => sum + value, 0) / samples.length;
	const middle = Math.floor(samples.length / 2);
	const medianMs = samples.length % 2 === 0
		? (samples[middle - 1] + samples[middle]) / 2
		: samples[middle];
	const percentile = (fraction: number): number =>
		samples[Math.min(samples.length - 1, Math.max(0, Math.ceil(samples.length * fraction) - 1))];
	const standardDeviationMs = Math.sqrt(
		samples.reduce((sum, value) => sum + (value - meanMs) ** 2, 0) / samples.length
	);
	return {
		meanMs,
		medianMs,
		p95Ms: percentile(0.95),
		p99Ms: percentile(0.99),
		standardDeviationMs,
		operationsPerSecond: 1_000 / meanMs
	};
}

function createVersionedJsonEnvelope(json: string): Uint8Array {
	const body = new TextEncoder().encode(json);
	const envelope = new Uint8Array(VERSIONED_JSON_MAGIC.length + 4 + body.length);
	envelope.set(VERSIONED_JSON_MAGIC);
	new DataView(envelope.buffer).setUint32(VERSIONED_JSON_MAGIC.length, body.length, false);
	envelope.set(body, VERSIONED_JSON_MAGIC.length + 4);
	return envelope;
}

function parseVersionedJsonEnvelope(envelope: Uint8Array): unknown {
	if (
		envelope.length < VERSIONED_JSON_MAGIC.length + 4 ||
		!VERSIONED_JSON_MAGIC.every((byte, index) => envelope[index] === byte)
	) {
		throw new Error("invalid versioned JSON envelope");
	}
	const bodyStart = VERSIONED_JSON_MAGIC.length + 4;
	const declaredLength = new DataView(
		envelope.buffer,
		envelope.byteOffset,
		envelope.byteLength
	).getUint32(VERSIONED_JSON_MAGIC.length, false);
	if (envelope.length !== bodyStart + declaredLength) {
		throw new Error("versioned JSON envelope length mismatch");
	}
	return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(envelope.subarray(bodyStart)));
}

function main(): void {
	const value = {
		items: Array.from({ length: 500 }, (_, index) => ({
			id: index,
			name: `catalog-item-${index}`,
			available: index % 3 !== 0
		}))
	};
	const json = JSON.stringify(value);
	const base64 = Buffer.from(json, "utf8").toString("base64");
	const versionedJson = createVersionedJsonEnvelope(json);
	const envelopeA = fiseJsonEncrypt(value, profileA);
	const envelopeB = fiseJsonEncrypt(value, profileB);
	const iterations = 500;

	let staleProfileRejected = false;
	try {
		fiseBinaryDecrypt(envelopeB, profileA);
	} catch (error) {
		staleProfileRejected = (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			error.code === "PROFILE_MISMATCH"
		);
	}

	const result = {
		schema: "fise.adaptation-benchmark/1",
		runtime: process.version,
		platform: `${process.platform}-${process.arch}`,
		payloadBytes: Buffer.byteLength(json),
		iterations,
		measurementScope: "runtime decoding and JSON parsing with an already implemented decoder",
		warmupIterations: 20,
		notMeasured: [
			"human reverse-engineering time",
			"time to locate or hook the official client decoder",
			"profile rollout operational cost"
		],
		profiles: {
			from: profileA.id,
			to: profileB.id,
			staleProfileRejected
		},
		wireBytes: {
			plainJson: Buffer.byteLength(json),
			base64Json: Buffer.byteLength(base64),
			versionedBinaryJson: versionedJson.length,
			fiseProfileA: envelopeA.length,
			fiseProfileB: envelopeB.length
		},
		results: {
			plainJson: measure(() => JSON.parse(json), iterations),
			base64Json: measure(
				() => JSON.parse(Buffer.from(base64, "base64").toString("utf8")),
				iterations
			),
			versionedBinaryJson: measure(
				() => parseVersionedJsonEnvelope(versionedJson),
				iterations
			),
			fiseKnownProfileA: measure(() => fiseJsonDecrypt(envelopeA, profileA), iterations),
			fiseKnownProfileB: measure(() => fiseJsonDecrypt(envelopeB, profileB), iterations)
		}
	};

	if (process.argv.includes("--json")) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}
	console.log("FISE adaptation benchmark");
	console.log(`Payload: ${result.payloadBytes} bytes; iterations: ${iterations}`);
	console.log(`Stale profile rejected: ${staleProfileRejected}`);
	for (const [name, stats] of Object.entries(result.results)) {
		console.log(
			`${name}: ${stats.meanMs.toFixed(3)} ms mean / ` +
			`${stats.medianMs.toFixed(3)} ms median / ` +
			`${stats.p95Ms.toFixed(3)} ms P95 / ${stats.p99Ms.toFixed(3)} ms P99 / ` +
			`${stats.standardDeviationMs.toFixed(3)} ms SD / ` +
			`${stats.operationsPerSecond.toFixed(0)} ops/s`
		);
	}
	console.log(`Wire bytes: ${JSON.stringify(result.wireBytes)}`);
	console.log("Scope: runtime cost only; this does not measure human attacker effort.");
}

main();

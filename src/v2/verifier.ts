import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { FiseError } from "../errors.js";
import { bytesEqual } from "./bytes.js";
import { Fise, setFiseClockForTesting } from "./fise.js";
import { Profile } from "./profile.js";
import type { FiseContext, FiseValue } from "./types.js";

const MAX_PROFILE_SOURCE_BYTES = 2 * 1024 * 1024;
const PROFILE_IMPORT = 'import { Profile } from "fise/profile-runtime";';
const GENERATED_PREFIX = `${PROFILE_IMPORT}\n\nexport default Profile.generated(\n`;
const COMMENT_SYNTAX = /\/\/|\/\*/;
const PROFILE_EXTENSIONS = new Set([".js", ".mjs", ".mts", ".ts"]);
const CHECKS = Object.freeze([
	"text Base64URL encrypt/decrypt",
	"adaptive structured Base64URL encrypt/decrypt",
	"binary encrypt/decrypt",
	"empty/default context",
	"context",
	"TTL",
	"binary range/progressive",
	"binary edge mode",
	"JavaScript",
	"WASM",
	"workers"
]);

export interface ProfileVerification {
	readonly fingerprint: string;
	readonly checks: readonly string[];
}

export function resolveProfilePath(path: string, label = "profile path"): string {
	if (typeof path !== "string" || path.trim() === "") {
		throw new FiseError("INVALID_INPUT", `FISE CLI: ${label} must not be empty.`);
	}
	const absolutePath = resolve(path);
	const lowerPath = absolutePath.toLowerCase();
	if (lowerPath.endsWith(".d.ts") || lowerPath.endsWith(".d.mts")) {
		throw new FiseError(
			"INVALID_INPUT",
			"FISE CLI: declaration files are not executable profiles; use .js, .mjs, .mts, or .ts."
		);
	}
	if (!PROFILE_EXTENSIONS.has(extname(absolutePath).toLowerCase())) {
		throw new FiseError(
			"INVALID_INPUT",
			"FISE CLI: profile files must use .js, .mjs, .mts, or .ts."
		);
	}
	return absolutePath;
}

export async function verifyProfileFile(path: string): Promise<ProfileVerification> {
	const absolutePath = resolveProfilePath(path);
	let bytes: Uint8Array;
	try {
		bytes = readFileSync(absolutePath);
	} catch (error) {
		throw new FiseError(
			"INVALID_INPUT",
			`FISE CLI: unable to read profile '${absolutePath}'.`,
			error
		);
	}
	if (bytes.length > MAX_PROFILE_SOURCE_BYTES) {
		throw new FiseError("INVALID_PROFILE", "FISE CLI: generated profile source exceeds 2 MiB.");
	}
	let source: string;
	try {
		source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch (error) {
		throw new FiseError("INVALID_PROFILE", "FISE CLI: profile source is not valid UTF-8.", error);
	}
	return verifyProfileSource(source);
}

export async function verifyProfileSource(source: string): Promise<ProfileVerification> {
	return verifyProfile(await loadGeneratedProfileSource(source));
}

/** @internal Loads only the canonical generated JavaScript source shape. */
export async function loadGeneratedProfileSource(source: string): Promise<Profile> {
	if (typeof source !== "string" || Buffer.byteLength(source, "utf8") > MAX_PROFILE_SOURCE_BYTES) {
		throw new FiseError("INVALID_PROFILE", "FISE CLI: generated profile source is invalid or too large.");
	}
	if (
		!source.startsWith(GENERATED_PREFIX) ||
		countOccurrences(source, PROFILE_IMPORT) !== 1 ||
		COMMENT_SYNTAX.test(source)
	) {
		throw new FiseError(
			"INVALID_PROFILE",
			"FISE CLI: file is not a recognized FISE 2.0 generated profile."
		);
	}
	const runtimeUrl = new URL("../profileRuntime.js", import.meta.url).href;
	const executableSource = source.replace(
		PROFILE_IMPORT,
		`import { Profile } from ${JSON.stringify(runtimeUrl)};`
	);
	let module: Record<string, unknown>;
	try {
		const sourceUrl = `data:text/javascript;base64,${Buffer.from(executableSource).toString("base64")}`;
		module = (await import(sourceUrl)) as Record<string, unknown>;
	} catch (error) {
		throw new FiseError("INVALID_PROFILE", "FISE CLI: unable to load generated profile.", error);
	}
	if (Object.keys(module).length !== 1 || !(module.default instanceof Profile)) {
		throw new FiseError(
			"INVALID_PROFILE",
			"FISE CLI: generated module must export exactly one default Profile instance."
		);
	}
	return module.default;
}

async function verifyProfile(profile: Profile): Promise<ProfileVerification> {
	const context = randomVerificationContext();
	const sequence = context[context.length - 2] as number;
	const alternateContext = Object.freeze([
		...context.slice(0, -2),
		(sequence + 1) >>> 0,
		context[context.length - 1]
	]) as FiseContext;
	let activeCheck = "profile initialization";
	try {
		const javascript = new Fise(profile);
		const edgeJavascript = new Fise(profile, {
			binary: { mode: "edges", edgeBytes: 1_024 }
		});
		const text = "FISE verification: Việt Nam ✓ こんにちは 🚀";
		const structured = Object.freeze({
			active: true,
			message: text,
			records: Object.freeze(Array.from({ length: 24 }, (_, index) => Object.freeze({
				id: `verification_${index}`,
				resource: "generated-profile",
				status: index % 2 === 0 ? "ready" : "pending"
			}))),
			sequence,
			values: Object.freeze([null, 0, 255, false])
		});
		const binary = Uint8Array.from(
			{ length: 8_193 },
			(_, index) => (index * 73 + 19) & 0xff
		);

		activeCheck = "JavaScript text Base64URL encrypt/decrypt";
		const textEnvelope = javascript.encrypt(text, context);
		assertCanonicalBase64Url(textEnvelope, activeCheck);
		assertSame(javascript.decrypt(textEnvelope, context), text, activeCheck);
		assertEncryptedEqual(javascript.encrypt(text, context), textEnvelope, "text reproduction");

		activeCheck = "JavaScript structured Base64URL encrypt/decrypt";
		const structuredEnvelope = javascript.encrypt(structured, context);
		assertCanonicalBase64Url(structuredEnvelope, activeCheck);
		assertSame(javascript.decrypt(structuredEnvelope, context), structured, activeCheck);
		assertEncryptedEqual(
			javascript.encrypt(structured, context),
			structuredEnvelope,
			"structured reproduction"
		);

		activeCheck = "JavaScript binary encrypt/decrypt";
		const binaryEnvelope = javascript.encrypt(binary, context);
		assertSame(javascript.decrypt(binaryEnvelope, context), binary, activeCheck);
		assertBytesEqual(javascript.encrypt(binary, context), binaryEnvelope, "binary reproduction");

		activeCheck = "empty values with default context";
		const emptyTextEnvelope = javascript.encrypt("");
		assertSame(javascript.decrypt(emptyTextEnvelope), "", "empty text encrypt/decrypt");
		assertEncryptedEqual(javascript.encrypt(""), emptyTextEnvelope, "empty text reproduction");
		const emptyBinary = new Uint8Array(0);
		const emptyBinaryEnvelope = javascript.encrypt(emptyBinary);
		assertSame(javascript.decrypt(emptyBinaryEnvelope), emptyBinary, "empty binary encrypt/decrypt");
		assertBytesEqual(javascript.encrypt(emptyBinary), emptyBinaryEnvelope, "empty binary reproduction");
		assertSame(
			javascript.decryptRange(emptyBinaryEnvelope, { start: 0, endExclusive: 0 }),
			emptyBinary,
			"empty binary range"
		);
		let emptyChunkCount = 0;
		for await (const _chunk of javascript.decryptProgressive(emptyBinaryEnvelope)) {
			emptyChunkCount++;
		}
		if (emptyChunkCount !== 0) throw new Error("empty binary emitted a progressive chunk");

		activeCheck = "context binding";
		if (javascript.encrypt(text, alternateContext) === textEnvelope) {
			throw new Error("alternate context produced the same text envelope");
		}
		let wrongContextRejected = false;
		try {
			javascript.decrypt(textEnvelope, alternateContext);
		} catch {
			wrongContextRejected = true;
		}
		if (!wrongContextRejected) throw new Error("alternate context was accepted");

		activeCheck = "TTL structured and selective binary restoration";
		const expiring = new Fise(profile, { ttlSeconds: 60 });
		setFiseClockForTesting(expiring, () => 1_800_000_000_000);
		assertSame(
			expiring.decrypt(expiring.encrypt(structured, context), context),
			structured,
			"TTL structured restore"
		);
		const expiringBinary = expiring.encrypt(binary, context);
		assertSame(
			expiring.decryptRange(expiringBinary, { start: 511, endExclusive: 4_097 }, context),
			binary.slice(511, 4_097),
			"TTL binary range restore"
		);

		activeCheck = "ordinary binary range/progressive restoration";
		assertSame(
			javascript.decryptRange(binaryEnvelope, { start: 511, endExclusive: 4_097 }, context),
			binary.slice(511, 4_097),
			"binary range restore"
		);
		const progressive: Uint8Array[] = [];
		for await (const chunk of javascript.decryptProgressive(binaryEnvelope, context, {
			chunkSize: 513
		})) {
			progressive.push(chunk);
		}
		assertSame(joinBytes(progressive), binary, "binary progressive restore");

		activeCheck = "binary edge-mode full/range/progressive restoration";
		const edgeEnvelope = edgeJavascript.encrypt(binary, context);
		assertSame(javascript.decrypt(edgeEnvelope, context), binary, "binary edge full restore");
		assertSame(
			javascript.decryptRange(edgeEnvelope, { start: 900, endExclusive: 7_200 }, context),
			binary.slice(900, 7_200),
			"binary edge range restore"
		);
		const edgeChunks: Uint8Array[] = [];
		for await (const chunk of javascript.decryptProgressive(edgeEnvelope, context, {
			chunkSize: 777
		})) {
			edgeChunks.push(chunk);
		}
		assertSame(joinBytes(edgeChunks), binary, "binary edge progressive restore");

		activeCheck = "JavaScript/WASM bidirectional data";
		const wasm = await javascript.withWasm();
		const edgeWasm = await edgeJavascript.withWasm();
		assertSame(wasm.decrypt(textEnvelope, context), text, "JavaScript to WASM text");
		assertSame(javascript.decrypt(wasm.encrypt(text, context), context), text, "WASM to JavaScript text");
		assertSame(wasm.decrypt(structuredEnvelope, context), structured, "JavaScript to WASM structured");
		const wasmStructuredEnvelope = wasm.encrypt(structured, context);
		assertSame(javascript.decrypt(wasmStructuredEnvelope, context), structured, "WASM to JavaScript structured");
		assertEncryptedEqual(wasmStructuredEnvelope, structuredEnvelope, "JavaScript/WASM structured parity");
		assertSame(wasm.decrypt(binaryEnvelope, context), binary, "JavaScript to WASM binary");
		assertSame(wasm.decrypt(edgeEnvelope, context), binary, "JavaScript edge mode to WASM");
		assertSame(javascript.decrypt(wasm.encrypt(binary, context), context), binary, "WASM to JavaScript binary");
		const wasmEdgeEnvelope = edgeWasm.encrypt(binary, context);
		assertEncryptedEqual(wasmEdgeEnvelope, edgeEnvelope, "JavaScript/WASM edge wire parity");
		assertSame(javascript.decrypt(wasmEdgeEnvelope, context), binary, "WASM edge to JavaScript");
		assertSame(
			wasm.decryptRange(binaryEnvelope, { start: 701, endExclusive: 5_123 }, context),
			binary.slice(701, 5_123),
			"WASM binary range"
		);
		assertSame(
			wasm.decryptRange(edgeEnvelope, { start: 701, endExclusive: 5_123 }, context),
			binary.slice(701, 5_123),
			"WASM edge binary range"
		);
		const wasmEdgeChunks: Uint8Array[] = [];
		for await (const chunk of wasm.decryptProgressive(edgeEnvelope, context, {
			chunkSize: 777
		})) {
			wasmEdgeChunks.push(chunk);
		}
		assertSame(joinBytes(wasmEdgeChunks), binary, "WASM edge binary progressive restore");

		activeCheck = "JavaScript/worker bidirectional data and selective binary restore";
		const parallel = await javascript.parallel({ workerCount: 2, minimumParallelBytes: 0 });
		const edgeParallel = await edgeJavascript.parallel({ workerCount: 2, minimumParallelBytes: 0 });
		try {
			assertSame(await parallel.decrypt(textEnvelope, context), text, "JavaScript to worker text");
			assertSame(javascript.decrypt(await parallel.encrypt(text, context), context), text, "worker to JavaScript text");
			assertSame(await parallel.decrypt(structuredEnvelope, context), structured, "JavaScript to worker structured");
			const workerStructuredEnvelope = await parallel.encrypt(structured, context);
			assertSame(javascript.decrypt(workerStructuredEnvelope, context), structured, "worker to JavaScript structured");
			assertEncryptedEqual(workerStructuredEnvelope, structuredEnvelope, "JavaScript/worker structured parity");
			assertSame(await parallel.decrypt(binaryEnvelope, context), binary, "JavaScript to worker binary");
			assertSame(await parallel.decrypt(edgeEnvelope, context), binary, "JavaScript edge mode to worker");
			assertSame(javascript.decrypt(await parallel.encrypt(binary, context), context), binary, "worker to JavaScript binary");
			const workerEdgeEnvelope = await edgeParallel.encrypt(binary, context);
			assertEncryptedEqual(
				workerEdgeEnvelope,
				edgeEnvelope,
				"JavaScript/worker edge wire parity"
			);
			assertSame(
				javascript.decrypt(workerEdgeEnvelope, context),
				binary,
				"worker edge to JavaScript"
			);
			assertSame(
				await parallel.decryptRange(binaryEnvelope, { start: 333, endExclusive: 7_777 }, context),
				binary.slice(333, 7_777),
				"worker binary range"
			);
			assertSame(
				await parallel.decryptRange(
					edgeEnvelope,
					{ start: 333, endExclusive: 7_777 },
					context
				),
				binary.slice(333, 7_777),
				"worker edge binary range"
			);
			const workerChunks: Uint8Array[] = [];
			for await (const chunk of parallel.decryptProgressive(binaryEnvelope, context, {
				chunkSize: 777
			})) {
				workerChunks.push(chunk);
			}
			assertSame(joinBytes(workerChunks), binary, "worker binary progressive restore");
			const workerEdgeChunks: Uint8Array[] = [];
			for await (const chunk of parallel.decryptProgressive(edgeEnvelope, context, {
				chunkSize: 777
			})) {
				workerEdgeChunks.push(chunk);
			}
			assertSame(
				joinBytes(workerEdgeChunks),
				binary,
				"worker edge binary progressive restore"
			);
		} finally {
			await parallel.close();
			await edgeParallel.close();
		}

		return Object.freeze({ fingerprint: profile.fingerprint, checks: CHECKS });
	} catch (error) {
		throw new FiseError(
			"INVALID_PROFILE",
			`FISE CLI: verification failed during ${activeCheck}; synthetic context ${JSON.stringify(context)}.`,
			error
		);
	}
}

function randomVerificationContext(): FiseContext {
	const entropy = randomBytes(24);
	const view = new DataView(entropy.buffer, entropy.byteOffset, entropy.byteLength);
	return Object.freeze([
		`session_${hex(entropy.subarray(0, 6))}`,
		`user_${hex(entropy.subarray(6, 10))}`,
		`tenant_${hex(entropy.subarray(10, 14))}`,
		view.getUint32(14, false),
		"fise:verify:v1",
		view.getUint32(18, false),
		entropy[22] % 2 === 0
	]);
}

function assertSame(actual: FiseValue, expected: unknown, label: string): void {
	if (actual instanceof Uint8Array && expected instanceof Uint8Array) {
		assertBytesEqual(actual, expected, label);
		return;
	}
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} did not restore the original value`);
	}
}

function assertCanonicalBase64Url(value: string, label: string): void {
	if (!/^[A-Za-z0-9_-]+$/.test(value) || value.includes("=")) {
		throw new Error(`${label} did not produce canonical unpadded Base64URL`);
	}
}

function assertEncryptedEqual(
	actual: string | Uint8Array,
	expected: string | Uint8Array,
	label: string
): void {
	if (typeof actual === "string" || typeof expected === "string") {
		if (actual !== expected) throw new Error(`${label} differs`);
		return;
	}
	assertBytesEqual(actual, expected, label);
}

function assertBytesEqual(actual: Uint8Array, expected: Uint8Array, label: string): void {
	if (!bytesEqual(actual, expected)) throw new Error(`${label} bytes differ`);
}

function joinBytes(chunks: readonly Uint8Array[]): Uint8Array {
	const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const output = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.length;
	}
	return output;
}

function countOccurrences(source: string, token: string): number {
	return source.split(token).length - 1;
}

function hex(bytes: Uint8Array): string {
	return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

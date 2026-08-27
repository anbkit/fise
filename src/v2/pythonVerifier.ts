import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FiseError } from "../errors.js";
import { Fise, setFiseClockForTesting } from "./fise.js";
import type { Profile } from "./profile.js";
import type { FiseContext, FiseValue } from "./types.js";
import {
	loadGeneratedProfileSource,
	type ProfileVerification
} from "./verifier.js";

const MAX_PROFILE_SOURCE_BYTES = 2 * 1024 * 1024;
const pythonSourceRoot = fileURLToPath(new URL("../../python/src/", import.meta.url));

interface PythonCommand {
	readonly executable: string;
	readonly prefix: readonly string[];
}

interface VerificationCase {
	readonly id: string;
	readonly kind: "json" | "binary";
	readonly input?: unknown;
	readonly inputHex?: string;
	readonly context?: readonly unknown[];
	readonly wrongContext?: readonly unknown[];
	readonly options?: Readonly<{
		ttlSeconds?: number;
		binary?: Readonly<{ mode: "edges"; edgeBytes: number }>;
	}>;
	readonly clockMilliseconds?: number;
	readonly expectedTransport?: string;
	readonly wireHex?: string;
	readonly range?: Readonly<{
		start: number;
		endExclusive: number;
		expectedHex: string;
	}>;
	readonly progressive?: Readonly<{
		chunkSize: number;
		expectedChunksHex: readonly string[];
	}>;
}

interface PythonVerificationOutput {
	readonly fingerprint: string;
	readonly checks: readonly string[];
}

/** @internal Verifies one Python profile without requiring its JavaScript pair. */
export function verifyPythonProfileFile(path: string): ProfileVerification {
	const absolutePath = resolvePythonProfilePath(path);
	let source: string;
	try {
		source = readFileSync(absolutePath, "utf8");
	} catch (error) {
		throw new FiseError(
			"INVALID_INPUT",
			`FISE CLI: unable to read Python profile '${absolutePath}'.`,
			error
		);
	}
	return verifyPythonProfileSource(source);
}

export function resolvePythonProfilePath(path: string): string {
	if (typeof path !== "string" || path.trim() === "") {
		throw new FiseError("INVALID_INPUT", "FISE CLI: Python profile path must not be empty.");
	}
	const absolutePath = resolve(path);
	if (extname(absolutePath).toLowerCase() !== ".py") {
		throw new FiseError("INVALID_INPUT", "FISE CLI: Python profile files must use .py.");
	}
	return absolutePath;
}

/** @internal Verifies generated Python source with native round trips. */
export function verifyPythonProfileSource(
	source: string,
	expectedFingerprint?: string,
	expectedCases?: readonly VerificationCase[]
): ProfileVerification {
	if (typeof source !== "string" || Buffer.byteLength(source, "utf8") > MAX_PROFILE_SOURCE_BYTES) {
		throw new FiseError("INVALID_PROFILE", "FISE CLI: Python profile source is invalid or too large.");
	}
	const output = runPythonVerifier(
		source,
		expectedFingerprint,
		expectedCases ?? baseVerificationCases()
	);
	if (
		typeof output.fingerprint !== "string" ||
		!Array.isArray(output.checks) ||
		output.checks.length === 0 ||
		output.checks.some(check => typeof check !== "string" || check.length === 0)
	) {
		throw new FiseError("INVALID_PROFILE", "FISE CLI: Python verifier returned invalid output.");
	}
	if (expectedFingerprint !== undefined && output.fingerprint !== expectedFingerprint) {
		throw new FiseError("PROFILE_MISMATCH", "FISE CLI: generated JavaScript and Python fingerprints differ.");
	}
	return Object.freeze({
		fingerprint: output.fingerprint,
		checks: Object.freeze([
			"Python text/structured/binary",
			"Python context/TTL/full-edge/range-progressive",
			...(expectedCases === undefined ? [] : ["JavaScript ↔ Python exact wire"])
		])
	});
}

/** @internal Verifies two sources emitted from one generation IR. */
export async function verifyGeneratedProfilePairSources(
	javascriptSource: string,
	pythonSource: string
): Promise<ProfileVerification> {
	const profile = await loadGeneratedProfileSource(javascriptSource);
	return verifyPythonProfileSource(
		pythonSource,
		profile.fingerprint,
		createExpectedCases(profile)
	);
}

function runPythonVerifier(
	source: string,
	expectedFingerprint: string | undefined,
	cases: readonly VerificationCase[]
): PythonVerificationOutput {
	const command = findPython();
	const temporaryDirectory = mkdtempSync(join(tmpdir(), "fise-python-profile-"));
	const profilePath = join(temporaryDirectory, "profile_generated.py");
	const requestPath = join(temporaryDirectory, "request.json");
	try {
		writeFileSync(profilePath, source, { encoding: "utf8", flag: "wx" });
		writeFileSync(
			requestPath,
			JSON.stringify({
				...(expectedFingerprint === undefined ? {} : { expectedFingerprint }),
				cases
			}),
			{ encoding: "utf8", flag: "wx" }
		);
		const result = spawnSync(
			command.executable,
			[
				...command.prefix,
				"-m",
				"fise._verify",
				profilePath,
				requestPath
			],
			{
				encoding: "utf8",
				env: {
					...process.env,
					PYTHONDONTWRITEBYTECODE: "1",
					PYTHONIOENCODING: "utf-8",
					PYTHONUTF8: "1",
					PYTHONPATH: [pythonSourceRoot, process.env.PYTHONPATH]
						.filter((value): value is string => Boolean(value))
						.join(delimiter)
				},
				maxBuffer: 16 * 1024 * 1024
			}
		);
		if (result.error && (result.error as NodeJS.ErrnoException).code !== "EPIPE") {
			throw new FiseError(
				"RUNTIME_UNAVAILABLE",
				"FISE CLI: unable to start Python profile verification.",
				result.error
			);
		}
		if (result.error || result.status !== 0) {
			let detail = result.stderr.trim();
			try {
				const failure = JSON.parse(detail) as { code?: unknown; message?: unknown };
				if (typeof failure.message === "string") detail = failure.message;
			} catch {
				// Preserve bounded interpreter diagnostics when structured output is unavailable.
			}
			throw new FiseError(
				"INVALID_PROFILE",
				`FISE CLI: Python profile verification failed${detail ? `; ${detail}` : "."}`
			);
		}
		try {
			return JSON.parse(result.stdout) as PythonVerificationOutput;
		} catch (error) {
			throw new FiseError(
				"INVALID_PROFILE",
				"FISE CLI: Python profile verifier returned invalid JSON.",
				error
			);
		}
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
}

function findPython(): PythonCommand {
	for (const candidate of [
		{ executable: "python3", prefix: [] },
		{ executable: "python", prefix: [] },
		{ executable: "py", prefix: ["-3"] }
	] as const) {
		const probe = spawnSync(
			candidate.executable,
			[...candidate.prefix, "-c", "import sys;raise SystemExit(0 if sys.version_info >= (3,10) else 1)"],
			{ encoding: "utf8" }
		);
		if (!probe.error && probe.status === 0) return candidate;
	}
	throw new FiseError(
		"RUNTIME_UNAVAILABLE",
		"FISE CLI: Python 3.10 or newer is required for --backend python."
	);
}

function baseVerificationCases(): VerificationCase[] {
	const binary = Uint8Array.from({ length: 4_097 }, (_, index) => (index * 73 + 19) & 0xff);
	const edgeBinary = Uint8Array.from({ length: 8_193 }, (_, index) => (index * 29 + 7) & 0xff);
	const context = ["session_demo", "user_42", "resource", "v2", 7] as const;
	return [
		{
			id: "text-default-context",
			kind: "json",
			input: "FISE Python verification: Việt Nam ✓ こんにちは 🚀"
		},
		{
			id: "structured-context",
			kind: "json",
			input: { active: true, sequence: 7, values: [null, 0, 255, false] },
			context,
			wrongContext: ["session_demo", "wrong", "resource", "v2", 7]
		},
		{
			id: "structured-compressed",
			kind: "json",
			input: { message: "FISE structured Python interoperability ".repeat(64), status: "ready" },
			context
		},
		{
			id: "structured-binary64",
			kind: "json",
			input: { values: portableBinary64Values() },
			context
		},
		{
			id: "binary-full",
			kind: "binary",
			inputHex: bytesToHex(binary),
			context,
			range: {
				start: 511,
				endExclusive: 3_337,
				expectedHex: bytesToHex(binary.slice(511, 3_337))
			},
			progressive: {
				chunkSize: 777,
				expectedChunksHex: chunkHex(binary, 777)
			}
		},
		{
			id: "binary-edge-ttl",
			kind: "binary",
			inputHex: bytesToHex(edgeBinary),
			context,
			options: {
				ttlSeconds: 45,
				binary: { mode: "edges", edgeBytes: 1_024 }
			},
			clockMilliseconds: 1_800_000_100_456,
			range: {
				start: 777,
				endExclusive: 7_321,
				expectedHex: bytesToHex(edgeBinary.slice(777, 7_321))
			},
			progressive: {
				chunkSize: 1_111,
				expectedChunksHex: chunkHex(edgeBinary, 1_111)
			}
		}
	];
}

function portableBinary64Values(): number[] {
	const values = [
		0,
		Number.MIN_VALUE,
		-Number.MIN_VALUE,
		Number.MAX_VALUE,
		-Number.MAX_VALUE,
		2 ** 53,
		-(2 ** 53),
		1e-6,
		9.999999999999997e-7,
		1e21,
		9.999999999999999e20,
		1e23,
		333333333.3333333,
		-0.0000033333333333333333
	];
	let low = 0x243f_6a88;
	let high = 0x85a3_08d3;
	const bytes = new ArrayBuffer(8);
	const view = new DataView(bytes);
	while (values.length < 270) {
		low = xorshift32(low);
		high = xorshift32(high ^ low);
		view.setUint32(0, high, false);
		view.setUint32(4, low, false);
		const value = view.getFloat64(0, false);
		if (Number.isFinite(value) && !Object.is(value, -0)) values.push(value);
	}
	return values;
}

function xorshift32(value: number): number {
	value ^= value << 13;
	value ^= value >>> 17;
	value ^= value << 5;
	return value >>> 0;
}

function createExpectedCases(profile: Profile): VerificationCase[] {
	return baseVerificationCases().map(candidate => {
		const fise = new Fise(profile, candidate.options ?? {});
		if (candidate.clockMilliseconds !== undefined) {
			setFiseClockForTesting(fise, () => candidate.clockMilliseconds!);
		}
		const input: FiseValue = candidate.kind === "binary"
			? bytesFromHex(candidate.inputHex!)
			: candidate.input as FiseValue;
		const envelope = candidate.context === undefined
			? fise.encrypt(input)
			: fise.encrypt(input, candidate.context as FiseContext);
		return Object.freeze({
			...candidate,
			...(typeof envelope === "string"
				? { expectedTransport: envelope }
				: { wireHex: bytesToHex(envelope) })
		});
	});
}

function bytesFromHex(source: string): Uint8Array {
	if (!/^(?:[0-9a-f]{2})*$/.test(source)) {
		throw new FiseError("INVALID_PROFILE", "FISE CLI: verification binary fixture is invalid.");
	}
	return Uint8Array.from(
		{ length: source.length / 2 },
		(_, index) => Number.parseInt(source.slice(index * 2, index * 2 + 2), 16)
	);
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

function chunkHex(bytes: Uint8Array, size: number): string[] {
	const chunks: string[] = [];
	for (let start = 0; start < bytes.length; start += size) {
		chunks.push(bytesToHex(bytes.slice(start, start + size)));
	}
	return chunks;
}

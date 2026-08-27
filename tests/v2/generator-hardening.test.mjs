import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync
} from "node:fs";
import test from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

import {
	Fise,
	FiseError,
	Profile,
	isParallelSupported,
	isWasmSupported
} from "fise";
import {
	generateProfileSource,
	writeGeneratedProfile
} from "../../dist/v2/generator.js";
import { setFiseClockForTesting } from "../../dist/v2/fise.js";
import { runtimeOf } from "../../dist/v2/profile.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));

test("deterministic entropy reaches every generator boundary", async () => {
	const temporaryDirectory = mkdtempSync(join(testDirectory, ".generator-boundaries-"));
	try {
		for (const fixture of [
			{
				name: "minimum",
				entropy: boundaryEntropy("minimum"),
				contextSegmentOffset: 0,
				contextSegmentLength: 12,
				stageCount: 4
			},
			{
				name: "maximum",
				entropy: boundaryEntropy("maximum"),
				contextSegmentOffset: 0xffff_ffff,
				contextSegmentLength: 32,
				stageCount: 7
			}
		]) {
			const generated = generateProfileSource({ entropy: fixture.entropy });
			assertGeneratedSourcePolicy(generated.source, generated.fingerprint);
			assert.equal(stageCount(generated.source), fixture.stageCount);

			const outputPath = join(temporaryDirectory, `${fixture.name}.mjs`);
			writeFileSync(outputPath, generated.source, "utf8");
			const profile = (await import(pathToFileURL(outputPath).href)).default;
			assert.ok(profile instanceof Profile);
			const runtime = runtimeOf(profile);
			assert.equal(runtime.contextSegmentOffset, fixture.contextSegmentOffset);
			assert.equal(runtime.contextSegmentLength, fixture.contextSegmentLength);

			const input = sampleBytes(1_029, fixture.stageCount);
			const context = [fixture.name, 0, 0xffff_ffff];
			const fise = new Fise(profile);
			assert.deepEqual(fise.decrypt(fise.encrypt(input, context), context), input);
		}
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
});

test("candidate validation retries and fails after the exact attempt limit", () => {
	let acceptedAttempt = 0;
	const generated = generateProfileSource({
		entropy: deterministicEntropy(0x1357_2468),
		acceptCandidate: attempt => {
			acceptedAttempt = attempt;
			return attempt === 3;
		}
	});
	assert.match(generated.fingerprint, /^[0-9a-f]{32}$/);
	assert.equal(acceptedAttempt, 3);

	let rejectedAttempts = 0;
	assert.throws(
		() => generateProfileSource({
			entropy: deterministicEntropy(0x2468_1357),
			acceptCandidate: attempt => {
				rejectedAttempts = attempt;
				return false;
			}
		}),
		(error) => error instanceof FiseError && error.code === "INVALID_PROFILE"
	);
	assert.equal(rejectedAttempts, 128);
});

test("entropy failures and invalid provider output fail closed", () => {
	const failure = new Error("entropy unavailable");
	assert.throws(
		() => generateProfileSource({
			entropy: {
				integer() {
					throw failure;
				},
				bytes: (_label, length) => new Uint8Array(length)
			}
		}),
		(error) =>
			error instanceof FiseError &&
			error.code === "RANDOM_UNAVAILABLE" &&
			error.cause === failure
	);

	assert.throws(
		() => generateProfileSource({
			entropy: {
				integer: (_label, _minimum, maximum) => maximum,
				bytes: (_label, length) => new Uint8Array(length)
			}
		}),
		(error) => error instanceof FiseError && error.code === "RANDOM_UNAVAILABLE"
	);

	assert.throws(
		() => generateProfileSource({
			entropy: {
				integer: (_label, minimum) => minimum,
				bytes: (_label, length) => new Uint8Array(Math.max(0, length - 1))
			}
		}),
		(error) => error instanceof FiseError && error.code === "RANDOM_UNAVAILABLE"
	);
});

test("every generated numeric parameter affects source identity", () => {
	const trace = new Map();
	const fixed = new Map([["integer:extraStageCount", 3]]);
	const baseline = generateProfileSource({
		entropy: deterministicEntropy(0x6a09_e667, { overrides: fixed, trace })
	});
	const repeated = generateProfileSource({
		entropy: deterministicEntropy(0x6a09_e667, { overrides: fixed })
	});
	assert.deepEqual(repeated, baseline, "deterministic verification seam did not replay exactly");

	const parameters = [...trace.entries()].filter(([key]) => isProfileParameter(key));
	assert.ok(parameters.length >= 53, `only ${parameters.length} profile parameters were observed`);

	for (const [key, descriptor] of parameters) {
		const overrides = new Map(fixed);
		overrides.set(key, mutateEntropyValue(descriptor));
		const mutated = generateProfileSource({
			entropy: deterministicEntropy(0x6a09_e667, { overrides })
		});
		assert.notEqual(
			mutated.fingerprint,
			baseline.fingerprint,
			`${key} did not affect the profile fingerprint`
		);
		assert.notEqual(
			mutated.source,
			baseline.source,
			`${key} did not affect emitted source`
		);
	}
});

test("generated segment shifts use distinct context lanes and change kernel semantics", async () => {
	const temporaryDirectory = mkdtempSync(join(testDirectory, ".generator-segment-shift-"));
	const trace = new Map();
	const fixed = new Map([["integer:extraStageCount", 3]]);
	try {
		const baseline = generateProfileSource({
			entropy: deterministicEntropy(0x510e_527f, { overrides: fixed, trace })
		});
		const contextSegmentLength = trace.get("integer:contextSegmentLength")?.value;
		assert.ok(Number.isInteger(contextSegmentLength));
		const shifts = [...trace.entries()].filter(([key]) => key.endsWith(".segmentShift"));
		assert.ok(shifts.length >= 4);
		for (const [, descriptor] of shifts) {
			assert.equal(descriptor.minimum, 0);
			assert.equal(descriptor.maximum, contextSegmentLength);
			assert.ok(descriptor.value >= 0 && descriptor.value < contextSegmentLength);
		}

		const [shiftKey, shiftDescriptor] = shifts[0];
		const overrides = new Map(fixed);
		overrides.set(shiftKey, mutateEntropyValue(shiftDescriptor));
		const mutated = generateProfileSource({
			entropy: deterministicEntropy(0x510e_527f, { overrides })
		});
		const baselinePath = join(temporaryDirectory, "baseline.mjs");
		const mutatedPath = join(temporaryDirectory, "mutated.mjs");
		writeFileSync(baselinePath, baseline.source, "utf8");
		writeFileSync(mutatedPath, mutated.source, "utf8");
		const baselineRuntime = runtimeOf((await import(pathToFileURL(baselinePath).href)).default);
		const mutatedRuntime = runtimeOf((await import(pathToFileURL(mutatedPath).href)).default);
		const input = sampleBytes(1_027, 29);
		const contextSegment = sampleBytes(contextSegmentLength, 71);
		const contextState = [0x1020_3040, 0x5566_7788, 0x90ab_cdef, 0xfedc_ba98];
		const context = Object.freeze(["segment-shift", 29]);
		assert.notDeepEqual(
			baselineRuntime.forward(
				input,
				contextSegment,
				contextState,
				97,
				context
			),
			mutatedRuntime.forward(
				input,
				contextSegment,
				contextState,
				97,
				context
			),
			"changing segmentShift did not change forward kernel semantics"
		);
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
});

test("generated modules retain a minimal static source policy", () => {
	const fingerprints = new Set();
	const stageCounts = new Set();
	for (let index = 0; index < 32; index++) {
		const generated = generateProfileSource({
			entropy: deterministicEntropy(0x9e37_79b9 ^ index)
		});
		assertGeneratedSourcePolicy(generated.source, generated.fingerprint);
		assert.equal(fingerprints.has(generated.fingerprint), false);
		fingerprints.add(generated.fingerprint);
		stageCounts.add(stageCount(generated.source));
		assert.match(generated.source, /x\^=k\d+;/, "xor stage missing");
		assert.match(generated.source, /x=\(x\+k\d+\)&255;/, "add stage missing");
		assert.match(generated.source, /const r\d+=/, "rotate stage missing");
		assert.match(
			generated.source,
			/x=\(Math\.imul\(x,\d+\)\+k\d+\)&255;/,
			"affine stage missing"
		);
	}
	assert.equal(fingerprints.size, 32);
	assert.deepEqual([...stageCounts].sort(), [4, 5, 6, 7]);
});

test("100 deterministic profiles interoperate across JS, WASM, and sampled workers", async () => {
	const temporaryDirectory = mkdtempSync(join(testDirectory, ".generator-properties-"));
	const fingerprints = new Set();
	const workerSamples = new Set([0, 24, 49, 74, 99]);
	try {
		for (let index = 0; index < 100; index++) {
			const generated = generateProfileSource({
				entropy: deterministicEntropy(0x3c6e_f372 ^ Math.imul(index + 1, 0x45d9_f3b))
			});
			assert.equal(fingerprints.has(generated.fingerprint), false);
			fingerprints.add(generated.fingerprint);

			const outputPath = join(temporaryDirectory, `profile-${index}.mjs`);
			writeFileSync(outputPath, generated.source, "utf8");
				const profile = (await import(pathToFileURL(outputPath).href)).default;
				assert.ok(profile instanceof Profile);
				const javascript = new Fise(profile);
				const expiring = new Fise(profile, { ttlSeconds: 60 });
				const fixedNow = 1_800_000_000_000 + index * 1_000;
				setFiseClockForTesting(javascript, () => fixedNow);
				setFiseClockForTesting(expiring, () => fixedNow);
				const wasm = isWasmSupported() ? await javascript.withWasm() : undefined;
			const context = [
				index,
				index % 2 === 0 ? 0 : 0xffff_ffff,
					index % 3 === 0
				];
				const ttlInput = sampleBytes(97 + (index % 13), index);
				const ttlEnvelope = expiring.encrypt(ttlInput, context);
				assert.deepEqual(javascript.decrypt(ttlEnvelope, context), ttlInput);
				if (wasm) assert.deepEqual(wasm.decrypt(ttlEnvelope, context), ttlInput);

			for (const length of [0, 1, 31 + (index % 5), 257 + (index % 17)]) {
				const input = sampleBytes(length, index);
				const javascriptEnvelope = javascript.encrypt(input, context);
				assert.deepEqual(javascript.decrypt(javascriptEnvelope, context), input);
				if (wasm) {
					assert.deepEqual(wasm.decrypt(javascriptEnvelope, context), input);
					assert.deepEqual(
						javascript.decrypt(wasm.encrypt(input, context), context),
						input
					);
				}
			}

			if (index % 10 === 0) {
				const structured = { index, values: [null, true, `profile-${index}`] };
				assert.deepEqual(
					javascript.decrypt(javascript.encrypt(structured, context), context),
					structured
				);
			}

			if (workerSamples.has(index) && isParallelSupported()) {
				const parallel = await javascript.parallel({
					workerCount: 2,
					minimumParallelBytes: 0
				});
					try {
						const input = sampleBytes(4_097 + index, index);
						assert.deepEqual(await parallel.decrypt(ttlEnvelope, context), ttlInput);
					assert.deepEqual(
						await parallel.decrypt(javascript.encrypt(input, context), context),
						input
					);
					assert.deepEqual(
						javascript.decrypt(await parallel.encrypt(input, context), context),
						input
					);
				} finally {
					await parallel.close();
				}
			}
		}
		assert.equal(fingerprints.size, 100);
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
});

test("atomic writer preserves the destination and removes its temporary file", async () => {
	const temporaryDirectory = mkdtempSync(join(testDirectory, ".generator-write-failure-"));
	const outputPath = join(temporaryDirectory, "profile.mjs");
	const previousSource = "export default 'previous';\n";
	writeFileSync(outputPath, previousSource, "utf8");
	const failure = Object.assign(new Error("rename denied"), { code: "EACCES" });
	let temporaryPath;
	let removedPath;
	try {
		await assert.rejects(
			writeGeneratedProfile(outputPath, {
				entropy: deterministicEntropy(0xbb67_ae85),
				override: true,
				verifySource: fastVerification,
				fileSystem: {
					exists: () => true,
					createDirectory: path => mkdirSync(path, { recursive: true }),
					writeExclusive: (path, source) => {
						temporaryPath = path;
						writeFileSync(path, source, { encoding: "utf8", flag: "wx" });
					},
					publishExclusive() {
						assert.fail("override must replace rather than publish exclusively");
					},
					replace: () => {
						throw failure;
					},
					remove: path => {
						removedPath = path;
						rmSync(path, { force: true });
					}
				}
			}),
			(error) =>
				error instanceof FiseError &&
				error.code === "INVALID_INPUT" &&
				error.cause === failure
		);
		assert.equal(readFileSync(outputPath, "utf8"), previousSource);
		assert.equal(removedPath, temporaryPath);
		assert.equal(existsSync(temporaryPath), false);
		assert.deepEqual(readdirNames(temporaryDirectory), ["profile.mjs"]);
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
});

test("atomic create removes a partial temporary write without publishing it", async () => {
	const temporaryDirectory = mkdtempSync(join(testDirectory, ".generator-partial-create-"));
	const outputPath = join(temporaryDirectory, "profile.mjs");
	const writeFailure = Object.assign(new Error("disk full"), { code: "ENOSPC" });
	let temporaryPath;
	try {
		await assert.rejects(
			writeGeneratedProfile(outputPath, {
				entropy: deterministicEntropy(0x243f_6a88),
				verifySource: fastVerification,
				fileSystem: {
					exists: () => false,
					createDirectory: path => mkdirSync(path, { recursive: true }),
					writeExclusive: (path, source) => {
						temporaryPath = path;
						writeFileSync(path, source.slice(0, 32), { encoding: "utf8", flag: "wx" });
						throw writeFailure;
					},
					publishExclusive() {
						assert.fail("a partial temporary file must not be published");
					},
					replace() {
						assert.fail("create must not replace the destination");
					},
					remove: path => rmSync(path, { force: true })
				}
			}),
			(error) =>
				error instanceof FiseError &&
				error.code === "INVALID_INPUT" &&
				error.cause === writeFailure
		);
		assert.equal(existsSync(outputPath), false);
		assert.equal(existsSync(temporaryPath), false);
		assert.deepEqual(readdirNames(temporaryDirectory), []);
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
});

test("atomic create preserves a destination won by a concurrent writer", async () => {
	const temporaryDirectory = mkdtempSync(join(testDirectory, ".generator-race-create-"));
	const outputPath = join(temporaryDirectory, "profile.mjs");
	const raceSource = "concurrent writer\n";
	let temporaryPath;
	try {
		await assert.rejects(
			writeGeneratedProfile(outputPath, {
				entropy: deterministicEntropy(0x85a3_08d3),
				verifySource: fastVerification,
				fileSystem: {
					exists: () => false,
					createDirectory: path => mkdirSync(path, { recursive: true }),
					writeExclusive: (path, source) => {
						temporaryPath = path;
						writeFileSync(path, source, { encoding: "utf8", flag: "wx" });
					},
					publishExclusive: (_sourcePath, destinationPath) => {
						writeFileSync(destinationPath, raceSource, { encoding: "utf8", flag: "wx" });
						throw Object.assign(new Error("destination exists"), { code: "EEXIST" });
					},
					replace() {
						assert.fail("create must not replace the destination");
					},
					remove: path => rmSync(path, { force: true })
				}
			}),
			(error) =>
				error instanceof FiseError &&
				error.code === "INVALID_INPUT" &&
				/already exists/.test(error.message)
		);
		assert.equal(readFileSync(outputPath, "utf8"), raceSource);
		assert.equal(existsSync(temporaryPath), false);
		assert.deepEqual(readdirNames(temporaryDirectory), ["profile.mjs"]);
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
});

test("atomic writer never deletes a colliding temporary file", async () => {
	const temporaryDirectory = mkdtempSync(join(testDirectory, ".generator-collision-"));
	const outputPath = join(temporaryDirectory, "profile.mjs");
	const entropy = deterministicEntropy(0xa54f_f53a);
	const suffix = bytesToHex(entropy.bytes("temporaryPath", 8));
	const collidingPath = `${resolve(outputPath)}.${process.pid}.${suffix}.tmp`;
	writeFileSync(outputPath, "old destination\n", "utf8");
	writeFileSync(collidingPath, "another writer\n", "utf8");
	try {
		await assert.rejects(
			writeGeneratedProfile(outputPath, {
				entropy,
				override: true,
				verifySource: fastVerification
			}),
			(error) =>
				error instanceof FiseError &&
				error.code === "INVALID_INPUT" &&
				error.cause?.code === "EEXIST"
		);
		assert.equal(readFileSync(outputPath, "utf8"), "old destination\n");
		assert.equal(readFileSync(collidingPath, "utf8"), "another writer\n");
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
});

test("write and cleanup failures preserve the original error", async () => {
	const writeFailure = Object.assign(new Error("write denied"), { code: "EACCES" });
	const cleanupFailure = new Error("cleanup denied");
	let cleanupCalls = 0;
	await assert.rejects(
		writeGeneratedProfile("profile.mjs", {
			entropy: deterministicEntropy(0x510e_527f),
			override: true,
			verifySource: fastVerification,
			fileSystem: {
				exists: () => false,
				createDirectory() {},
				writeExclusive() {
					throw writeFailure;
				},
				publishExclusive() {
					assert.fail("publish must not run after a write failure");
				},
				replace() {
					assert.fail("replace must not run after a write failure");
				},
				remove() {
					cleanupCalls++;
					throw cleanupFailure;
				}
			}
		}),
		(error) =>
			error instanceof FiseError &&
			error.code === "INVALID_INPUT" &&
			error.cause === writeFailure
	);
	assert.equal(cleanupCalls, 1);
});

test("temporary-path entropy fails before filesystem mutation", async () => {
	let fileSystemCalls = 0;
	const failure = new Error("temporary entropy unavailable");
	const base = deterministicEntropy(0x1f83_d9ab);
	const entropy = {
		integer: base.integer,
		bytes(label, length) {
			if (label === "temporaryPath") throw failure;
			return base.bytes(label, length);
		}
	};
	await assert.rejects(
		writeGeneratedProfile("profile.mjs", {
			entropy,
			override: true,
			verifySource: fastVerification,
			fileSystem: {
				exists() {
					return false;
				},
				createDirectory() {
					fileSystemCalls++;
				},
				writeExclusive() {
					fileSystemCalls++;
				},
				publishExclusive() {
					fileSystemCalls++;
				},
				replace() {
					fileSystemCalls++;
				},
				remove() {
					fileSystemCalls++;
				}
			}
		}),
		(error) =>
			error instanceof FiseError &&
			error.code === "RANDOM_UNAVAILABLE" &&
			error.cause === failure
	);
	assert.equal(fileSystemCalls, 0);
});

test("verification failure occurs before filesystem mutation", async () => {
	const verificationFailure = new Error("profile did not roundtrip");
	let mutationCalls = 0;
	await assert.rejects(
		writeGeneratedProfile("profile.mjs", {
			entropy: deterministicEntropy(0x5be0_cd19),
			verifySource: async () => {
				throw verificationFailure;
			},
			fileSystem: {
				exists: () => false,
				createDirectory: () => mutationCalls++,
				writeExclusive: () => mutationCalls++,
				publishExclusive: () => mutationCalls++,
				replace: () => mutationCalls++,
				remove: () => mutationCalls++
			}
		}),
		(error) =>
			error instanceof FiseError &&
			error.code === "INVALID_PROFILE" &&
			error.cause === verificationFailure
	);
	assert.equal(mutationCalls, 0);
});

function boundaryEntropy(boundary) {
	return Object.freeze({
		integer: (_label, minimum, maximum) =>
			boundary === "minimum" ? minimum : maximum - 1,
		bytes: (_label, length) =>
			new Uint8Array(length).fill(boundary === "minimum" ? 0 : 0xff)
	});
}

function deterministicEntropy(seed, options = {}) {
	const overrides = options.overrides ?? new Map();
	const trace = options.trace;
	return Object.freeze({
		integer(label, minimum, maximum) {
			const key = `integer:${label}`;
			const defaultValue = minimum + (word(seed, label) % (maximum - minimum));
			const value = overrides.has(key) ? overrides.get(key) : defaultValue;
			if (!trace?.has(key)) {
				trace?.set(key, Object.freeze({ type: "integer", minimum, maximum, value }));
			}
			return value;
		},
		bytes(label, length) {
			const key = `bytes:${label}`;
			const defaultValue = deterministicBytes(seed, label, length);
			const selected = overrides.has(key) ? overrides.get(key) : defaultValue;
			const value = Uint8Array.from(selected);
			if (!trace?.has(key)) {
				trace?.set(key, Object.freeze({ type: "bytes", value: value.slice() }));
			}
			return value;
		}
	});
}

function deterministicBytes(seed, label, length) {
	const output = new Uint8Array(length);
	let offset = 0;
	for (let block = 0; offset < length; block++) {
		const digest = createHash("sha256")
			.update(`${seed >>> 0}:${label}:${block}`)
			.digest();
		const count = Math.min(digest.length, length - offset);
		output.set(digest.subarray(0, count), offset);
		offset += count;
	}
	return output;
}

function word(seed, label) {
	return createHash("sha256")
		.update(`${seed >>> 0}:${label}`)
		.digest()
		.readUInt32BE(0);
}

function isProfileParameter(key) {
	const label = key.slice(key.indexOf(":") + 1);
	return /^(?:contextSegmentOffset|contextSegmentLength|contextInitial\.\d|contextMultiplier\.\d|contextRotation|offsetConstant\.\d|markerConstant\.\d|stage\.\d+\.(?:affineMultiplier|segmentShift|positionMultiplier|constant|contextLane|contextLane2))$/.test(label);
}

function mutateEntropyValue(descriptor) {
	if (descriptor.type === "integer") {
		return descriptor.value + 1 < descriptor.maximum
			? descriptor.value + 1
			: descriptor.minimum;
	}
	const value = descriptor.value.slice();
	value[0] ^= 0x80;
	return value;
}

function assertGeneratedSourcePolicy(source, fingerprint) {
	assert.doesNotMatch(source, /\/\/|\/\*/, "generated source contains a comment");
	const sourceFile = ts.createSourceFile(
		"profile.generated.mjs",
		source,
		ts.ScriptTarget.ES2020,
		true,
		ts.ScriptKind.JS
	);
	assert.equal(sourceFile.parseDiagnostics.length, 0, "generated source has parse diagnostics");
	assert.equal(sourceFile.statements.length, 2, "generated module gained top-level behavior");

	const [importStatement, exportStatement] = sourceFile.statements;
	assert.ok(ts.isImportDeclaration(importStatement));
	assert.equal(importStatement.moduleSpecifier.text, "fise/profile-runtime");
	assert.ok(importStatement.importClause);
	assert.equal(importStatement.importClause.name, undefined);
	assert.ok(ts.isNamedImports(importStatement.importClause.namedBindings));
	assert.deepEqual(
		importStatement.importClause.namedBindings.elements.map(element => element.name.text),
		["Profile"]
	);

	assert.ok(ts.isExportAssignment(exportStatement));
	assert.equal(Boolean(exportStatement.isExportEquals), false);
	assert.ok(ts.isCallExpression(exportStatement.expression));
	assert.ok(ts.isPropertyAccessExpression(exportStatement.expression.expression));
	assert.equal(exportStatement.expression.expression.expression.text, "Profile");
	assert.equal(exportStatement.expression.expression.name.text, "generated");
	assert.equal(exportStatement.expression.arguments.length, 9);
	assert.equal(exportStatement.expression.arguments[0].text, fingerprint);

	const forbiddenIdentifiers = new Set([
		"Function",
		"crypto",
		"eval",
		"manifest",
		"process",
		"random",
		"require",
		"revision",
		"seed"
	]);
	visit(sourceFile, node => {
		if (ts.isIdentifier(node)) {
			assert.equal(
				forbiddenIdentifiers.has(node.text),
				false,
				`generated source contains forbidden identifier '${node.text}'`
			);
		}
		if (ts.isCallExpression(node)) {
			assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword, "dynamic import emitted");
		}
	});
	assert.doesNotMatch(
		source,
		/\b(?:contextInitial|contextSegmentOffset|contextSegmentLength|entropy|extraStage|offsetConstant|stageKind)\b/,
		"generator internals leaked into emitted source"
	);
}

function visit(node, assertion) {
	assertion(node);
	node.forEachChild(child => visit(child, assertion));
}

function stageCount(source) {
	const masksAcrossBothKernels = source.match(/const w\d+=/g) ?? [];
	assert.equal(masksAcrossBothKernels.length % 2, 0);
	return masksAcrossBothKernels.length / 2;
}

function sampleBytes(length, seed) {
	return Uint8Array.from(
		{ length },
		(_, index) => (Math.imul(index + 1, 73) + Math.imul(seed + 1, 41)) & 0xff
	);
}

function bytesToHex(bytes) {
	return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function readdirNames(path) {
	return readdirSync(path).sort();
}

async function fastVerification(source) {
	const fingerprint = source.match(/"([0-9a-f]{32})",/)?.[1];
	assert.ok(fingerprint, "generated profile fingerprint is present");
	return Object.freeze({
		fingerprint,
		checks: Object.freeze(["test encrypt/decrypt"])
	});
}

#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { generateReleaseEvidence } from "./release-evidence.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const packageJson = readJson(resolve(repositoryRoot, "package.json"));
const { values } = parseArgs({
	options: {
		"allow-dirty": { type: "boolean", default: false },
		"skip-benchmarks": { type: "boolean", default: false },
		"require-tag": { type: "boolean", default: false },
		"output-dir": { type: "string", default: "artifacts/release" }
	},
	strict: true,
	allowPositionals: false
});
const outputDirectory = resolve(repositoryRoot, values["output-dir"]);
const temporaryNpmCache = mkdtempSync(join(tmpdir(), "fise-release-candidate-"));
process.once("exit", () => {
	rmSync(temporaryNpmCache, { recursive: true, force: true });
});
const expectedTag = `v${packageJson.version}`;
const sourceStatus = gitText(["status", "--porcelain"]);
const tagsAtHead = gitText(["tag", "--points-at", "HEAD"])
	.split("\n")
	.map(value => value.trim())
	.filter(Boolean);

if (sourceStatus !== "" && !values["allow-dirty"]) {
	throw new Error(
		"Release candidate generation requires a clean working tree. " +
		"Use --allow-dirty only for explicitly non-release working-tree evidence."
	);
}
if (values["require-tag"] && !tagsAtHead.includes(expectedTag)) {
	throw new Error(
		`Release tag mismatch: expected ${expectedTag} to point at HEAD; found ` +
		`${tagsAtHead.length === 0 ? "no tags" : tagsAtHead.join(", ")}.`
	);
}

mkdirSync(outputDirectory, { recursive: true });
for (const filename of [
	"release-evidence.json",
	"SHA256SUMS",
	"npm-pack-metadata.json",
	"structured-transport-benchmark.json",
	"binary-restoration-benchmark.json",
	"worker-benchmark.json",
	`${packageJson.name}-${packageJson.version}.tgz`
]) {
	rmSync(resolve(outputDirectory, filename), { force: true });
}

const commandResults = [];
let tarballPath;
let packMetadata;
let failure;

try {
	runGate("runtime-tests", npm, ["test"]);
	runGate("runnable-examples", npm, ["run", "verify:examples"]);
	runGate("package-contract", npm, ["run", "verify:package"]);
	runGate("benchmark-types", npm, ["run", "verify:benchmarks"]);

	if (!values["skip-benchmarks"]) {
		const structuredOutput = resolve(outputDirectory, "structured-transport-benchmark.json");
		const structured = runGate("structured-transport-benchmark", npm, [
			"run",
			"benchmark:structured",
			"--",
			"--output",
			structuredOutput
		]);
		const structuredJson = readJson(structuredOutput);
		structured.record.counts = {
			payloadSuites: structuredJson.suites.length,
			transportRepresentations: 6
		};

		const binaryOutput = resolve(outputDirectory, "binary-restoration-benchmark.json");
		const binary = runGate("binary-restoration-benchmark", npm, [
			"run",
			"benchmark:binary",
			"--",
			"--output",
			binaryOutput
		]);
		const binaryJson = readJson(binaryOutput);
		binary.record.counts = {
			coverageModes: 2,
			chunkSizeSuites: binaryJson.suites.length,
			rangeCases: binaryJson.suites.reduce(
				(total, suite) => total + suite.rangeRestoration.length,
				0
			)
		};

		const workerOutput = resolve(outputDirectory, "worker-benchmark.json");
		const worker = runGate("worker-benchmark", npm, [
			"run",
			"benchmark:worker",
			"--",
			"--output",
			workerOutput
		]);
		const workerJson = readJson(workerOutput);
		worker.record.counts = {
			workerCountSuites: workerJson.workers.length,
			payloadSizes: workerJson.localJavaScript.operations.length
		};
	} else {
		for (const name of [
			"structured-transport-benchmark",
			"binary-restoration-benchmark",
			"worker-benchmark"
		]) {
			commandResults.push({
				name,
				command: null,
				startedAtUtc: null,
				durationMs: 0,
				exitCode: null,
				status: "skipped",
				counts: null,
				reason: "--skip-benchmarks"
			});
		}
	}

	const pack = runGate("npm-pack", npm, [
		"pack",
		"--json",
		"--ignore-scripts",
		"--pack-destination",
		outputDirectory
	], { printStdout: false });
	[packMetadata] = JSON.parse(pack.stdout);
	assert.equal(packMetadata.name, packageJson.name);
	assert.equal(packMetadata.version, packageJson.version);
	const packedPaths = packMetadata.files.map(file => file.path);
	for (const excludedPrefix of ["artifacts/", "benchmarks/", "scripts/"]) {
		assert.equal(
			packedPaths.some(path => path.startsWith(excludedPrefix)),
			false,
			`npm artifact unexpectedly includes ${excludedPrefix}`
		);
	}
	tarballPath = resolve(outputDirectory, packMetadata.filename);
	assert.ok(existsSync(tarballPath), "npm pack did not create the recorded tarball");
	pack.record.counts = {
		packageFiles: packMetadata.entryCount,
		packedBytes: packMetadata.size,
		unpackedBytes: packMetadata.unpackedSize
	};
	console.log(
		`Packed ${packMetadata.filename}: ${packMetadata.entryCount} files, ` +
		`${packMetadata.size} bytes.`
	);
	writeFileSync(
		resolve(outputDirectory, "npm-pack-metadata.json"),
		`${JSON.stringify(packMetadata, null, 2)}\n`,
		"utf8"
	);

	runGate("exact-packed-consumer", process.execPath, [
		resolve(repositoryRoot, "scripts/verify-packed-package.mjs"),
		"--tarball",
		tarballPath
	]);
	runGate("exact-packed-browser", process.execPath, [
		resolve(repositoryRoot, "scripts/verify-packed-browser-smoke.mjs"),
		"--tarball",
		tarballPath
	]);
} catch (error) {
	failure = error;
}

const unverifiedBoundaries = [
	...(values["skip-benchmarks"]
		? ["structured transport, binary restoration, and worker benchmarks were explicitly skipped"]
		: []),
	"GitHub repository metadata is external to the release artifact"
];
const generated = generateReleaseEvidence({
	outputDirectory,
	tarballPath,
	packMetadata,
	commandResults,
	unverifiedBoundaries
});

console.log(`\nRelease evidence: ${generated.evidencePath}`);
if (generated.checksumPath) console.log(`Checksums: ${generated.checksumPath}`);
if (tarballPath) console.log(`Tarball: ${tarballPath}`);
console.log(`Release eligible: ${generated.evidence.releaseEligible}`);
if (!generated.evidence.releaseEligible) {
	console.log(
		`Boundary: clean=${generated.evidence.source.clean}, ` +
		`tag=${generated.evidence.source.exactVersionTagMatched}, ` +
		`commands=${generated.evidence.allCommandsPassed}`
	);
}

if (failure) throw failure;

function runGate(name, command, arguments_, options = {}) {
	const commandText = [command, ...arguments_].map(shellDisplay).join(" ");
	console.log(`\n> ${commandText}`);
	const startedAt = new Date();
	const started = performance.now();
	const result = spawnSync(command, arguments_, {
		cwd: repositoryRoot,
		encoding: "utf8",
		env: {
			...process.env,
			npm_config_cache: temporaryNpmCache,
			npm_config_dry_run: "false"
		}
	});
	const durationMs = performance.now() - started;
	if (result.stdout && options.printStdout !== false) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	const exitCode = result.status ?? 1;
	const record = {
		name,
		command: commandText,
		startedAtUtc: startedAt.toISOString(),
		durationMs,
		exitCode,
		status: exitCode === 0 ? "passed" : "failed",
		counts: parseCounts(`${result.stdout ?? ""}\n${result.stderr ?? ""}`)
	};
	commandResults.push(record);
	if (result.error) throw result.error;
	if (exitCode !== 0) {
		throw new Error(`${name} failed with exit code ${exitCode}: ${commandText}`);
	}
	return { stdout: result.stdout, stderr: result.stderr, record };
}

function parseCounts(output) {
	const counts = {};
	assignMatch(counts, "tests", output, /# tests (\d+)/);
	assignMatch(counts, "pythonTests", output, /Ran (\d+) tests/);
	assignMatch(counts, "passed", output, /# pass (\d+)/);
	assignMatch(counts, "failed", output, /# fail (\d+)/);
	assignMatch(counts, "runnableExamples", output, /Verified (\d+) runnable FISE examples/);
	assignMatch(counts, "markdownDocuments", output, /Verified local Markdown links in (\d+) FISE documents/);
	assignMatch(counts, "browserLazyChunks", output, /Packed Chromium PASS:.*? (\d+) lazy chunks/);
	return Object.keys(counts).length === 0 ? null : counts;
}

function assignMatch(target, key, source, pattern) {
	const match = source.match(pattern);
	if (match) target[key] = Number(match[1]);
}

function gitText(arguments_) {
	const result = spawnSync("git", arguments_, {
		cwd: repositoryRoot,
		encoding: "utf8"
	});
	assert.equal(result.status, 0, `git ${arguments_.join(" ")} failed: ${result.stderr}`);
	return result.stdout.trim();
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function shellDisplay(value) {
	return /^[A-Za-z0-9_./:=+-]+$/.test(value)
		? value
		: JSON.stringify(value);
}

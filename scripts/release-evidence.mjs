#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync
} from "node:fs";
import { arch, platform, release, type } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function generateReleaseEvidence({
	outputDirectory,
	tarballPath,
	packMetadata,
	commandResults = [],
	unverifiedBoundaries = []
}) {
	const packageJson = readJson(resolve(repositoryRoot, "package.json"));
	const absoluteOutputDirectory = resolve(repositoryRoot, outputDirectory);
	mkdirSync(absoluteOutputDirectory, { recursive: true });

	const commit = runText("git", ["rev-parse", "HEAD"]);
	const status = runText("git", ["status", "--porcelain"]);
	const clean = status === "";
	const tagsAtCommit = runText("git", ["tag", "--points-at", "HEAD"])
		.split("\n")
		.map(value => value.trim())
		.filter(Boolean);
	const expectedTag = `v${packageJson.version}`;
	const exactTagMatched = tagsAtCommit.includes(expectedTag);
	const allCommandsPassed = (
		commandResults.length > 0 &&
		commandResults.every(result => result.status === "passed")
	);

	let artifact = null;
	let sha256 = null;
	let checksumPath = null;
	if (tarballPath) {
		const absoluteTarballPath = resolve(tarballPath);
		assert.ok(existsSync(absoluteTarballPath), `Tarball does not exist: ${absoluteTarballPath}`);
		const tarballBytes = readFileSync(absoluteTarballPath);
		sha256 = createHash("sha256").update(tarballBytes).digest("hex");
		const filename = basename(absoluteTarballPath);
		artifact = {
			filename,
			sha256,
			npmSha1: packMetadata?.shasum ?? null,
			npmIntegrity: packMetadata?.integrity ?? null,
			packageFileCount: packMetadata?.entryCount ?? packMetadata?.files?.length ?? null,
			packedSizeBytes: packMetadata?.size ?? statSync(absoluteTarballPath).size,
			unpackedSizeBytes: packMetadata?.unpackedSize ?? null
		};
		checksumPath = resolve(absoluteOutputDirectory, "SHA256SUMS");
		writeFileSync(checksumPath, `${sha256}  ${filename}\n`, "utf8");
	}

	const evidence = {
		schema: "fise.release-evidence/2",
		generatedAtUtc: new Date().toISOString(),
		package: {
			name: packageJson.name,
			version: packageJson.version,
			nodeRequirement: packageJson.engines?.node ?? null,
			moduleFormat: packageJson.type ?? null,
			runtimeDependencyCount: Object.keys(packageJson.dependencies ?? {}).length
		},
		protocolContracts: {
			ordinaryEnvelope: "FISE 2.0",
			structuredTransport: "canonical Base64URL with deterministic adaptive LZ4",
			selectiveBinary: "ordinary-envelope full/edge coverage with range and progressive restoration",
			profileArtifact: "generated Profile source",
			conformanceCorpus: "packaged accepted and malformed canonical, LZ4, payload, context, TTL, transport, and wire vectors"
		},
		source: {
			gitCommit: commit,
			gitTagsAtCommit: tagsAtCommit,
			expectedVersionTag: expectedTag,
			exactVersionTagMatched: exactTagMatched,
			clean,
			dirtyPathCount: clean ? 0 : status.split("\n").filter(Boolean).length
		},
		environment: {
			node: process.version,
			npm: runText(npmCommand(), ["--version"]),
			os: type(),
			osRelease: release(),
			platform: platform(),
			architecture: arch(),
			githubActions: process.env.GITHUB_ACTIONS === "true",
			githubRunId: process.env.GITHUB_RUN_ID ?? null,
			githubRef: process.env.GITHUB_REF ?? null,
			githubSha: process.env.GITHUB_SHA ?? null
		},
		artifact,
		commands: commandResults,
		allCommandsPassed,
		releaseEligible: Boolean(
			artifact && clean && exactTagMatched && allCommandsPassed
		),
		unverifiedBoundaries: uniqueStrings([
			...unverifiedBoundaries,
			"npm publication and registry integrity",
			"deployed application CSP and hosting behavior",
			"Webpack, Next.js, and framework-specific production bundling",
			"Firefox, WebKit, mobile, embedded, and constrained-device behavior",
			"HTTP range acquisition and incremental envelope input",
			"cryptographic confidentiality, authenticity, and integrity"
		])
	};
	const evidencePath = resolve(absoluteOutputDirectory, "release-evidence.json");
	writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
	return Object.freeze({
		evidence,
		evidencePath,
		checksumPath,
		sha256
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const { values } = parseArgs({
		options: {
			"tarball": { type: "string" },
			"pack-metadata": { type: "string" },
			"commands": { type: "string" },
			"output-dir": { type: "string", default: "artifacts/release" }
		},
		strict: true,
		allowPositionals: false
	});
	assert.ok(values.tarball, "--tarball <path> is required");
	const result = generateReleaseEvidence({
		outputDirectory: values["output-dir"],
		tarballPath: resolve(process.cwd(), values.tarball),
		packMetadata: values["pack-metadata"]
			? readJson(resolve(process.cwd(), values["pack-metadata"]))
			: undefined,
		commandResults: values.commands
			? readJson(resolve(process.cwd(), values.commands))
			: [],
		unverifiedBoundaries: values.commands
			? []
			: ["release gates were not executed by this evidence-only command"]
	});
	console.log(`Release evidence: ${result.evidencePath}`);
	console.log(`SHA-256: ${result.sha256}`);
}

function runText(command, arguments_) {
	const result = spawnSync(command, arguments_, {
		cwd: repositoryRoot,
		encoding: "utf8"
	});
	assert.equal(
		result.status,
		0,
		`${command} ${arguments_.join(" ")} failed\n${result.stderr}`
	);
	return result.stdout.trim();
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function npmCommand() {
	return process.platform === "win32" ? "npm.cmd" : "npm";
}

function uniqueStrings(values) {
	return [...new Set(values)];
}

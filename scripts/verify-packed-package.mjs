import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "fise-packed-package-"));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
const suppliedTarball = parseSuppliedTarball(process.argv.slice(2));

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? repositoryRoot,
		encoding: "utf8",
		env: {
			...process.env,
			npm_config_cache: join(temporaryRoot, "npm-cache"),
			npm_config_dry_run: "false",
			...options.env
		}
	});
	if (result.error) throw result.error;
	assert.equal(
		result.status,
		0,
		`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`
	);
	return result.stdout;
}

try {
	let metadata;
	let tarballPath;
	if (suppliedTarball) {
		tarballPath = suppliedTarball;
		assert.ok(existsSync(tarballPath), `Supplied tarball does not exist: ${tarballPath}`);
		metadata = {
			name: packageJson.name,
			version: packageJson.version,
			filename: basename(tarballPath),
			entryCount: null,
			size: statSync(tarballPath).size
		};
	} else {
		const packOutput = run(npmCommand, [
			"pack",
			"--json",
			"--pack-destination",
			temporaryRoot
		]);
		[metadata] = JSON.parse(packOutput);
		tarballPath = join(temporaryRoot, metadata.filename);
	}
	assert.equal(metadata.name, "fise");
	assert.equal(metadata.version, packageJson.version);
	if (metadata.entryCount !== null) assert.ok(metadata.entryCount > 0);

	assert.ok(existsSync(tarballPath), "npm pack did not produce the expected tarball");
	const sha256 = createHash("sha256").update(readFileSync(tarballPath)).digest("hex");

	const consumerRoot = join(temporaryRoot, "consumer");
	mkdirSync(consumerRoot);
	writeFileSync(
		join(consumerRoot, "package.json"),
		`${JSON.stringify({ name: "fise-packed-consumer", private: true, type: "module" }, null, 2)}\n`
	);
	run(
		npmCommand,
		["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath],
		{ cwd: consumerRoot }
	);

	const smokePath = join(consumerRoot, "smoke.mjs");
	writeFileSync(smokePath, `
import {
  createWasmXorBinaryCipher,
  createParallelXorBinaryCipher,
  defaultBinaryProfile,
  fiseBinaryDecrypt,
  fiseBinaryEncrypt,
  fiseBinaryDecryptAsync,
  fiseBinaryEncryptAsync,
  fiseFramedBinaryDecrypt,
  fiseFramedBinaryDecryptRange,
  fiseFramedBinaryEncrypt,
  resolveFiseTimeWindow,
  withBinaryBackend
} from "fise";
import * as conformance from "fise/conformance";
import * as profiles from "fise/profiles";
import * as http from "fise/http";

const input = Uint8Array.from([0, 1, 2, 127, 128, 255]);
const timeWindow = resolveFiseTimeWindow(60_000, { durationMs: 60_000 });
const equal = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const jsEnvelope = fiseBinaryEncrypt(input, defaultBinaryProfile);
const jsOutput = fiseBinaryDecrypt(jsEnvelope, defaultBinaryProfile);
const wasmProfile = withBinaryBackend(defaultBinaryProfile, await createWasmXorBinaryCipher());
const wasmEnvelope = fiseBinaryEncrypt(input, wasmProfile);
const wasmOutput = fiseBinaryDecrypt(wasmEnvelope, wasmProfile);
const parallel = await createParallelXorBinaryCipher({ workerCount: 2, minimumParallelBytes: 0 });
let parallelOutput;
let framedOutput;
let rangeOutput;
try {
  const parallelEnvelope = await fiseBinaryEncryptAsync(input, defaultBinaryProfile, { backend: parallel });
  parallelOutput = await fiseBinaryDecryptAsync(parallelEnvelope, defaultBinaryProfile, { backend: parallel });
  const framed = await fiseFramedBinaryEncrypt(input, defaultBinaryProfile, { frameSize: 2, backend: parallel });
  framedOutput = await fiseFramedBinaryDecrypt(framed, defaultBinaryProfile, { backend: parallel });
  rangeOutput = await fiseFramedBinaryDecryptRange(framed, defaultBinaryProfile, { start: 1, endExclusive: 5 });
} finally {
  await parallel.close();
}

if (
  timeWindow.timestamp !== 1 ||
  timeWindow.startMs !== 60_000 ||
  timeWindow.endExclusiveMs !== 120_000 ||
  !equal(input, jsOutput) ||
  !equal(input, wasmOutput)
  || !equal(input, parallelOutput)
  || !equal(input, framedOutput)
  || !equal(input.slice(1, 5), rangeOutput)
) {
  throw new Error("Packed root API or JS/WASM binary round trip failed");
}
if (
  typeof conformance.createBinaryConformanceEnvelope !== "function" ||
  typeof profiles.compileFiseProfileManifest !== "function" ||
  typeof http.createFiseResponse !== "function"
) {
  throw new Error("Packed subpath export check failed");
}
`);
	run(process.execPath, [smokePath], { cwd: consumerRoot });

	const installedPackageRoot = join(consumerRoot, "node_modules/fise");
	const installedPackageJson = JSON.parse(
		readFileSync(join(installedPackageRoot, "package.json"), "utf8")
	);
	assert.equal(installedPackageJson.name, packageJson.name);
	assert.equal(installedPackageJson.version, packageJson.version);
	for (const relativePath of [
		"examples/README.md",
		"examples/basic-string.mjs",
		"examples/binary-payload.mjs",
		"examples/framed-binary.mjs",
		"examples/json-http.mjs",
		"examples/profile-rotation.mjs",
		"examples/parallel-binary.mjs",
		"examples/run-all.mjs",
		"examples/time-window.mjs",
		"examples/wasm-backend.mjs",
		"reference/python/fise_v11_binary.py",
		"reference/python/test_fise_v11_binary.py",
		"reference/python/fixtures/compiled-binary-artifact.json",
		"reference/python/fixtures/compiled-binary-vector.json"
	]) {
		assert.ok(
			existsSync(join(installedPackageRoot, relativePath)),
			`Packed artifact is missing: ${relativePath}`
		);
	}
	const examplesOutput = run(
		process.execPath,
		[join(installedPackageRoot, "examples/run-all.mjs")],
		{ cwd: consumerRoot }
	);
	assert.match(examplesOutput, /Verified 8 runnable FISE examples\./);

	console.log(
		`Packed FISE ${metadata.version}: ` +
		`${metadata.entryCount === null ? "supplied exact artifact" : `${metadata.entryCount} files`}, ` +
		`${metadata.size} bytes, SHA-256 ${sha256}; empty-consumer ESM, subpath, ` +
		`JS, WASM, parallel workers, framed range/progressive artifacts, runnable examples, and reference checks passed.`
	);
} finally {
	rmSync(temporaryRoot, { recursive: true, force: true });
}

function parseSuppliedTarball(arguments_) {
	if (arguments_.length === 0) return undefined;
	assert.deepEqual(
		arguments_.slice(0, 1),
		["--tarball"],
		"Usage: node scripts/verify-packed-package.mjs [--tarball <path>]"
	);
	assert.equal(
		arguments_.length,
		2,
		"Usage: node scripts/verify-packed-package.mjs [--tarball <path>]"
	);
	return resolve(process.cwd(), arguments_[1]);
}

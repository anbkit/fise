import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "fise-packed-package-"));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

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
	const packOutput = run(npmCommand, [
		"pack",
		"--json",
		"--pack-destination",
		temporaryRoot
	]);
	const [metadata] = JSON.parse(packOutput);
	assert.equal(metadata.name, "fise");
	assert.equal(metadata.version, "1.1.0");
	assert.ok(metadata.entryCount > 0);

	const tarballPath = join(temporaryRoot, metadata.filename);
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
  defaultBinaryProfile,
  fiseBinaryDecrypt,
  fiseBinaryEncrypt,
  withBinaryBackend
} from "fise";
import * as conformance from "fise/conformance";
import * as profiles from "fise/profiles";
import * as http from "fise/http";

const input = Uint8Array.from([0, 1, 2, 127, 128, 255]);
const equal = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const jsEnvelope = fiseBinaryEncrypt(input, defaultBinaryProfile);
const jsOutput = fiseBinaryDecrypt(jsEnvelope, defaultBinaryProfile);
const wasmProfile = withBinaryBackend(defaultBinaryProfile, await createWasmXorBinaryCipher());
const wasmEnvelope = fiseBinaryEncrypt(input, wasmProfile);
const wasmOutput = fiseBinaryDecrypt(wasmEnvelope, wasmProfile);

if (!equal(input, jsOutput) || !equal(input, wasmOutput)) {
  throw new Error("Packed JS/WASM binary round trip failed");
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

	for (const relativePath of [
		"reference/python/fise_v11_binary.py",
		"reference/python/test_fise_v11_binary.py",
		"reference/python/fixtures/compiled-binary-artifact.json",
		"reference/python/fixtures/compiled-binary-vector.json"
	]) {
		assert.ok(
			existsSync(join(consumerRoot, "node_modules/fise", relativePath)),
			`Packed reference artifact is missing: ${relativePath}`
		);
	}

	console.log(
		`Packed FISE ${metadata.version}: ${metadata.entryCount} files, ` +
		`${metadata.size} bytes, SHA-256 ${sha256}; empty-consumer ESM, subpath, ` +
		`JS, WASM, and reference checks passed.`
	);
} finally {
	rmSync(temporaryRoot, { recursive: true, force: true });
}

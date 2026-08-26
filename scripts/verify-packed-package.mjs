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

	const installedPackageRoot = join(consumerRoot, "node_modules/fise");
	const installedPackageJson = JSON.parse(
		readFileSync(join(installedPackageRoot, "package.json"), "utf8")
	);
	assert.equal(installedPackageJson.name, packageJson.name);
	assert.equal(installedPackageJson.version, packageJson.version);

	const generatedProfilePath = join(consumerRoot, "profile.generated.mjs");
	run(
		process.execPath,
		[join(installedPackageRoot, "dist/cli.js"), "generate", generatedProfilePath],
		{ cwd: consumerRoot }
	);

	const smokePath = join(consumerRoot, "smoke.mjs");
	writeFileSync(smokePath, `
import assert from "node:assert/strict";
import {
  Fise,
  Profile,
  FISE_WIRE_VERSION,
  FISF_WIRE_VERSION,
  isParallelSupported,
  isWasmSupported
} from "fise";
import profile from "./profile.generated.mjs";

assert.ok(profile instanceof Profile);
assert.ok(Object.isFrozen(profile));
assert.deepEqual(FISE_WIRE_VERSION, { major: 2, minor: 0 });
assert.deepEqual(FISF_WIRE_VERSION, { major: 2, minor: 0 });

const javascript = new Fise(profile);
const context = [7, "packed-smoke"];
const structured = { message: "packed", values: [1, true, null] };
const bytes = Uint8Array.from({ length: 70_003 }, (_, index) => (index * 31 + 9) & 0xff);
assert.deepEqual(javascript.decrypt(javascript.encrypt(structured, context), context), structured);
assert.deepEqual(javascript.decrypt(javascript.encrypt(bytes, context), context), bytes);

if (isWasmSupported()) {
  const wasm = await javascript.withWasm();
  assert.deepEqual(wasm.decrypt(javascript.encrypt(bytes, context), context), bytes);
  assert.deepEqual(javascript.decrypt(wasm.encrypt(bytes, context), context), bytes);
}

const framed = javascript.encryptFramed(bytes, context, { frameSize: 16_384 });
assert.deepEqual(javascript.decryptFramed(framed, context), bytes);
assert.deepEqual(
  javascript.decryptRange(framed, { start: 15_000, endExclusive: 52_000 }, context),
  bytes.slice(15_000, 52_000)
);
const progressive = [];
for await (const frame of javascript.decryptProgressive(framed, context)) progressive.push(...frame);
assert.deepEqual(Uint8Array.from(progressive), bytes);

if (isParallelSupported()) {
  const parallel = await javascript.parallel({ workerCount: 2, minimumParallelBytes: 0 });
  try {
    assert.deepEqual(await parallel.decrypt(javascript.encrypt(bytes, context), context), bytes);
    assert.deepEqual(javascript.decrypt(await parallel.encrypt(bytes, context), context), bytes);
    const workerFramed = await parallel.encryptFramed(bytes, context, { frameSize: 16_384 });
    assert.deepEqual(await parallel.decryptFramed(workerFramed, context), bytes);
  } finally {
    await parallel.close();
  }
}

for (const specifier of [
  "fise/profiles",
  "fise/http",
  "fise/conformance",
  "fise/generator",
  "fise/v2/generator"
]) {
  let rejected = false;
  try {
    await import(specifier);
  } catch (error) {
    rejected = error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED";
  }
  assert.equal(rejected, true, "unsupported subpath remained importable: " + specifier);
}
`);
	run(process.execPath, [smokePath], { cwd: consumerRoot });

	for (const relativePath of [
		"dist/index.js",
		"dist/index.d.ts",
		"dist/profileRuntime.js",
		"dist/profileRuntime.d.ts",
		"dist/cli.js",
		"docs/SPEC.md",
		"docs/PROFILES.md",
		"docs/SECURITY.md",
		"docs/WHITEPAPER.md",
		"examples/README.md",
		"examples/fise.profile.mjs",
		"examples/basic.mjs",
		"examples/api-session.mjs",
		"examples/binary-file.mjs",
		"examples/framed.mjs",
		"examples/backends.mjs",
		"examples/failure-boundaries.mjs",
		"examples/run-all.mjs"
	]) {
		assert.ok(
			existsSync(join(installedPackageRoot, relativePath)),
			`Packed artifact is missing: ${relativePath}`
		);
	}
	for (const removedPath of [
		"dist/fiseEncrypt.js",
		"dist/fiseBinaryEncrypt.js",
		"dist/profileBuilder.js",
		"dist/profileManifest.js",
		"reference/python"
	]) {
		assert.equal(
			existsSync(join(installedPackageRoot, removedPath)),
			false,
			`Legacy artifact was packed: ${removedPath}`
		);
	}

	const examplesOutput = run(
		process.execPath,
		[join(installedPackageRoot, "examples/run-all.mjs")],
		{ cwd: consumerRoot }
	);
	assert.match(examplesOutput, /Verified 6 runnable FISE examples\./);

	console.log(
		`Packed FISE ${metadata.version}: ` +
		`${metadata.entryCount === null ? "supplied exact artifact" : `${metadata.entryCount} files`}, ` +
		`${metadata.size} bytes, SHA-256 ${sha256}; generated profile, unified API, ` +
		`JS/WASM/workers, FISF full/range/progressive, examples, and legacy removal passed.`
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

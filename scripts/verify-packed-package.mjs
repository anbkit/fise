import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

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
			PYTHONDONTWRITEBYTECODE: "1",
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
	assertNoPythonBytecode(installedPackageRoot);
	const installedPackageJson = JSON.parse(
		readFileSync(join(installedPackageRoot, "package.json"), "utf8")
	);
	assert.equal(installedPackageJson.name, packageJson.name);
	assert.equal(installedPackageJson.version, packageJson.version);
	const binHelpOutput = run(npmCommand, ["exec", "--", "fise", "help"], {
		cwd: consumerRoot
	});
	assert.match(binHelpOutput, /FISE 2\.0 CLI/);
	assert.match(
		binHelpOutput,
		/fise generate <output-file> \[--backend python\] \[--override\]/
	);

	const generatedProfilePath = join(consumerRoot, "profile.generated.mjs");
	const generationOutput = run(
		process.execPath,
		[
			join(installedPackageRoot, "dist/cli.js"),
			"generate",
			generatedProfilePath,
			"--backend",
			"python"
		],
		{ cwd: consumerRoot }
	);
	const generatedPythonProfilePath = join(consumerRoot, "profile_generated.py");
	const generatedProfileSource = readFileSync(generatedProfilePath, "utf8");
	const generatedPythonProfileSource = readFileSync(generatedPythonProfilePath, "utf8");
	assert.match(generatedProfileSource, /^import \{ Profile \} from "fise\/profile-runtime";/);
	assert.doesNotMatch(generatedProfileSource, /\/\/|\/\*/);
	assert.match(generatedPythonProfileSource, /^from fise\.profile_runtime import Profile/);
	assert.doesNotMatch(generatedPythonProfileSource, /#/);
	assert.match(generationOutput, /Verified .*text.*binary.*JavaScript.*WASM.*workers/);
	assert.match(generationOutput, /JavaScript ↔ Python exact wire/);
	assert.match(generationOutput, /Commit both generated files as one compatibility pair/);
	assert.match(generationOutput, /Separate repos: distribute these exact paired files/);
	assert.match(generationOutput, /Context: use the same positional contract/);
	const verificationOutput = run(
		process.execPath,
		[
			join(installedPackageRoot, "dist/cli.js"),
			"verify",
			generatedProfilePath,
			generatedPythonProfilePath
		],
		{ cwd: consumerRoot }
	);
	assert.match(
		verificationOutput,
		/PASS .*text.*binary.*JavaScript.*WASM.*workers.*JavaScript ↔ Python exact wire/
	);
	assert.equal(
		run(process.execPath, [join(installedPackageRoot, "dist/cli.js"), "--version"], {
			cwd: consumerRoot
		}).trim(),
		packageJson.version
	);

	const smokePath = join(consumerRoot, "smoke.mjs");
	writeFileSync(smokePath, `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  Fise,
  Profile,
  FISE_WIRE_VERSION,
  isParallelSupported,
  isWasmSupported
} from "fise";
import profile from "./profile.generated.mjs";
import conformanceProfile from "./node_modules/fise/conformance/v2/profile.generated.mjs";

assert.ok(profile instanceof Profile);
assert.ok(Object.isFrozen(profile));
assert.deepEqual(FISE_WIRE_VERSION, { major: 2, minor: 0 });

const conformanceVectors = JSON.parse(readFileSync(
  new URL("./node_modules/fise/conformance/v2/vectors.json", import.meta.url),
  "utf8"
));
assert.equal(conformanceVectors.profileFingerprint, conformanceProfile.fingerprint);
assert.ok(conformanceVectors.lz4Blocks.length > 0);
assert.ok(conformanceVectors.invalidEnvelopes.length > 0);
const structuredVector = conformanceVectors.envelopes.find(
  vector => vector.id === "structured"
);
assert.equal(
  new Fise(conformanceProfile).encrypt(
    JSON.parse(structuredVector.inputJson),
    structuredVector.context
  ),
  structuredVector.expectedTransport
);

const javascript = new Fise(profile);
const edgeJavascript = new Fise(profile, {
  binary: { mode: "edges", edgeBytes: 8_192 }
});
const fallback = new Fise(profile, { strict: false });
const context = [7, "packed-smoke"];
const structured = { message: "packed", values: [1, true, null] };
const bytes = Uint8Array.from({ length: 70_003 }, (_, index) => (index * 31 + 9) & 0xff);
const structuredEnvelope = javascript.encrypt(structured, context);
const binaryEnvelope = javascript.encrypt(bytes, context);
const edgeEnvelope = edgeJavascript.encrypt(bytes, context);
assert.equal(typeof structuredEnvelope, "string");
assert.ok(binaryEnvelope instanceof Uint8Array);
assert.deepEqual(javascript.decrypt(structuredEnvelope, context), structured);
assert.deepEqual(javascript.decrypt(binaryEnvelope, context), bytes);
assert.deepEqual(javascript.decrypt(edgeEnvelope, context), bytes);
const unsupported = new Date("2026-08-27T00:00:00.000Z");
assert.strictEqual(fallback.encrypt(unsupported), unsupported);
assert.strictEqual(fallback.decrypt(unsupported), unsupported);

if (isWasmSupported()) {
  const wasm = await javascript.withWasm();
  assert.deepEqual(wasm.decrypt(javascript.encrypt(bytes, context), context), bytes);
  assert.deepEqual(wasm.decrypt(edgeEnvelope, context), bytes);
  assert.deepEqual(javascript.decrypt(wasm.encrypt(bytes, context), context), bytes);
  const fallbackWasm = await fallback.withWasm();
  assert.equal(fallbackWasm.strict, false);
  assert.strictEqual(fallbackWasm.encrypt(unsupported), unsupported);
}

assert.deepEqual(
  javascript.decryptRange(binaryEnvelope, { start: 15_000, endExclusive: 52_000 }, context),
  bytes.slice(15_000, 52_000)
);
assert.deepEqual(
  javascript.decryptRange(edgeEnvelope, { start: 7_000, endExclusive: 63_000 }, context),
  bytes.slice(7_000, 63_000)
);
const progressive = [];
for await (const chunk of javascript.decryptProgressive(binaryEnvelope, context, {
  chunkSize: 16_384
})) progressive.push(...chunk);
assert.deepEqual(Uint8Array.from(progressive), bytes);

if (isParallelSupported()) {
  const parallel = await fallback.parallel({ workerCount: 2, minimumParallelBytes: 0 });
  try {
    assert.equal(parallel.strict, false);
    assert.strictEqual(await parallel.encrypt(unsupported), unsupported);
    assert.deepEqual(await parallel.decrypt(binaryEnvelope, context), bytes);
    assert.deepEqual(await parallel.decrypt(edgeEnvelope, context), bytes);
    assert.deepEqual(javascript.decrypt(await parallel.encrypt(bytes, context), context), bytes);
    assert.deepEqual(
      await parallel.decryptRange(binaryEnvelope, { start: 15_000, endExclusive: 52_000 }, context),
      bytes.slice(15_000, 52_000)
    );
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

	const browserEntryPath = join(consumerRoot, "browser-entry.mjs");
	const browserBundlePath = join(consumerRoot, "browser-bundle.mjs");
	writeFileSync(browserEntryPath, `
import { Fise } from "fise";
import profile from "./profile.generated.mjs";

void main();

async function main() {
  const fise = new Fise(profile);
  const context = ["packed-browser-bundle"];
  const value = {
    records: Array.from({ length: 200 }, (_, index) => ({
      id: index,
      resource: "packed-browser-bundle",
      status: index % 2 === 0 ? "ready" : "pending"
    }))
  };
  const envelope = fise.encrypt(value, context);
  if (typeof envelope !== "string") throw new Error("structured bundle output must be text");
  if (envelope.length >= JSON.stringify(value).length) {
    throw new Error("adaptive structured compression was not bundled");
  }
  if (JSON.stringify(fise.decrypt(envelope, context)) !== JSON.stringify(value)) {
    throw new Error("bundled browser round trip failed");
  }
  const wasm = await fise.withWasm();
  if (JSON.stringify(wasm.decrypt(envelope, context)) !== JSON.stringify(value)) {
    throw new Error("bundled browser WASM restore failed");
  }
  console.log("PASS packed browser bundle");
}
`);
	await build({
		absWorkingDir: consumerRoot,
		entryPoints: [browserEntryPath],
		outfile: browserBundlePath,
		bundle: true,
		platform: "browser",
		format: "esm",
		target: "es2020",
		logLevel: "silent"
	});
	const browserBundleSource = readFileSync(browserBundlePath, "utf8");
	assert.doesNotMatch(browserBundleSource, /import\(["']node:worker_threads["']\)/);
	assert.match(
		run(process.execPath, [browserBundlePath], { cwd: consumerRoot }),
		/PASS packed browser bundle/
	);

	for (const relativePath of [
		"dist/index.js",
		"dist/index.d.ts",
		"dist/profileRuntime.js",
		"dist/profileRuntime.d.ts",
		"dist/cli.js",
		"dist/v2/verifier.js",
		"dist/v2/pythonVerifier.js",
		"dist/v2/base64Url.js",
		"dist/v2/binary.js",
		"dist/v2/coverage.js",
		"dist/v2/lz4.js",
		"conformance/README.md",
		"conformance/v2/profile.generated.mjs",
		"conformance/v2/profile_generated.py",
		"conformance/v2/vectors.json",
		"python/pyproject.toml",
		"python/README.md",
		"python/LICENSE",
		"python/src/fise/__init__.py",
		"python/src/fise/core.py",
		"python/src/fise/errors.py",
		"python/src/fise/profile_runtime.py",
		"python/src/fise/_codec.py",
		"python/src/fise/_lz4.py",
		"python/src/fise/_verify.py",
		"python/src/fise/py.typed",
		"docs/AGENT_GUIDE.md",
		"docs/BINARY_DATA.md",
		"docs/CLI.md",
		"docs/WEB_APPLICATIONS.md",
		"docs/SPEC.md",
		"docs/PROFILES.md",
		"docs/SECURITY.md",
		"docs/WHITEPAPER.md",
		"examples/README.md",
		"examples/fise.profile.mjs",
		"examples/fise_profile.py",
		"examples/basic.mjs",
		"examples/api-session.mjs",
		"examples/agent-stream.mjs",
		"examples/binary-file.mjs",
		"examples/binary-restoration.mjs",
		"examples/backends.mjs",
		"examples/failure-boundaries.mjs",
		"examples/python-agent-backend.py",
		"examples/python-agent-interop.mjs",
		"examples/raw-fallback.mjs",
		"examples/ttl.mjs",
		"examples/web-application.mjs",
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
		"dist/v2/framed.js",
		"docs/FRAMED_BINARY.md",
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
	assert.match(examplesOutput, /Verified 11 runnable FISE examples\./);
	assertNoPythonBytecode(installedPackageRoot);

	console.log(
		`Packed FISE ${metadata.version}: ` +
		`${metadata.entryCount === null ? "supplied exact artifact" : `${metadata.entryCount} files`}, ` +
		`${metadata.size} bytes, SHA-256 ${sha256}; generated profile, unified API, ` +
		`Base64URL/binary transport, adaptive structured compression, full/edge coverage, raw fallback, ` +
		`JS/WASM/workers/Python, exact cross-language wire, direct range/progressive, ` +
		`examples, and legacy removal passed.`
	);
} finally {
	rmSync(temporaryRoot, { recursive: true, force: true });
}

function assertNoPythonBytecode(root) {
	const pending = [root];
	while (pending.length > 0) {
		const directory = pending.pop();
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			assert.ok(
				entry.name !== "__pycache__" && !/\.py[co]$/.test(entry.name),
				`Packed artifact contains generated Python bytecode: ${path}`
			);
			if (entry.isDirectory()) pending.push(path);
		}
	}
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

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));

assert.match(packageJson.version, /^2\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
assert.equal(packageLock.version, packageJson.version);
assert.equal(packageLock.packages[""].version, packageJson.version);
assert.equal(packageJson.type, "module");
assert.equal(packageJson.sideEffects, false);
assert.equal(packageJson.bin.fise, "dist/cli.js");
assert.equal(packageJson.engines.node, ">=20");
assert.equal(packageJson.dependencies, undefined);
assert.deepEqual(packageJson.exports, {
	".": {
		types: "./dist/index.d.ts",
		import: "./dist/index.js"
	},
	"./profile-runtime": {
		types: "./dist/profileRuntime.d.ts",
		import: "./dist/profileRuntime.js"
	}
});
assert.deepEqual(packageJson.files, [
	"dist",
	"conformance/README.md",
	"conformance/v2/*",
	"python/pyproject.toml",
	"python/README.md",
	"python/LICENSE",
	"python/src/fise/*.py",
	"python/src/fise/py.typed",
	"docs/*.md",
	"examples/*.mjs",
	"examples/*.py",
	"examples/README.md",
	"CHANGELOG.md",
	"CONTRIBUTING.md"
]);

for (const path of [
	"../dist/index.js",
	"../dist/index.d.ts",
	"../dist/profileRuntime.js",
	"../dist/profileRuntime.d.ts",
	"../dist/cli.js",
	"../dist/v2/fise.js",
	"../dist/v2/profile.js",
	"../dist/v2/generator.js",
	"../dist/v2/verifier.js",
	"../dist/v2/pythonVerifier.js",
	"../dist/v2/wasm.js",
	"../dist/v2/parallel.js",
	"../dist/v2/base64Url.js",
	"../dist/v2/binary.js",
	"../dist/v2/coverage.js",
	"../dist/v2/lz4.js",
	"../dist/v2/temporal.js",
	"../dist/v2/workers/profileWorker.js",
	"../conformance/README.md",
	"../conformance/v2/profile.generated.mjs",
	"../conformance/v2/profile_generated.py",
	"../conformance/v2/vectors.json",
	"../python/pyproject.toml",
	"../python/README.md",
	"../python/LICENSE",
	"../python/src/fise/__init__.py",
	"../python/src/fise/core.py",
	"../python/src/fise/errors.py",
	"../python/src/fise/profile_runtime.py",
	"../python/src/fise/_codec.py",
	"../python/src/fise/_lz4.py",
	"../python/src/fise/_verify.py",
	"../python/src/fise/py.typed",
	"../examples/README.md",
	"../examples/fise.profile.mjs",
	"../examples/basic.mjs",
	"../examples/api-session.mjs",
	"../examples/agent-stream.mjs",
	"../examples/binary-file.mjs",
	"../examples/binary-restoration.mjs",
	"../examples/backends.mjs",
	"../examples/failure-boundaries.mjs",
	"../examples/raw-fallback.mjs",
	"../examples/ttl.mjs",
	"../examples/web-application.mjs",
	"../examples/run-all.mjs",
	"../docs/CLI.md",
	"../docs/BINARY_DATA.md",
	"../docs/WEB_APPLICATIONS.md",
	"../docs/SPEC.md",
	"../docs/AGENT_GUIDE.md",
	"../docs/PROFILES.md",
	"../docs/SECURITY.md",
	"../docs/WHITEPAPER.md"
]) {
	assert.ok(existsSync(new URL(path, import.meta.url)), `Missing package artifact: ${path}`);
}

const conformanceVectors = JSON.parse(
	readFileSync(new URL("../conformance/v2/vectors.json", import.meta.url), "utf8")
);
const conformanceProfileSource = readFileSync(
	new URL("../conformance/v2/profile.generated.mjs", import.meta.url),
	"utf8"
);
const conformancePythonProfileSource = readFileSync(
	new URL("../conformance/v2/profile_generated.py", import.meta.url),
	"utf8"
);
assert.equal(conformanceVectors.format, "fise-v2-conformance");
assert.deepEqual(conformanceVectors.wireVersion, { major: 2, minor: 0 });
for (const section of [
	"contexts",
	"canonicalJson",
	"numberSerialization",
	"lz4Blocks",
	"invalidLz4Blocks",
	"payloads",
	"envelopes",
	"freshness",
	"invalidTransports",
	"invalidEnvelopes",
	"invalidPayloadEnvelopes",
	"invalid",
	"invalidContext"
]) {
	assert.ok(
		Array.isArray(conformanceVectors[section]) && conformanceVectors[section].length > 0,
		`Conformance corpus section is empty: ${section}`
	);
}
assert.match(
	conformanceProfileSource,
	new RegExp(`Profile\\.generated\\(\\r?\\n  "${conformanceVectors.profileFingerprint}"`)
);
assert.doesNotMatch(conformanceProfileSource, /\/\/|\/\*/);
assert.match(
	conformancePythonProfileSource,
	new RegExp(`Profile\\.generated\\("${conformanceVectors.profileFingerprint}"`)
);
assert.doesNotMatch(conformancePythonProfileSource, /#/);
assert.notEqual(
	statSync(new URL("../dist/cli.js", import.meta.url)).mode & 0o111,
	0,
	"dist/cli.js must be executable"
);

const api = await import("fise");
assert.deepEqual(Object.keys(api).sort(), [
	"FISE_WIRE_VERSION",
	"Fise",
	"FiseError",
	"Profile",
	"isParallelSupported",
	"isWasmSupported"
]);
assert.deepEqual(api.FISE_WIRE_VERSION, { major: 2, minor: 0 });
for (const legacy of [
	"fiseEncrypt",
	"fiseBinaryEncrypt",
	"defaultStringProfile",
	"defaultBinaryProfile",
	"FiseBuilder",
	"compileFiseProfileManifest",
	"resolveFiseTimeWindow"
]) {
	assert.equal(legacy in api, false, `Legacy root export remained: ${legacy}`);
}

assert.deepEqual(
	readdirSync(new URL("../examples/", import.meta.url)).sort(),
	[
		"README.md",
		"agent-stream.mjs",
		"api-session.mjs",
		"backends.mjs",
		"basic.mjs",
		"binary-file.mjs",
		"binary-restoration.mjs",
		"failure-boundaries.mjs",
		"fise.profile.mjs",
		"fise_profile.py",
		"python-agent-backend.py",
		"python-agent-interop.mjs",
		"raw-fallback.mjs",
		"run-all.mjs",
		"ttl.mjs",
		"web-application.mjs"
	]
);

const rootEntries = readdirSync(new URL("../dist/", import.meta.url)).sort();
for (const legacy of [
	"fiseEncrypt.js",
	"fiseBinaryEncrypt.js",
	"profileBuilder.js",
	"profileManifest.js",
	"profiles.js",
	"http.js",
	"timeWindow.js"
]) {
	assert.ok(!rootEntries.includes(legacy), `Legacy dist artifact remained: ${legacy}`);
}
assert.ok(!existsSync(new URL("../dist/v2/framed.js", import.meta.url)));
assert.ok(!existsSync(new URL("../docs/FRAMED_BINARY.md", import.meta.url)));

const publicTypes = readFileSync(new URL("../dist/index.d.ts", import.meta.url), "utf8");
assert.match(publicTypes, /export \{ Fise \}/);
assert.match(publicTypes, /export \{ Profile \}/);
assert.match(publicTypes, /FiseOptions/);
assert.match(publicTypes, /FiseBinaryOptions/);
assert.match(publicTypes, /FiseEncrypted/);
for (const legacy of [
	"FiseBuilder",
	"FiseStringProfile",
	"FiseBinaryProfile",
	"FiseBinaryEncryptOptions",
	"FiseEncryptOptions",
	"fiseEncrypt"
]) {
	assert.ok(!publicTypes.includes(legacy), `Legacy public type remained: ${legacy}`);
}

console.log("FISE 2.0 package artifacts, generated-profile runtime, and legacy-export removal verified.");

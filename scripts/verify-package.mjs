import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
assert.equal(packageJson.version, "1.1.0");
assert.equal(packageLock.version, packageJson.version);
assert.equal(packageLock.packages[""].version, packageJson.version);
assert.equal(packageJson.type, "module");
assert.equal(packageJson.sideEffects, false);
assert.equal(packageJson.bin.fise, "dist/cli.js");
assert.equal(packageJson.engines.node, ">=20");
assert.deepEqual(packageJson.files, [
	"dist",
	"docs/*.md",
	"examples/*.mjs",
	"examples/README.md",
	"reference/python/*.py",
	"reference/python/fixtures/*.json",
	"reference/python/README.md",
	"CHANGELOG.md",
	"CONTRIBUTING.md"
]);
assert.equal(packageJson.exports["."].require, undefined);
assert.equal(packageJson.exports["./conformance"].import, "./dist/conformance.js");
assert.equal(packageJson.exports["./profiles"].import, "./dist/profiles.js");
assert.equal(packageJson.exports["./http"].import, "./dist/http.js");

for (const path of [
	"../dist/index.js",
	"../dist/index.d.ts",
	"../dist/conformance.js",
	"../dist/conformance.d.ts",
	"../dist/cli.js",
	"../dist/profileManifest.js",
	"../dist/profileManifest.d.ts",
	"../dist/profiles.js",
	"../dist/profiles.d.ts",
	"../dist/http.js",
	"../dist/http.d.ts",
	"../dist/timeWindow.js",
	"../dist/timeWindow.d.ts",
	"../dist/asyncBinary.js",
	"../dist/asyncBinary.d.ts",
	"../dist/framedBinary.js",
	"../dist/framedBinary.d.ts",
	"../dist/parallelXorBinaryCipher.js",
	"../dist/parallelXorBinaryCipher.d.ts",
	"../dist/workers/xorWorker.js",
	"../dist/core/wasmXorBinaryCipher.js",
	"../dist/core/wasmXorBinaryCipher.d.ts",
	"../examples/README.md",
	"../examples/basic-string.mjs",
	"../examples/binary-payload.mjs",
	"../examples/framed-binary.mjs",
	"../examples/json-http.mjs",
	"../examples/profile-rotation.mjs",
	"../examples/parallel-binary.mjs",
	"../examples/run-all.mjs",
	"../examples/time-window.mjs",
	"../examples/wasm-backend.mjs",
	"../reference/python/fise_v11_binary.py",
	"../reference/python/test_fise_v11_binary.py",
	"../reference/python/fixtures/compiled-binary-artifact.json",
	"../reference/python/fixtures/compiled-binary-vector.json",
	"../reference/python/README.md"
]) {
	assert.ok(existsSync(new URL(path, import.meta.url)), `Missing package artifact: ${path}`);
}
assert.notEqual(
	statSync(new URL("../dist/cli.js", import.meta.url)).mode & 0o111,
	0,
	"dist/cli.js must be executable"
);

const rootApi = await import("fise");
const conformanceApi = await import("fise/conformance");
const profilesApi = await import("fise/profiles");
const httpApi = await import("fise/http");
assert.deepEqual(rootApi.FISE_WIRE_VERSION, { major: 1, minor: 1 });
assert.equal(typeof rootApi.FiseError, "function");
assert.equal(typeof rootApi.createWasmXorBinaryCipher, "function");
assert.equal(typeof rootApi.createParallelXorBinaryCipher, "function");
assert.equal(typeof rootApi.fiseBinaryEncryptAsync, "function");
assert.equal(typeof rootApi.fiseBinaryDecryptAsync, "function");
assert.equal(typeof rootApi.fiseFramedBinaryEncrypt, "function");
assert.equal(typeof rootApi.fiseFramedBinaryDecrypt, "function");
assert.equal(typeof rootApi.fiseFramedBinaryDecryptRange, "function");
assert.equal(typeof rootApi.fiseFramedBinaryDecryptProgressive, "function");
assert.equal(typeof rootApi.resolveFiseTimeWindow, "function");
assert.equal(typeof rootApi.compileFiseProfileManifest, "function");
assert.equal(typeof rootApi.defaultStringProfile, "object");
assert.equal(typeof rootApi.defaultBinaryProfile, "object");
for (const obsolete of ["defaultRules", "defaultBinaryRules", "FiseBuilder"]) {
	assert.equal(obsolete in rootApi, false, `Obsolete root export remained: ${obsolete}`);
}
assert.equal(typeof conformanceApi.createStringConformanceEnvelope, "function");
assert.equal(typeof conformanceApi.createBinaryConformanceEnvelope, "function");
assert.equal(typeof conformanceApi.createFramedBinaryConformanceEnvelope, "function");
assert.equal(typeof profilesApi.compileFiseProfileManifest, "function");
assert.equal(typeof httpApi.createFiseResponse, "function");
assert.equal(httpApi.FISE_MEDIA_TYPE, "application/vnd.fise");

assert.deepEqual(
	readdirSync(new URL("../examples/", import.meta.url)).sort(),
	[
		"README.md",
		"basic-string.mjs",
		"binary-payload.mjs",
		"framed-binary.mjs",
		"json-http.mjs",
		"parallel-binary.mjs",
		"profile-rotation.mjs",
		"run-all.mjs",
		"time-window.mjs",
		"wasm-backend.mjs"
	]
);

const coreEntries = readdirSync(new URL("../dist/core/", import.meta.url));
for (const obsolete of ["lengthExtractor.js", "lengthExtractor.d.ts"]) {
	assert.ok(!coreEntries.includes(obsolete), `Obsolete artifact remained in dist/core: ${obsolete}`);
}
const rootEntries = readdirSync(new URL("../dist/", import.meta.url));
for (const obsolete of ["encryptFise.js", "encryptBinaryFise.js"]) {
	assert.ok(!rootEntries.includes(obsolete), `Obsolete artifact remained in dist: ${obsolete}`);
}

const publicTypes = readFileSync(new URL("../dist/types.d.ts", import.meta.url), "utf8");
for (const obsolete of [
	"randomSeed",
	"extractSalt",
	"stripSalt",
	"allowsPreviousResult",
	"binaryCipher?",
	"cipher?",
	"decodeLength",
	"encodeLength",
	"saltLength?",
	"FiseRules"
]) {
	assert.ok(!publicTypes.includes(obsolete), `Obsolete public type remained: ${obsolete}`);
}
assert.match(publicTypes, /readonly id: string/);
assert.match(publicTypes, /maxEnvelopeLength\?: number/);

console.log("FISE 1.1 package artifacts and ESM exports verified.");

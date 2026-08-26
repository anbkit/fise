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
	"docs/*.md",
	"examples/*.mjs",
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
	"../dist/v2/wasm.js",
	"../dist/v2/parallel.js",
	"../dist/v2/framed.js",
	"../dist/v2/workers/profileWorker.js",
	"../examples/README.md",
	"../examples/fise.profile.mjs",
	"../examples/basic.mjs",
	"../examples/framed.mjs",
	"../examples/backends.mjs",
	"../examples/run-all.mjs",
	"../docs/SPEC.md",
	"../docs/PROFILES.md",
	"../docs/SECURITY.md",
	"../docs/WHITEPAPER.md"
]) {
	assert.ok(existsSync(new URL(path, import.meta.url)), `Missing package artifact: ${path}`);
}
assert.notEqual(
	statSync(new URL("../dist/cli.js", import.meta.url)).mode & 0o111,
	0,
	"dist/cli.js must be executable"
);

const api = await import("fise");
assert.deepEqual(Object.keys(api).sort(), [
	"FISE_WIRE_VERSION",
	"FISF_WIRE_VERSION",
	"Fise",
	"FiseError",
	"Profile",
	"isParallelSupported",
	"isWasmSupported"
]);
assert.deepEqual(api.FISE_WIRE_VERSION, { major: 2, minor: 0 });
assert.deepEqual(api.FISF_WIRE_VERSION, { major: 2, minor: 0 });
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
		"api-session.mjs",
		"backends.mjs",
		"basic.mjs",
		"binary-file.mjs",
		"failure-boundaries.mjs",
		"fise.profile.mjs",
		"framed.mjs",
		"run-all.mjs"
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

const publicTypes = readFileSync(new URL("../dist/index.d.ts", import.meta.url), "utf8");
assert.match(publicTypes, /export \{ Fise \}/);
assert.match(publicTypes, /export \{ Profile \}/);
for (const legacy of ["FiseBuilder", "FiseStringProfile", "FiseBinaryProfile", "fiseEncrypt"] ) {
	assert.ok(!publicTypes.includes(legacy), `Legacy public type remained: ${legacy}`);
}

console.log("FISE 2.0 package artifacts, generated-profile runtime, and legacy-export removal verified.");

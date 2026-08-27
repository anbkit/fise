import assert from "node:assert/strict";
import {
	existsSync,
	linkSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FiseError } from "fise";
import {
	generateProfilePairSources,
	writeGeneratedProfilePair
} from "../../dist/v2/generator.js";
import {
	verifyGeneratedProfilePairSources,
	verifyPythonProfileFile,
	verifyPythonProfileSource
} from "../../dist/v2/pythonVerifier.js";

test("generated JavaScript and Python profiles share one IR and exact wire", async () => {
	const fingerprints = new Set();
	for (let index = 0; index < 8; index++) {
		const generated = generateProfilePairSources();
		assert.match(generated.fingerprint, /^[0-9a-f]{32}$/);
		assert.equal(fingerprints.has(generated.fingerprint), false);
		fingerprints.add(generated.fingerprint);
		assert.match(
			generated.javascriptSource,
			/^import \{ Profile \} from "fise\/profile-runtime";/
		);
		assert.match(
			generated.pythonSource,
			/^from fise\.profile_runtime import Profile\n\n_U=4294967295/
		);
		assert.match(
			generated.pythonSource,
			new RegExp(`profile=Profile\\.generated\\("${generated.fingerprint}"`)
		);
		assert.doesNotMatch(generated.pythonSource, /#|\b(?:seed|revision|manifest|history)\b/i);
		const verification = await verifyGeneratedProfilePairSources(
			generated.javascriptSource,
			generated.pythonSource
		);
		assert.equal(verification.fingerprint, generated.fingerprint);
		assert.ok(verification.checks.includes("JavaScript ↔ Python exact wire"));
	}
	assert.equal(fingerprints.size, 8);
});

test("Python verification owns UTF-8 independently of ambient stdio encoding", async () => {
	const previousEncoding = process.env.PYTHONIOENCODING;
	const previousUtf8Mode = process.env.PYTHONUTF8;
	process.env.PYTHONIOENCODING = "ascii";
	process.env.PYTHONUTF8 = "0";
	try {
		const generated = generateProfilePairSources();
		const verification = await verifyGeneratedProfilePairSources(
			generated.javascriptSource,
			generated.pythonSource
		);
		assert.equal(verification.fingerprint, generated.fingerprint);
	} finally {
		restoreEnvironment("PYTHONIOENCODING", previousEncoding);
		restoreEnvironment("PYTHONUTF8", previousUtf8Mode);
	}
});

test("paired writer verifies before publishing and replaces both artifacts together", async () => {
	const temporaryDirectory = mkdtempSync(join(tmpdir(), "fise-python-pair-test-"));
	const javascriptPath = join(temporaryDirectory, "profile.generated.mjs");
	const pythonPath = join(temporaryDirectory, "profile_generated.py");
	try {
		const first = await writeGeneratedProfilePair(javascriptPath);
		assert.equal(first.javascriptPath, javascriptPath);
		assert.equal(first.pythonPath, pythonPath);
		assert.ok(existsSync(javascriptPath));
		assert.ok(existsSync(pythonPath));
		assert.equal(verifyPythonProfileFile(pythonPath).fingerprint, first.fingerprint);
		const firstJavaScript = readFileSync(javascriptPath, "utf8");
		const firstPython = readFileSync(pythonPath, "utf8");

		await assert.rejects(
			writeGeneratedProfilePair(javascriptPath),
			(error) => error instanceof FiseError && error.code === "INVALID_INPUT"
		);
		assert.equal(readFileSync(javascriptPath, "utf8"), firstJavaScript);
		assert.equal(readFileSync(pythonPath, "utf8"), firstPython);

		const second = await writeGeneratedProfilePair(javascriptPath, { override: true });
		assert.notEqual(second.fingerprint, first.fingerprint);
		assert.notEqual(readFileSync(javascriptPath, "utf8"), firstJavaScript);
		assert.notEqual(readFileSync(pythonPath, "utf8"), firstPython);
		assert.equal(verifyPythonProfileFile(pythonPath).fingerprint, second.fingerprint);
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
});

test("pair verification failure leaves existing destinations unchanged", async () => {
	const temporaryDirectory = mkdtempSync(join(tmpdir(), "fise-python-pair-failure-"));
	const javascriptPath = join(temporaryDirectory, "profile.generated.mjs");
	const pythonPath = join(temporaryDirectory, "profile_generated.py");
	writeFileSync(javascriptPath, "existing javascript\n", "utf8");
	writeFileSync(pythonPath, "existing python\n", "utf8");
	try {
		await assert.rejects(
			writeGeneratedProfilePair(javascriptPath, {
				override: true,
				verifySource: async source => ({
					fingerprint: fingerprintOf(source),
					checks: ["synthetic JavaScript"]
				}),
				verifyPairSources: async () => {
					throw new FiseError("INVALID_PROFILE", "pair rejected");
				}
			}),
			(error) => error instanceof FiseError && error.code === "INVALID_PROFILE"
		);
		assert.equal(readFileSync(javascriptPath, "utf8"), "existing javascript\n");
		assert.equal(readFileSync(pythonPath, "utf8"), "existing python\n");
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
});

test("new pair publication rolls back the first path when the second path fails", async () => {
	const temporaryDirectory = mkdtempSync(join(tmpdir(), "fise-python-pair-create-failure-"));
	const javascriptPath = join(temporaryDirectory, "profile.generated.mjs");
	const pythonPath = join(temporaryDirectory, "profile_generated.py");
	let publishCalls = 0;
	try {
		await assert.rejects(
			writeGeneratedProfilePair(javascriptPath, {
				verifySource: fastVerification,
				verifyPairSources: fastPairVerification,
				fileSystem: {
					exists: existsSync,
					createDirectory: path => mkdirSync(path, { recursive: true }),
					writeExclusive: (path, source) =>
						writeFileSync(path, source, { encoding: "utf8", flag: "wx" }),
					publishExclusive: (source, destination) => {
						publishCalls++;
						if (publishCalls === 2) {
							throw Object.assign(new Error("second publication denied"), { code: "EACCES" });
						}
						linkSync(source, destination);
					},
					replace: renameSync,
					remove: path => rmSync(path, { force: true })
				}
			}),
			(error) => error instanceof FiseError && error.code === "INVALID_INPUT"
		);
		assert.equal(existsSync(javascriptPath), false);
		assert.equal(existsSync(pythonPath), false);
		assert.deepEqual(readFileNames(temporaryDirectory), []);
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
});

test("pair replacement restores both previous files when the second replacement fails", async () => {
	const temporaryDirectory = mkdtempSync(join(tmpdir(), "fise-python-pair-replace-failure-"));
	const javascriptPath = join(temporaryDirectory, "profile.generated.mjs");
	const pythonPath = join(temporaryDirectory, "profile_generated.py");
	writeFileSync(javascriptPath, "previous javascript\n", "utf8");
	writeFileSync(pythonPath, "previous python\n", "utf8");
	let replaceCalls = 0;
	try {
		await assert.rejects(
			writeGeneratedProfilePair(javascriptPath, {
				override: true,
				verifySource: fastVerification,
				verifyPairSources: fastPairVerification,
				fileSystem: {
					exists: existsSync,
					createDirectory: path => mkdirSync(path, { recursive: true }),
					writeExclusive: (path, source) =>
						writeFileSync(path, source, { encoding: "utf8", flag: "wx" }),
					publishExclusive: linkSync,
					replace: (source, destination) => {
						replaceCalls++;
						if (replaceCalls === 2) {
							throw Object.assign(new Error("second replacement denied"), { code: "EACCES" });
						}
						renameSync(source, destination);
					},
					remove: path => rmSync(path, { force: true })
				}
			}),
			(error) => error instanceof FiseError && error.code === "INVALID_INPUT"
		);
		assert.equal(readFileSync(javascriptPath, "utf8"), "previous javascript\n");
		assert.equal(readFileSync(pythonPath, "utf8"), "previous python\n");
		assert.deepEqual(readFileNames(temporaryDirectory), [
			"profile.generated.mjs",
			"profile_generated.py"
		]);
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
});

test("Python verifier rejects source outside the generated shape", () => {
	assert.throws(
		() => verifyPythonProfileSource("profile = object()\n"),
		(error) => error instanceof FiseError && error.code === "INVALID_PROFILE"
	);
	const generated = generateProfilePairSources();
	assert.throws(
		() => verifyPythonProfileSource(`${generated.pythonSource}# comment\n`),
		(error) => error instanceof FiseError && error.code === "INVALID_PROFILE"
	);
});

function fingerprintOf(source) {
	const match = source.match(/Profile\.generated\(\n  "([0-9a-f]{32})"/);
	assert.ok(match);
	return match[1];
}

async function fastVerification(source) {
	return {
		fingerprint: fingerprintOf(source),
		checks: ["JavaScript synthetic"]
	};
}

async function fastPairVerification(javascriptSource) {
	return {
		fingerprint: fingerprintOf(javascriptSource),
		checks: ["JavaScript ↔ Python synthetic"]
	};
}

function readFileNames(path) {
	return readdirSync(path).sort();
}

function restoreEnvironment(name, value) {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

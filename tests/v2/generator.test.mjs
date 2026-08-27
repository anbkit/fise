import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Fise, Profile } from "fise";
import { pairedPythonPath } from "../../dist/v2/generator.js";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(dirname(testDirectory));
const cliPath = join(repositoryRoot, "dist/cli.js");
const packageVersion = JSON.parse(
	readFileSync(join(repositoryRoot, "package.json"), "utf8")
).version;

test("CLI verifies before writing and requires --override to replace a profile", async () => {
	const temporaryDirectory = mkdtempSync(join(testDirectory, ".generated-"));
	const outputPath = join(temporaryDirectory, "profile.generated.mjs");
	try {
		const firstRun = runCli(["generate", outputPath]);
		assert.equal(firstRun.status, 0, firstRun.stderr);
		assert.match(
			firstRun.stdout,
			/Verified text Base64URL encrypt\/decrypt, adaptive structured Base64URL encrypt\/decrypt, binary encrypt\/decrypt, empty\/default context, context, TTL, binary range\/progressive, binary edge mode, JavaScript, WASM, workers/
		);
		assert.match(firstRun.stdout, /Next:\n  Commit this generated profile\./);
		assert.match(firstRun.stdout, /Monorepo: import it from one shared package/);
		assert.match(firstRun.stdout, /Separate repos: distribute this exact file/);
		assert.match(firstRun.stdout, /Context: use the same positional contract/);
		assert.doesNotMatch(firstRun.stdout, /existing envelopes still require/);
		const firstSource = readFileSync(outputPath, "utf8");
		assert.match(firstSource, /^import \{ Profile \} from "fise\/profile-runtime";/);
		assert.doesNotMatch(firstSource, /\/\/|\/\*/);
		const first = (await import(`${pathToFileURL(outputPath).href}?generation=1`)).default;

		const secondRun = runCli(["generate", outputPath]);
		assert.equal(secondRun.status, 1);
		assert.match(secondRun.stderr, /already exists.*--override/);
		assert.equal(readFileSync(outputPath, "utf8"), firstSource);

		const overrideRun = runCli(["generate", outputPath, "--override"]);
		assert.equal(overrideRun.status, 0, overrideRun.stderr);
		assert.match(
			overrideRun.stdout,
			/Compatibility: existing envelopes still require the previous profile/
		);
		const secondSource = readFileSync(outputPath, "utf8");
		assert.doesNotMatch(secondSource, /\/\/|\/\*/);
		const second = (await import(`${pathToFileURL(outputPath).href}?generation=2`)).default;

		assert.ok(first instanceof Profile);
		assert.ok(second instanceof Profile);
		assert.notEqual(first.fingerprint, second.fingerprint);
		assert.notEqual(firstSource, secondSource);
		assert.doesNotMatch(secondSource, /\b(?:seed|revision|manifest|rotation)\b/i);
		assert.match(secondSource, /Profile\.generated\(/);
		assert.equal((secondSource.match(/const o=new Uint8Array\(b\.length\)/g) ?? []).length, 2);
		assert.deepEqual(
			new Fise(second).decrypt(new Fise(second).encrypt({ generated: true })),
			{ generated: true }
		);
		const verified = runCli(["verify", outputPath]);
		assert.equal(verified.status, 0, verified.stderr);
		assert.doesNotMatch(verified.stdout, /Next:/);
		assert.match(verified.stdout, new RegExp(`Profile ${second.fingerprint}`));
		assert.match(
			verified.stdout,
			/PASS text Base64URL encrypt\/decrypt, adaptive structured Base64URL encrypt\/decrypt, binary encrypt\/decrypt, empty\/default context, context, TTL, binary range\/progressive, binary edge mode, JavaScript, WASM, workers/
		);
		const commentedPath = join(temporaryDirectory, "profile.commented.mjs");
		writeFileSync(commentedPath, `${secondSource}// added comment\n`, "utf8");
		const commented = runCli(["verify", commentedPath]);
		assert.equal(commented.status, 1);
		assert.match(commented.stderr, /not a recognized FISE 2\.0 generated profile/);
		rmSync(commentedPath);
		assert.deepEqual(readdirSync(temporaryDirectory), ["profile.generated.mjs"]);
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
});

test("CLI generates and verifies one JavaScript-Python compatibility pair", () => {
	const temporaryDirectory = mkdtempSync(join(testDirectory, ".generated-python-"));
	const javascriptPath = join(temporaryDirectory, "profile.generated.mjs");
	const pythonPath = join(temporaryDirectory, "profile_generated.py");
	try {
		const generated = runCli(["generate", "--backend", "python", javascriptPath]);
		assert.equal(generated.status, 0, generated.stderr);
		assert.match(generated.stdout, new RegExp(`Generated JavaScript ${escapeRegex(javascriptPath)}`));
		assert.match(generated.stdout, new RegExp(`Generated Python ${escapeRegex(pythonPath)}`));
		assert.match(generated.stdout, /JavaScript ↔ Python exact wire/);
		assert.match(generated.stdout, /Commit both generated files as one compatibility pair/);
		const javascriptSource = readFileSync(javascriptPath, "utf8");
		const pythonSource = readFileSync(pythonPath, "utf8");
		const fingerprint = generated.stdout.match(/Profile ([0-9a-f]{32})/)?.[1];
		assert.ok(fingerprint);
		assert.match(javascriptSource, new RegExp(fingerprint));
		assert.match(pythonSource, new RegExp(fingerprint));
		assert.doesNotMatch(pythonSource, /#/);

		const pythonOnly = runCli(["verify", pythonPath]);
		assert.equal(pythonOnly.status, 0, pythonOnly.stderr);
		assert.match(pythonOnly.stdout, new RegExp(`Profile ${fingerprint}`));
		assert.match(pythonOnly.stdout, /Python text\/structured\/binary/);

		const paired = runCli(["verify", javascriptPath, pythonPath]);
		assert.equal(paired.status, 0, paired.stderr);
		assert.match(paired.stdout, new RegExp(`Profile ${fingerprint}`));
		assert.match(paired.stdout, /JavaScript ↔ Python exact wire/);

		const alternateJavaScriptPath = join(temporaryDirectory, "alternate.mjs");
		const alternatePythonPath = join(temporaryDirectory, "alternate.py");
		const alternate = runCli([
			"generate",
			alternateJavaScriptPath,
			"--backend",
			"python"
		]);
		assert.equal(alternate.status, 0, alternate.stderr);
		const mismatch = runCli(["verify", javascriptPath, alternatePythonPath]);
		assert.equal(mismatch.status, 1);
		assert.match(mismatch.stderr, /PROFILE_MISMATCH|fingerprint/i);
		rmSync(alternateJavaScriptPath);
		rmSync(alternatePythonPath);

		const refused = runCli(["generate", javascriptPath, "--backend", "python"]);
		assert.equal(refused.status, 1);
		assert.equal(readFileSync(javascriptPath, "utf8"), javascriptSource);
		assert.equal(readFileSync(pythonPath, "utf8"), pythonSource);

		const replaced = runCli([
			"generate",
			javascriptPath,
			"--backend",
			"python",
			"--override"
		]);
		assert.equal(replaced.status, 0, replaced.stderr);
		assert.notEqual(readFileSync(javascriptPath, "utf8"), javascriptSource);
		assert.notEqual(readFileSync(pythonPath, "utf8"), pythonSource);
		assert.deepEqual(
			readdirSync(temporaryDirectory).sort(),
			["profile.generated.mjs", "profile_generated.py"]
		);
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
});

test("Python pair paths are adjacent and importable", () => {
	assert.equal(
		pairedPythonPath(join("shared", "fise.profile.ts")),
		join("shared", "fise_profile.py")
	);
	assert.equal(
		pairedPythonPath(join("shared", "9-profile.mjs")),
		join("shared", "_9_profile.py")
	);
	assert.equal(
		pairedPythonPath(join("shared", "class.js")),
		join("shared", "_class.py")
	);
});

test("CLI has one fail-closed command contract", () => {
	assert.equal(runCli([]).status, 0);
	assert.match(
		runCli([]).stdout,
		/fise generate <output-file> \[--backend python\] \[--override\]/
	);
	assert.match(runCli([]).stdout, /fise verify <profile-file> \[python-profile\]/);
	const help = runCli(["help"]);
	assert.equal(help.status, 0);
	assert.equal(help.stdout, runCli(["--help"]).stdout);
	assert.equal(help.stdout, runCli(["-h"]).stdout);
	assert.match(help.stdout, /fise help/);
	for (const command of ["generate", "verify"]) {
		for (const flag of ["--help", "-h"]) {
			const commandHelp = runCli([command, flag]);
			assert.equal(commandHelp.status, 0, commandHelp.stderr);
			assert.match(commandHelp.stdout, new RegExp(`fise ${command} <`));
		}
	}
	const version = runCli(["--version"]);
	assert.equal(version.status, 0, version.stderr);
	assert.equal(version.stdout.trim(), packageVersion);
	const invalid = runCli(["profile", "build", "old.json"]);
	assert.equal(invalid.status, 1);
	assert.match(invalid.stderr, /INVALID_INPUT/);
	assert.match(invalid.stderr, /Run 'fise help' for usage/);
	for (const arguments_ of [
		["generate", "profile.mjs", "--seed", "1234"],
		["generate", "profile.mjs", "--revision", "2"],
		["generate", "profile.mjs", "--manifest", "old.json"],
		["generate", "profile.mjs", "--backend", "javascript"],
		["generate", "profile.mjs", "--backend", "ruby"],
		["generate", "profile.mjs", "--backend"],
		["generate", "profile.mjs", "--backend", "python", "--backend", "python"],
		["generate", "profile.mjs", "--override", "--override"],
		["verify", "profile.mjs", "--override"],
		["help", "unexpected"],
		["--help", "unexpected"]
	]) {
		const unsupported = runCli(arguments_);
		assert.equal(unsupported.status, 1);
		assert.match(unsupported.stderr, /INVALID_INPUT/);
	}
});

test("generated .ts profiles pass a strict consumer typecheck", () => {
	const temporaryDirectory = mkdtempSync(join(testDirectory, ".generated-types-"));
	const outputPath = join(temporaryDirectory, "profile.generated.ts");
	try {
		const generated = runCli(["generate", outputPath]);
		assert.equal(generated.status, 0, generated.stderr);
		const verified = runCli(["verify", outputPath]);
		assert.equal(verified.status, 0, verified.stderr);
		const typecheck = spawnSync(
			process.execPath,
			[
				join(repositoryRoot, "node_modules/typescript/bin/tsc"),
				"--noEmit",
				"--strict",
				"--target", "ES2020",
				"--module", "ESNext",
				"--moduleResolution", "bundler",
				"--skipLibCheck",
				outputPath
			],
			{ cwd: repositoryRoot, encoding: "utf8" }
		);
		assert.equal(typecheck.status, 0, `${typecheck.stdout}\n${typecheck.stderr}`);
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
});

test("CLI rejects unsupported, declaration, and unrecognized profile source", () => {
	const temporaryDirectory = mkdtempSync(join(testDirectory, ".invalid-generated-"));
	try {
		const unsupportedPath = join(temporaryDirectory, "profile.json");
		const unsupported = runCli(["generate", unsupportedPath]);
		assert.equal(unsupported.status, 1);
		assert.match(unsupported.stderr, /must use \.js, \.mjs, \.mts, or \.ts/);
		for (const filename of ["profile.d.ts", "profile.d.mts"]) {
			const declarationPath = join(temporaryDirectory, filename);
			const declaration = runCli(["generate", declarationPath]);
			assert.equal(declaration.status, 1);
			assert.match(declaration.stderr, /declaration files are not executable profiles/);
			assert.equal(runCli(["verify", declarationPath]).status, 1);
		}

		const invalidPath = join(temporaryDirectory, "profile.mjs");
		writeFileSync(invalidPath, "export default {};\n", "utf8");
		const invalid = runCli(["verify", invalidPath]);
		assert.equal(invalid.status, 1);
		assert.match(invalid.stderr, /not a recognized FISE 2\.0 generated profile/);
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
});

test("independent generations remain reversible across JavaScript and WASM", async (t) => {
	const temporaryDirectory = mkdtempSync(join(testDirectory, ".generated-matrix-"));
	const fingerprints = new Set();
	try {
		for (let index = 0; index < 6; index++) {
			const outputPath = join(temporaryDirectory, `profile-${index}.mjs`);
			const generated = runCli(["generate", outputPath]);
			assert.equal(generated.status, 0, generated.stderr);
			const profile = (await import(pathToFileURL(outputPath).href)).default;
			assert.ok(profile instanceof Profile);
			assert.equal(fingerprints.has(profile.fingerprint), false);
			fingerprints.add(profile.fingerprint);

			const javascript = new Fise(profile);
			const wasm = await javascript.withWasm();
			for (const length of [0, 1, 257, 4_097]) {
				const input = Uint8Array.from(
					{ length },
					(_, byteIndex) => (byteIndex * 43 + index * 17) & 0xff
				);
				const context = [index, length];
				assert.deepEqual(
					wasm.decrypt(javascript.encrypt(input, context), context),
					input
				);
				assert.deepEqual(
					javascript.decrypt(wasm.encrypt(input, context), context),
					input
				);
			}
		}
		assert.equal(fingerprints.size, 6);
	} catch (error) {
		if (error?.code === "WASM_UNAVAILABLE") t.skip("WebAssembly unavailable");
		else throw error;
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
});

function runCli(arguments_) {
	return spawnSync(process.execPath, [cliPath, ...arguments_], {
		cwd: repositoryRoot,
		encoding: "utf8"
	});
}

function escapeRegex(source) {
	return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

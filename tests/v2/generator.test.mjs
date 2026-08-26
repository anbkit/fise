import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync
} from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Fise, Profile } from "fise";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(dirname(testDirectory));
const cliPath = join(repositoryRoot, "dist/cli.js");

test("CLI overwrites one output with a new independent Profile instance", async () => {
	const temporaryDirectory = mkdtempSync(join(testDirectory, ".generated-"));
	const outputPath = join(temporaryDirectory, "profile.generated.mjs");
	try {
		const firstRun = runCli(["generate", outputPath]);
		assert.equal(firstRun.status, 0, firstRun.stderr);
		const firstSource = readFileSync(outputPath, "utf8");
		const first = (await import(`${pathToFileURL(outputPath).href}?generation=1`)).default;

		const secondRun = runCli(["generate", outputPath]);
		assert.equal(secondRun.status, 0, secondRun.stderr);
		const secondSource = readFileSync(outputPath, "utf8");
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
		assert.deepEqual(readdirSync(temporaryDirectory), ["profile.generated.mjs"]);
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
});

test("CLI has one fail-closed command contract", () => {
	assert.equal(runCli([]).status, 0);
	assert.match(runCli([]).stdout, /fise generate <output-file>/);
	const invalid = runCli(["profile", "build", "old.json"]);
	assert.equal(invalid.status, 1);
	assert.match(invalid.stderr, /INVALID_INPUT/);
	for (const arguments_ of [
		["generate", "profile.mjs", "--seed", "1234"],
		["generate", "profile.mjs", "--revision", "2"],
		["generate", "profile.mjs", "--manifest", "old.json"]
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

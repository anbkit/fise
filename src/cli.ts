#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { FiseError } from "./errors.js";
import {
	writeGeneratedProfile,
	writeGeneratedProfilePair
} from "./v2/generator.js";
import {
	resolvePythonProfilePath,
	verifyGeneratedProfilePairSources,
	verifyPythonProfileFile
} from "./v2/pythonVerifier.js";
import {
	resolveProfilePath,
	verifyProfileFile
} from "./v2/verifier.js";

const HELP_ARGUMENTS = new Set(["--help", "-h"]);

async function main(args: string[]): Promise<void> {
	if (
		args.length === 0 ||
		(args.length === 1 && ["help", "--help", "-h"].includes(args[0]))
	) {
		printHelp();
		return;
	}
	if (args.length === 1 && args[0] === "--version") {
		process.stdout.write(`${packageVersion()}\n`);
		return;
	}
	if (args[0] === "generate") {
		if (args.length === 2 && HELP_ARGUMENTS.has(args[1])) {
			printGenerateHelp();
			return;
		}
		const parsed = parseGenerateArguments(args.slice(1));
		const generated = parsed.backend === "python"
			? await writeGeneratedProfilePair(parsed.outputPath, { override: parsed.override })
			: await writeGeneratedProfile(parsed.outputPath, { override: parsed.override });
		const generatedPaths = "javascriptPath" in generated
			? [
				`Generated JavaScript ${generated.javascriptPath}`,
				`Generated Python ${generated.pythonPath}`
			]
			: [`Generated ${generated.path}`];
		process.stdout.write(
			[
				...generatedPaths,
				`Profile ${generated.fingerprint}`,
				`Verified ${generated.verification.checks.join(", ")}`,
				"",
				"Next:",
				...(parsed.backend === "python"
					? [
						"  Commit both generated files as one compatibility pair.",
						"  Frontend: import the JavaScript Profile.",
						"  Python backend: import the adjacent Python Profile.",
						"  Separate repos: distribute these exact paired files; never generate either side independently."
					]
					: [
						"  Commit this generated profile.",
						"  Monorepo: import it from one shared package.",
						"  Separate repos: distribute this exact file; never generate it independently."
					]),
				"  Context: use the same positional contract and operation values on both sides.",
				...(parsed.override
					? ["  Compatibility: existing envelopes still require the previous profile."]
					: [])
			].join("\n") + "\n"
		);
		return;
	}
	if (args[0] === "verify") {
		if (args.length === 2 && HELP_ARGUMENTS.has(args[1])) {
			printVerifyHelp();
			return;
		}
		if (args.length === 2) {
			const verified = args[1].toLowerCase().endsWith(".py")
				? verifyPythonProfileFile(args[1])
				: await verifyProfileFile(args[1]);
			process.stdout.write(
				[
					`Verified ${args[1]}`,
					`Profile ${verified.fingerprint}`,
					`PASS ${verified.checks.join(", ")}`
				].join("\n") + "\n"
			);
			return;
		}
		if (args.length === 3) {
			const javascriptPath = resolveProfilePath(args[1]);
			const pythonPath = resolvePythonProfilePath(args[2]);
			const javascriptSource = readProfileSource(javascriptPath);
			const pythonSource = readProfileSource(pythonPath);
			const [javascript, pair] = await Promise.all([
				verifyProfileFile(javascriptPath),
				verifyGeneratedProfilePairSources(javascriptSource, pythonSource)
			]);
			if (javascript.fingerprint !== pair.fingerprint) {
				throw new FiseError(
					"PROFILE_MISMATCH",
					"FISE CLI: JavaScript and Python profiles do not share one fingerprint."
				);
			}
			process.stdout.write(
				[
					`Verified ${javascriptPath}`,
					`Verified ${pythonPath}`,
					`Profile ${pair.fingerprint}`,
					`PASS ${[...javascript.checks, ...pair.checks].join(", ")}`
				].join("\n") + "\n"
			);
			return;
		}
	}
	throw usage();
}

function usage(): FiseError {
	return new FiseError(
		"INVALID_INPUT",
		"FISE CLI: expected generate <output-file> [--backend python] [--override] " +
			"or verify <profile-file> [python-profile]. " +
			"Run 'fise help' for usage."
	);
}

function packageVersion(): string {
	try {
		const metadata = JSON.parse(
			readFileSync(new URL("../package.json", import.meta.url), "utf8")
		) as { version?: unknown };
		if (typeof metadata.version === "string") return metadata.version;
	} catch (error) {
		throw new FiseError(
			"INVALID_INPUT",
			"FISE CLI: unable to read package version.",
			error
		);
	}
	throw new FiseError("INVALID_INPUT", "FISE CLI: package version is invalid.");
}

function printHelp(): void {
	process.stdout.write(
		[
			"FISE 2.0 CLI",
			"",
			"Usage:",
			"  fise <command> [options]",
			"",
			"Commands:",
			"  fise generate <output-file> [--backend python] [--override]",
			"      Generate, verify, and write a new Profile.",
			"  fise verify <profile-file> [python-profile]",
			"      Run round-trip and cross-backend checks without changing the file.",
			"  fise help",
			"      Show this help.",
			"",
			"Options:",
			"  --backend python   Also emit the paired Python backend Profile.",
			"  --override   Replace an existing profile only after verification.",
			"  -h, --help   Show root or command help.",
			"  --version    Print the installed package version.",
			"",
			"Run 'fise generate --help' or 'fise verify --help' for details."
		].join("\n") + "\n"
	);
}

function printGenerateHelp(): void {
	process.stdout.write(
		[
			"FISE 2.0 CLI - generate",
			"",
			"Usage:",
			"  fise generate <output-file> [--backend python] [--override]",
			"",
			"Creates a new generated Profile and verifies text, adaptive structured data,",
			"binary full/edge coverage, context, TTL, range/progressive,",
			"JavaScript, WASM, and workers before writing.",
			"With --backend python, the CLI derives an adjacent .py path and emits both",
			"Profiles from one transient IR, then verifies exact JavaScript ↔ Python wire.",
			"Existing files are refused unless --override is supplied.",
			"Commit the generated file, or the complete generated pair, and deploy exact copies."
		].join("\n") + "\n"
	);
}

function printVerifyHelp(): void {
	process.stdout.write(
		[
			"FISE 2.0 CLI - verify",
			"",
			"Usage:",
			"  fise verify <profile-file> [python-profile]",
			"",
			"Runs round-trip checks with synthetic and default context across supported",
			"data types, binary coverage, TTL, range/progressive, JavaScript, WASM,",
			"and workers without changing the file. A Python file runs native Python",
			"checks; supplying JavaScript then Python also proves exact paired wire.",
			"Exits 0 only when every check passes. Verify only trusted profile source."
		].join("\n") + "\n"
	);
}

interface GenerateArguments {
	readonly outputPath: string;
	readonly backend: "javascript" | "python";
	readonly override: boolean;
}

function parseGenerateArguments(args: readonly string[]): GenerateArguments {
	let outputPath: string | undefined;
	let backend: "javascript" | "python" = "javascript";
	let backendSeen = false;
	let override = false;
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === "--override") {
			if (override) throw usage();
			override = true;
			continue;
		}
		if (argument === "--backend") {
			if (backendSeen || index + 1 >= args.length) throw usage();
			const selected = args[++index];
			if (selected !== "python") {
				throw new FiseError(
					"INVALID_INPUT",
					"FISE CLI: --backend currently accepts only 'python'. Omit it for JavaScript-only generation."
				);
			}
			backend = "python";
			backendSeen = true;
			continue;
		}
		if (argument.startsWith("-") || outputPath !== undefined) throw usage();
		outputPath = argument;
	}
	if (outputPath === undefined) throw usage();
	return Object.freeze({ outputPath, backend, override });
}

function readProfileSource(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		throw new FiseError(
			"INVALID_INPUT",
			`FISE CLI: unable to read profile '${path}'.`,
			error
		);
	}
}

main(process.argv.slice(2)).catch((error: unknown) => {
	if (error instanceof FiseError) {
		process.stderr.write(`${error.code}: ${error.message}\n`);
	} else if (error instanceof Error) {
		process.stderr.write(`${error.name}: ${error.message}\n`);
	} else {
		process.stderr.write("FISE CLI: unknown failure.\n");
	}
	process.exitCode = 1;
});

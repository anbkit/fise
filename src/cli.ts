#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { FiseError } from "./errors.js";
import { writeGeneratedProfile } from "./v2/generator.js";
import { verifyProfileFile } from "./v2/verifier.js";

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
		const override = args.length === 3 && args[2] === "--override";
		if (args.length !== 2 && !override) throw usage();
		const generated = await writeGeneratedProfile(args[1], { override });
		process.stdout.write(
			[
				`Generated ${generated.path}`,
				`Profile ${generated.fingerprint}`,
				`Verified ${generated.verification.checks.join(", ")}`,
				"",
				"Next:",
				"  Commit this generated profile.",
				"  Monorepo: import it from one shared package.",
				"  Separate repos: distribute this exact file; never generate it independently.",
				"  Context: use the same positional contract and operation values on both sides.",
				...(override
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
			const verified = await verifyProfileFile(args[1]);
			process.stdout.write(
				[
					`Verified ${args[1]}`,
					`Profile ${verified.fingerprint}`,
					`PASS ${verified.checks.join(", ")}`
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
		"FISE CLI: expected generate <output-file> [--override] or verify <profile-file>. " +
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
			"  fise generate <output-file> [--override]",
			"      Generate, verify, and write a new Profile.",
			"  fise verify <profile-file>",
			"      Run round-trip and cross-backend checks without changing the file.",
			"  fise help",
			"      Show this help.",
			"",
			"Options:",
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
			"  fise generate <output-file> [--override]",
			"",
			"Creates a new generated Profile and verifies text, adaptive structured data,",
			"binary full/edge coverage, context, TTL, range/progressive,",
			"JavaScript, WASM, and workers before writing.",
			"Existing files are refused unless --override is supplied.",
			"Commit the generated file and deploy the same file on both sides."
		].join("\n") + "\n"
	);
}

function printVerifyHelp(): void {
	process.stdout.write(
		[
			"FISE 2.0 CLI - verify",
			"",
			"Usage:",
			"  fise verify <profile-file>",
			"",
			"Runs round-trip checks with synthetic and default context across supported",
			"data types, binary coverage, TTL, range/progressive, JavaScript, WASM,",
			"and workers without changing the file.",
			"Exits 0 only when every check passes. Verify only trusted profile source."
		].join("\n") + "\n"
	);
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

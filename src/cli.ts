#!/usr/bin/env node

import { FiseError } from "./errors.js";
import { writeGeneratedProfile } from "./v2/generator.js";

function main(args: string[]): void {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printHelp();
		return;
	}
	if (args[0] !== "generate" || args.length !== 2) {
		throw new FiseError(
			"INVALID_INPUT",
			"FISE CLI: expected 'fise generate <output-file>'."
		);
	}
	const generated = writeGeneratedProfile(args[1]);
	process.stdout.write(`Generated ${generated.path}\nProfile ${generated.fingerprint}\n`);
}

function printHelp(): void {
	process.stdout.write([
		"FISE 2.0 profile generator",
		"",
		"Usage:",
		"  fise generate <output-file>",
		"",
		"Every invocation creates a new independent generated Profile instance.",
		"Commit the generated file to Git and import the same file on both sides."
	].join("\n") + "\n");
}

try {
	main(process.argv.slice(2));
} catch (error: unknown) {
	if (error instanceof FiseError) {
		process.stderr.write(`${error.code}: ${error.message}\n`);
	} else if (error instanceof Error) {
		process.stderr.write(`${error.name}: ${error.message}\n`);
	} else {
		process.stderr.write("FISE CLI: unknown failure.\n");
	}
	process.exitCode = 1;
}

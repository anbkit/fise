#!/usr/bin/env node

import { readFileSync } from "node:fs";
import {
	compileFiseProfileManifest,
	createFiseProfileArtifact,
	createFiseProfileRotationArtifact,
	createManifestConformanceVector,
	validateFiseProfileContract
} from "./profileManifest.js";
import { FiseError } from "./errors.js";

async function main(args: string[]): Promise<void> {
	const [group, command, ...paths] = args;
	if (group !== "profile" || !command) {
		printHelp();
		if (args.length > 0) process.exitCode = 1;
		return;
	}

	if (command === "validate" || command === "build" || command === "vectors") {
		if (paths.length !== 1) throw usage(`${command} requires one manifest path`);
		const compiled = await compileFiseProfileManifest(readJson(paths[0]));
		if (command === "validate") {
			writeJson({
				...validateFiseProfileContract(compiled.profile),
				digest: compiled.digest
			});
			return;
		}
		if (command === "build") {
			validateFiseProfileContract(compiled.profile);
			writeJson(createFiseProfileArtifact(compiled));
			return;
		}
		writeJson(createManifestConformanceVector(compiled));
		return;
	}

	if (command === "diff") {
		if (paths.length !== 2) throw usage("diff requires old and new manifest paths");
		writeJson(await createFiseProfileRotationArtifact(
			readJson(paths[0]),
			readJson(paths[1])
		));
		return;
	}

	throw usage(`unknown profile command '${command}'`);
}

function readJson(path: string): unknown {
	let source: string;
	try {
		source = readFileSync(path === "-" ? 0 : path, "utf8");
	} catch (error) {
		throw new FiseError("INVALID_INPUT", `FISE CLI: unable to read '${path}'.`, error);
	}
	try {
		return JSON.parse(source);
	} catch (error) {
		throw new FiseError("INVALID_INPUT", `FISE CLI: '${path}' is not valid JSON.`, error);
	}
}

function writeJson(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp(): void {
	process.stdout.write([
		"FISE profile tooling",
		"",
		"Usage:",
		"  fise profile validate <manifest.json>",
		"  fise profile build <manifest.json>",
		"  fise profile vectors <manifest.json>",
		"  fise profile diff <old.json> <new.json>",
		"",
		"Use '-' as a manifest path to read JSON from stdin."
	].join("\n") + "\n");
}

function usage(message: string): FiseError {
	return new FiseError("INVALID_INPUT", `FISE CLI: ${message}.`);
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

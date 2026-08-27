import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function resolveNpmCli(environment = process.env) {
	const npmExecPath = environment.npm_execpath;
	if (npmExecPath && existsSync(npmExecPath)) {
		return Object.freeze({
			executable: environment.npm_node_execpath || process.execPath,
			prefix: Object.freeze([npmExecPath])
		});
	}

	const adjacentCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
	if (existsSync(adjacentCli)) {
		return Object.freeze({
			executable: process.execPath,
			prefix: Object.freeze([adjacentCli])
		});
	}

	if (process.platform === "win32") {
		throw new Error("npm CLI path is unavailable; run this verifier through its npm script.");
	}
	return Object.freeze({ executable: "npm", prefix: Object.freeze([]) });
}

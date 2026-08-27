import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { delimiter, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pythonSourceRoot = resolve(repositoryRoot, "python/src");
const command = findPython();
const result = spawnSync(
	command.executable,
	[
		...command.prefix,
		"-m",
		"unittest",
		"discover",
		"-s",
		"python/tests",
		"-p",
		"test_*.py",
		"-v"
	],
	{
		cwd: repositoryRoot,
		encoding: "utf8",
		env: {
			...process.env,
			PYTHONDONTWRITEBYTECODE: "1",
			PYTHONPATH: [pythonSourceRoot, process.env.PYTHONPATH]
				.filter(Boolean)
				.join(delimiter)
		}
	}
);
if (result.error) throw result.error;
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
assert.equal(result.status, 0, "Python FISE tests failed.");

function findPython() {
	for (const candidate of [
		{ executable: "python3", prefix: [] },
		{ executable: "python", prefix: [] },
		{ executable: "py", prefix: ["-3"] }
	]) {
		const probe = spawnSync(
			candidate.executable,
			[...candidate.prefix, "-c", "import sys;raise SystemExit(0 if sys.version_info >= (3,10) else 1)"],
			{ encoding: "utf8" }
		);
		if (!probe.error && probe.status === 0) return candidate;
	}
	throw new Error("Python 3.10 or newer is required for FISE Python tests.");
}

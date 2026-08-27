import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { delimiter, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Fise } from "fise";
import profile from "./fise.profile.mjs";

const examplesRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const packageRoot = resolve(examplesRoot, "..");
const python = findPython();
const result = spawnSync(
	python.executable,
	[...python.prefix, resolve(examplesRoot, "python-agent-backend.py"), "--json"],
	{
		cwd: examplesRoot,
		encoding: "utf8",
		env: {
			...process.env,
			PYTHONDONTWRITEBYTECODE: "1",
			PYTHONPATH: [resolve(packageRoot, "python/src"), process.env.PYTHONPATH]
				.filter(Boolean)
				.join(delimiter)
		}
	}
);
if (result.error) throw result.error;
assert.equal(result.status, 0, result.stderr);

const frame = JSON.parse(result.stdout);
const context = [
	"client_session_agent_7f4a",
	"user_42",
	"agent-stream",
	"v2",
	"agent_stream_1042",
	3
];
const event = new Fise(profile).decrypt(frame.data, context);
assert.deepEqual(event, {
	type: "tool.result",
	name: "lookupOrder",
	result: { orderId: "order_1042", status: "ready" }
});

console.log("PASS python-agent-interop: Python backend to JavaScript frontend exact restore");

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
	throw new Error("Python 3.10 or newer is required for the Python agent example.");
}

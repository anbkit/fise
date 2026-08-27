import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
const command = findPython();
const temporaryRoot = mkdtempSync(join(tmpdir(), "fise-python-package-"));
const wheelDirectory = join(temporaryRoot, "wheel");
const installedDirectory = join(temporaryRoot, "installed");
const sourceDirectory = join(temporaryRoot, "source");
mkdirSync(wheelDirectory);
mkdirSync(installedDirectory);
cpSync(join(repositoryRoot, "python"), sourceDirectory, { recursive: true });

try {
	runPython([
		"-m",
		"pip",
		"wheel",
		"--disable-pip-version-check",
		"--no-deps",
		"--wheel-dir",
		wheelDirectory,
		sourceDirectory
	]);
	const wheels = readdirSync(wheelDirectory).filter(path => path.endsWith(".whl"));
	assert.deepEqual(
		wheels,
		[`fise-${packageJson.version}-py3-none-any.whl`],
		"Python build must produce one version-matched universal wheel."
	);
	const wheelPath = join(wheelDirectory, wheels[0]);
	runPython([
		"-I",
		"-B",
		"-c",
		wheelInspectionSource(),
		wheelPath,
		packageJson.version
	]);
	runPython([
		"-m",
		"pip",
		"install",
		"--disable-pip-version-check",
		"--no-deps",
		"--no-index",
		"--target",
		installedDirectory,
		wheelPath
	]);
	const output = runPython([
		"-I",
		"-B",
		"-c",
		installedSmokeSource(),
		installedDirectory,
		join(repositoryRoot, "conformance/v2/profile_generated.py"),
		join(repositoryRoot, "conformance/v2/vectors.json"),
		packageJson.version
	]);
	assert.match(output, /PASS installed Python wheel/);
	assert.equal(
		existsSync(join(repositoryRoot, "conformance/v2/__pycache__")),
		false,
		"Installed wheel verification must not write Python bytecode into the repository."
	);
	process.stdout.write(output);
} finally {
	rmSync(temporaryRoot, { recursive: true, force: true });
}

function runPython(arguments_) {
	const result = spawnSync(command.executable, [...command.prefix, ...arguments_], {
		cwd: repositoryRoot,
		encoding: "utf8",
		env: {
			...process.env,
			PYTHONDONTWRITEBYTECODE: "1"
		},
		maxBuffer: 32 * 1024 * 1024
	});
	if (result.error) throw result.error;
	assert.equal(
		result.status,
		0,
		`${command.executable} ${arguments_.join(" ")} failed\n${result.stdout}\n${result.stderr}`
	);
	return result.stdout;
}

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
	throw new Error("Python 3.10 or newer with pip is required for package verification.");
}

function wheelInspectionSource() {
	return String.raw`
import sys, zipfile
wheel_path, version = sys.argv[1:]
with zipfile.ZipFile(wheel_path) as archive:
    names = set(archive.namelist())
    assert "fise/__init__.py" in names
    assert "fise/core.py" in names
    assert "fise/profile_runtime.py" in names
    assert "fise/py.typed" in names
    assert not any("__pycache__" in name or name.endswith((".pyc", ".pyo")) for name in names)
    metadata_name = next(name for name in names if name.endswith(".dist-info/METADATA"))
    metadata = archive.read(metadata_name).decode("utf-8")
assert f"Version: {version}" in metadata
assert "Requires-Python: >=3.10" in metadata
assert not any(line.startswith("Requires-Dist:") for line in metadata.splitlines())
`;
}

function installedSmokeSource() {
	return String.raw`
import importlib.metadata, importlib.util, json, pathlib, sys
installed, profile_path, vectors_path, version = sys.argv[1:]
sys.path.insert(0, installed)
from fise import Fise
assert importlib.metadata.version("fise") == version
spec = importlib.util.spec_from_file_location("fise_package_profile", profile_path)
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
context = ["session_package", "user_42", "agent-stream", "v2", 9]
structured = {"message": "installed wheel", "values": [None, True, 7]}
runtime = Fise(module.profile)
structured_envelope = runtime.encrypt(structured, context)
assert type(structured_envelope) is str
assert runtime.decrypt(structured_envelope, context) == structured
binary = bytes((index * 31 + 7) & 255 for index in range(8193))
edge = Fise(module.profile, binary="edges", edge_bytes=1024)
binary_envelope = edge.encrypt(binary, context)
assert type(binary_envelope) is bytes
assert edge.decrypt(binary_envelope, context) == binary
assert edge.decrypt_range(binary_envelope, 777, 7321, context) == binary[777:7321]
assert b"".join(edge.decrypt_progressive(binary_envelope, context, chunk_size=1111)) == binary
vectors = json.loads(pathlib.Path(vectors_path).read_text("utf-8"))
vector = next(item for item in vectors["envelopes"] if item["id"] == "structured")
value = json.loads(vector["inputJson"])
assert Fise(module.profile).encrypt(value, vector["context"]) == vector["expectedTransport"]
print("PASS installed Python wheel")
`;
}

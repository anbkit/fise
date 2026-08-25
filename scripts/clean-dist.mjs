import { rmSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, "..");
const distDirectory = resolve(projectDirectory, "dist");

if (dirname(distDirectory) !== projectDirectory || basename(distDirectory) !== "dist") {
	throw new Error(`Refusing to clean unexpected build directory: ${distDirectory}`);
}

rmSync(distDirectory, { recursive: true, force: true });

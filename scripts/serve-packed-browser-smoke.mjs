import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "fise-packed-browser-"));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const csp = [
	"default-src 'none'",
	"script-src 'self' 'wasm-unsafe-eval'",
	"connect-src 'self'",
	"img-src data:",
	"style-src 'none'",
	"base-uri 'none'",
	"object-src 'none'",
	"frame-ancestors 'none'"
].join("; ");

function run(command, args, cwd = repositoryRoot) {
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		env: {
			...process.env,
			npm_config_cache: join(temporaryRoot, "npm-cache"),
			npm_config_dry_run: "false"
		}
	});
	if (result.error) throw result.error;
	assert.equal(
		result.status,
		0,
		`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`
	);
	return result.stdout;
}

const [packMetadata] = JSON.parse(run(npmCommand, [
	"pack",
	"--json",
	"--pack-destination",
	temporaryRoot
]));
const tarballPath = join(temporaryRoot, packMetadata.filename);
const consumerRoot = join(temporaryRoot, "consumer");
mkdirSync(consumerRoot);
writeFileSync(
	join(consumerRoot, "package.json"),
	`${JSON.stringify({ name: "fise-packed-browser", private: true, type: "module" }, null, 2)}\n`
);
run(
	npmCommand,
	["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath],
	consumerRoot
);

const packageDistRoot = realpathSync(join(consumerRoot, "node_modules/fise/dist"));
const smokeHtmlPath = join(repositoryRoot, "tests/browser/wasm-smoke.html");
const smokeModulePath = join(repositoryRoot, "tests/browser/wasm-smoke.mjs");
let cleaned = false;

function cleanup() {
	if (cleaned) return;
	cleaned = true;
	rmSync(temporaryRoot, { recursive: true, force: true });
}

function send(response, status, contentType, body) {
	response.writeHead(status, {
		"Content-Type": contentType,
		"Content-Security-Policy": csp,
		"X-Content-Type-Options": "nosniff",
		"Cache-Control": "no-store",
		"Referrer-Policy": "no-referrer"
	});
	response.end(body);
}

function resolveDistFile(urlPath) {
	const relativePath = urlPath.slice("/dist/".length);
	const candidate = resolve(packageDistRoot, relativePath);
	if (
		candidate !== packageDistRoot &&
		!candidate.startsWith(`${packageDistRoot}${sep}`)
	) {
		return null;
	}
	return candidate;
}

const server = createServer((request, response) => {
	const url = new URL(request.url ?? "/", "http://127.0.0.1");
	if (url.pathname === "/" || url.pathname === "/index.html") {
		send(response, 200, "text/html; charset=utf-8", readFileSync(smokeHtmlPath));
		return;
	}
	if (url.pathname === "/smoke.mjs") {
		send(response, 200, "text/javascript; charset=utf-8", readFileSync(smokeModulePath));
		return;
	}
	if (url.pathname.startsWith("/dist/")) {
		const filePath = resolveDistFile(url.pathname);
		if (filePath && existsSync(filePath)) {
			const contentType = extname(filePath) === ".js"
				? "text/javascript; charset=utf-8"
				: "application/octet-stream";
			send(response, 200, contentType, readFileSync(filePath));
			return;
		}
	}
	send(response, 404, "text/plain; charset=utf-8", "Not found\n");
});

function close() {
	server.close(() => {
		cleanup();
		process.exit(0);
	});
}

process.once("SIGINT", close);
process.once("SIGTERM", close);
process.once("exit", cleanup);
server.once("error", (error) => {
	cleanup();
	console.error(error);
	process.exitCode = 1;
});
server.listen(0, "127.0.0.1", () => {
	const address = server.address();
	assert.ok(address && typeof address === "object");
	console.log(
		`FISE packed-browser smoke server: http://127.0.0.1:${address.port}/ ` +
		`(${packMetadata.entryCount} package entries, CSP enabled)`
	);
});

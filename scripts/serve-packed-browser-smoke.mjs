import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build as buildVite } from "vite";

import { resolveNpmCli } from "./npm-cli.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "fise-packed-browser-"));
const npmCli = resolveNpmCli();
const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
const suppliedTarball = parseSuppliedTarball(process.argv.slice(2));

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

function runNpm(args, cwd = repositoryRoot) {
	return run(npmCli.executable, [...npmCli.prefix, ...args], cwd);
}

let packMetadata;
let tarballPath;
if (suppliedTarball) {
	tarballPath = suppliedTarball;
	assert.ok(existsSync(tarballPath), `Supplied tarball does not exist: ${tarballPath}`);
	packMetadata = {
		filename: basename(tarballPath),
		entryCount: null,
		size: statSync(tarballPath).size
	};
} else {
	[packMetadata] = JSON.parse(runNpm([
		"pack",
		"--json",
		"--pack-destination",
		temporaryRoot
	]));
	tarballPath = join(temporaryRoot, packMetadata.filename);
}
const consumerRoot = join(temporaryRoot, "consumer");
mkdirSync(consumerRoot);
writeFileSync(
	join(consumerRoot, "package.json"),
	`${JSON.stringify({ name: "fise-packed-browser", private: true, type: "module" }, null, 2)}\n`
);
runNpm(
	["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath],
	consumerRoot
);

const installedPackageRoot = join(consumerRoot, "node_modules/fise");
const packageDistRoot = realpathSync(join(installedPackageRoot, "dist"));
const browserProfilePath = join(consumerRoot, "browser.profile.mjs");
run(
	process.execPath,
	[join(installedPackageRoot, "dist/cli.js"), "generate", browserProfilePath],
	consumerRoot
);
const { Fise: InstalledFise } = await import(
	pathToFileURL(join(installedPackageRoot, "dist/index.js")).href
);
const serverProfile = (await import(pathToFileURL(browserProfilePath).href)).default;
const serverFise = new InstalledFise(serverProfile);
const webSessionId = "client_session_vite_29";
const webUserId = "user_29";
const serverOrder = {
	items: [{ quantity: 2, sku: "fise-shirt" }],
	orderId: "order_vite_1042",
	status: "ready"
};
const serverReceipt = Uint8Array.from(
	{ length: 96 * 1024 + 7 },
	(_, index) => (index * 43 + 23) & 0xff
);
const installedPackageJson = JSON.parse(
	readFileSync(join(consumerRoot, "node_modules/fise/package.json"), "utf8")
);
assert.equal(installedPackageJson.name, packageJson.name);
assert.equal(installedPackageJson.version, packageJson.version);
const viteRoot = join(consumerRoot, "vite-app");
const viteSourceRoot = join(viteRoot, "src");
const viteDistRoot = join(viteRoot, "dist");
mkdirSync(viteSourceRoot, { recursive: true });
writeFileSync(join(viteSourceRoot, "fise.profile.mjs"), readFileSync(browserProfilePath));
writeFileSync(join(viteRoot, "index.html"), `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>FISE packed Vite smoke</title></head>
<body><pre id="result">RUNNING</pre><script type="module" src="/src/main.js"></script></body>
</html>
`);
writeFileSync(join(viteSourceRoot, "main.js"), `
import { Fise, isParallelSupported, isWasmSupported } from "fise";
import profile from "./fise.profile.mjs";

void main();

async function main() {
  const result = document.querySelector("#result");
  try {
  if (!isWasmSupported() || !isParallelSupported()) {
    throw new Error("WASM or dedicated workers are unavailable");
  }
  const fise = new Fise(profile);
  const context = ["vite-browser", 29, "orders", "v2"];
  const structured = {
    records: Array.from({ length: 300 }, (_, index) => ({
      id: index,
      resource: "vite-packed-browser",
      status: index % 2 === 0 ? "ready" : "pending"
    })),
    status: "ok"
  };
  const bytes = Uint8Array.from(
    { length: 400_003 },
    (_, index) => (index * 37 + 19) & 0xff
  );
  const structuredEnvelope = fise.encrypt(structured, context);
  const binaryEnvelope = fise.encrypt(bytes, context);
  assertJson(fise.decrypt(structuredEnvelope, context), structured);
  assertBytes(fise.decrypt(binaryEnvelope, context), bytes);

  const wasm = await fise.withWasm();
  assertJson(wasm.decrypt(structuredEnvelope, context), structured);

  const parallel = await fise.parallel({ workerCount: 2, minimumParallelBytes: 0 });
  try {
    assertBytes(await parallel.decrypt(binaryEnvelope, context), bytes);
    assertJson(fise.decrypt(await parallel.encrypt(structured, context), context), structured);
  } finally {
    await parallel.close();
  }

  const orderResponse = await fetch("/api/vite-order");
  if (!orderResponse.ok) throw new Error("structured HTTP response failed");
  if (!orderResponse.headers.get("content-type")?.startsWith("application/json")) {
    throw new Error("structured HTTP content type differs");
  }
  const orderTransport = await orderResponse.json();
  if (typeof orderTransport.data !== "string") {
    throw new Error("structured HTTP FISE data must be a string");
  }
  const orderContext = [
    "client_session_vite_29",
    "user_29",
    "orders",
    "v2",
    orderTransport.sequence
  ];
  const order = fise.decrypt(orderTransport.data, orderContext);
  if (
    !order ||
    typeof order !== "object" ||
    order.orderId !== "order_vite_1042" ||
    order.status !== "ready" ||
    !Array.isArray(order.items)
  ) {
    throw new Error("restored HTTP order failed schema validation");
  }

  const receiptResponse = await fetch("/api/vite-receipt");
  if (!receiptResponse.ok) throw new Error("binary HTTP response failed");
  if (receiptResponse.headers.get("content-type") !== "application/octet-stream") {
    throw new Error("binary HTTP content type differs");
  }
  const receiptSequence = Number(receiptResponse.headers.get("x-fise-sequence"));
  const receiptContext = [
    "client_session_vite_29",
    "user_29",
    "receipts",
    "v2",
    receiptSequence
  ];
  const encryptedReceipt = new Uint8Array(await receiptResponse.arrayBuffer());
  const receipt = fise.decrypt(encryptedReceipt, receiptContext);
  if (!(receipt instanceof Uint8Array) || receipt.length !== 96 * 1024 + 7) {
    throw new Error("restored HTTP receipt has the wrong shape");
  }
  for (let index = 0; index < receipt.length; index++) {
    if (receipt[index] !== ((index * 43 + 23) & 0xff)) {
      throw new Error("restored HTTP receipt byte differs");
    }
  }
  const receiptBlob = new Blob([receipt], { type: "application/pdf" });
  if (receiptBlob.size !== receipt.length || receiptBlob.type !== "application/pdf") {
    throw new Error("restored HTTP receipt Blob differs");
  }

  result.textContent = "PASS: Vite bundle + worker + HTTP JSON/binary restore";
  document.documentElement.dataset.status = "pass";
  document.documentElement.dataset.profile = profile.fingerprint;
  document.documentElement.dataset.bundler = "vite";
  document.documentElement.dataset.http = "pass";
  } catch (error) {
    result.textContent = "FAIL: " + (error instanceof Error ? error.message : String(error));
    document.documentElement.dataset.status = "fail";
    throw error;
  }
}

function assertBytes(actual, expected) {
  if (!(actual instanceof Uint8Array) || actual.length !== expected.length) {
    throw new Error("restored byte length differs");
  }
  for (let index = 0; index < actual.length; index++) {
    if (actual[index] !== expected[index]) throw new Error("restored byte differs");
  }
}

function assertJson(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("restored structured value differs");
  }
}
`);
const buildWorkingDirectory = process.cwd();
try {
	process.chdir(viteRoot);
	await buildVite({
		root: ".",
		configFile: false,
		base: "/vite/",
		logLevel: "silent",
		build: {
			target: "es2020",
			outDir: "dist",
			emptyOutDir: true
		}
	});
} finally {
	process.chdir(buildWorkingDirectory);
}
const viteFiles = readdirSync(viteDistRoot, { recursive: true }).map(String);
const viteJavaScript = viteFiles
	.filter(path => path.endsWith(".js"))
	.map(path => readFileSync(join(viteDistRoot, path), "utf8"))
	.join("\n");
assert.match(viteJavaScript, /new Worker\(/, "Vite output did not retain a browser worker");
assert.ok(
	viteFiles.some(path => /profileWorker.*\.js$/.test(path)),
	"Vite output did not emit the FISE profile worker asset"
);
const smokeHtmlPath = join(repositoryRoot, "tests/browser/wasm-smoke.html");
const smokeModulePath = join(repositoryRoot, "tests/browser/wasm-smoke.mjs");
const smokeHtml = readFileSync(smokeHtmlPath);
const importMapMatch = smokeHtml.toString("utf8").match(
	/<script type="importmap">([\s\S]*?)<\/script>/
);
assert.ok(importMapMatch, "Browser smoke HTML must contain one inline import map");
const importMapHash = createHash("sha256")
	.update(importMapMatch[1])
	.digest("base64");
const csp = [
	"default-src 'none'",
	`script-src 'self' 'wasm-unsafe-eval' 'sha256-${importMapHash}'`,
	"connect-src 'self'",
	"worker-src 'self'",
	"img-src data:",
	"style-src 'none'",
	"base-uri 'none'",
	"object-src 'none'",
	"frame-ancestors 'none'"
].join("; ");
let cleaned = false;

function cleanup() {
	if (cleaned) return;
	cleaned = true;
	rmSync(temporaryRoot, { recursive: true, force: true });
}

function send(response, status, contentType, body, extraHeaders = {}) {
	response.writeHead(status, {
		"Content-Type": contentType,
		"Content-Security-Policy": csp,
		"X-Content-Type-Options": "nosniff",
		"Cache-Control": "no-store",
		"Referrer-Policy": "no-referrer",
		...extraHeaders
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

function resolveViteFile(urlPath) {
	const relativePath = urlPath === "/vite/"
		? "index.html"
		: urlPath.slice("/vite/".length);
	const candidate = resolve(viteDistRoot, relativePath);
	if (candidate !== viteDistRoot && !candidate.startsWith(`${viteDistRoot}${sep}`)) {
		return null;
	}
	return candidate;
}

function contentTypeFor(path) {
	switch (extname(path)) {
		case ".html": return "text/html; charset=utf-8";
		case ".js": return "text/javascript; charset=utf-8";
		case ".css": return "text/css; charset=utf-8";
		case ".wasm": return "application/wasm";
		default: return "application/octet-stream";
	}
}

const server = createServer((request, response) => {
	const url = new URL(request.url ?? "/", "http://127.0.0.1");
	if (url.pathname === "/api/vite-order") {
		const sequence = 41;
		const context = [webSessionId, webUserId, "orders", "v2", sequence];
		send(
			response,
			200,
			"application/json; charset=utf-8",
			JSON.stringify({ data: serverFise.encrypt(serverOrder, context), sequence })
		);
		return;
	}
	if (url.pathname === "/api/vite-receipt") {
		const sequence = 42;
		const context = [webSessionId, webUserId, "receipts", "v2", sequence];
		send(
			response,
			200,
			"application/octet-stream",
			serverFise.encrypt(serverReceipt, context),
			{ "X-FISE-Sequence": String(sequence) }
		);
		return;
	}
	if (url.pathname === "/" || url.pathname === "/index.html") {
		send(response, 200, "text/html; charset=utf-8", smokeHtml);
		return;
	}
	if (url.pathname === "/smoke.mjs") {
		send(response, 200, "text/javascript; charset=utf-8", readFileSync(smokeModulePath));
		return;
	}
	if (url.pathname === "/profile.mjs") {
		send(response, 200, "text/javascript; charset=utf-8", readFileSync(browserProfilePath));
		return;
	}
	if (url.pathname === "/vite" || url.pathname.startsWith("/vite/")) {
		const filePath = resolveViteFile(url.pathname === "/vite" ? "/vite/" : url.pathname);
		if (filePath && existsSync(filePath)) {
			send(response, 200, contentTypeFor(filePath), readFileSync(filePath));
			return;
		}
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
		`(${packMetadata.entryCount === null ? "supplied exact artifact" : `${packMetadata.entryCount} package entries`}, CSP enabled)`
	);
});

function parseSuppliedTarball(arguments_) {
	if (arguments_.length === 0) return undefined;
	assert.deepEqual(
		arguments_.slice(0, 1),
		["--tarball"],
		"Usage: node scripts/serve-packed-browser-smoke.mjs [--tarball <path>]"
	);
	assert.equal(
		arguments_.length,
		2,
		"Usage: node scripts/serve-packed-browser-smoke.mjs [--tarball <path>]"
	);
	return resolve(process.cwd(), arguments_[1]);
}

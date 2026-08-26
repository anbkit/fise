import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = resolve(repositoryRoot, "scripts/serve-packed-browser-smoke.mjs");
const server = spawn(process.execPath, [serverPath, ...process.argv.slice(2)], {
	cwd: repositoryRoot,
	env: process.env,
	stdio: ["ignore", "pipe", "pipe"]
});
let browser;

try {
	const serverUrl = await waitForServer(server);
	browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();
	const browserFailures = [];
	page.on("console", message => {
		if (message.type() === "warning" || message.type() === "error") {
			browserFailures.push(`console ${message.type()}: ${message.text()}`);
		}
	});
	page.on("pageerror", error => browserFailures.push(`page error: ${error.message}`));
	page.on("requestfailed", request => {
		browserFailures.push(
			`request failed: ${request.url()} (${request.failure()?.errorText ?? "unknown error"})`
		);
	});

	const response = await page.goto(serverUrl, {
		waitUntil: "domcontentloaded",
		timeout: 60_000
	});
	assert.ok(response, "Packed-browser navigation returned no response.");
	assert.ok(response.ok(), `Packed-browser navigation returned HTTP ${response.status()}.`);
	await page.waitForFunction(
		() => ["pass", "fail"].includes(document.documentElement.dataset.status ?? ""),
		undefined,
		{ timeout: 60_000 }
	);
	const evidence = await page.evaluate(() => ({
		status: document.documentElement.dataset.status,
		profile: document.documentElement.dataset.profile,
		frames: document.documentElement.dataset.frames,
		csp: document.documentElement.dataset.csp,
		result: document.querySelector("#result")?.textContent ?? ""
	}));
	assert.equal(evidence.status, "pass", evidence.result || "Packed-browser smoke failed.");
	assert.match(evidence.profile ?? "", /^[0-9a-f]{32}$/);
	assert.equal(evidence.frames, "5");
	assert.equal(evidence.csp, "pass");
	assert.deepEqual(browserFailures, [], browserFailures.join("\n"));
	console.log(
		`Packed Chromium PASS: profile ${evidence.profile}, ${evidence.frames} FISF frames, ` +
		"structured/binary + JS/WASM/workers + CSP."
	);
} finally {
	await browser?.close();
	await stopServer(server);
}

function waitForServer(child) {
	return new Promise((resolveUrl, reject) => {
		let stdout = "";
		let stderr = "";
		const timeout = setTimeout(() => {
			reject(new Error(`Packed-browser server timed out.\n${stdout}\n${stderr}`));
		}, 120_000);
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", chunk => {
			stdout += chunk;
			const match = stdout.match(/FISE packed-browser smoke server: (http:\/\/127\.0\.0\.1:\d+\/)/);
			if (!match) return;
			clearTimeout(timeout);
			resolveUrl(match[1]);
		});
		child.stderr.on("data", chunk => {
			stderr += chunk;
		});
		child.once("error", error => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once("exit", code => {
			clearTimeout(timeout);
			reject(
				new Error(
					`Packed-browser server exited before startup with code ${code}.\n${stdout}\n${stderr}`
				)
			);
		});
	});
}

async function stopServer(child) {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = new Promise(resolveExit => child.once("exit", resolveExit));
	child.kill("SIGTERM");
	let timeoutHandle;
	const stopped = await Promise.race([
		exited.then(() => true),
		new Promise(resolveTimeout => {
			timeoutHandle = setTimeout(() => resolveTimeout(false), 5_000);
		})
	]);
	clearTimeout(timeoutHandle);
	if (!stopped && child.exitCode === null && child.signalCode === null) {
		child.kill("SIGKILL");
		await exited;
	}
}

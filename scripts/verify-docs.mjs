import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const documents = [
	"README.md",
	"CONTRIBUTING.md",
	...readdirSync(resolve(repositoryRoot, "docs"))
		.filter(name => name.endsWith(".md"))
		.map(name => `docs/${name}`)
];

for (const document of documents) {
	const absoluteDocument = resolve(repositoryRoot, document);
	const source = readFileSync(absoluteDocument, "utf8");
	const links = source.matchAll(/!?(?:\[[^\]]*\])\(([^)]+)\)/g);
	for (const match of links) {
		const rawTarget = match[1].trim();
		if (/^(?:https?:|mailto:|#)/i.test(rawTarget)) continue;
		const targetWithoutFragment = rawTarget.split("#", 1)[0];
		const target = resolve(dirname(absoluteDocument), decodeURIComponent(targetWithoutFragment));
		assert.ok(existsSync(target), `${document} links to missing file: ${rawTarget}`);
	}
}

console.log(`Verified local Markdown links in ${documents.length} FISE documents.`);

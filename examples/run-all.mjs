const examples = [
	"basic.mjs",
	"api-session.mjs",
	"web-application.mjs",
	"agent-stream.mjs",
	"binary-file.mjs",
	"binary-restoration.mjs",
	"backends.mjs",
	"failure-boundaries.mjs",
	"raw-fallback.mjs",
	"ttl.mjs"
];

for (const example of examples) {
	await import(new URL(example, import.meta.url));
}

console.log(`Verified ${examples.length} runnable FISE examples.`);

const examples = [
	"basic.mjs",
	"api-session.mjs",
	"binary-file.mjs",
	"framed.mjs",
	"backends.mjs",
	"failure-boundaries.mjs"
];

for (const example of examples) {
	await import(new URL(example, import.meta.url));
}

console.log(`Verified ${examples.length} runnable FISE examples.`);

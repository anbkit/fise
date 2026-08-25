const examples = [
	"basic-string.mjs",
	"binary-payload.mjs",
	"parallel-binary.mjs",
	"framed-binary.mjs",
	"json-http.mjs",
	"time-window.mjs",
	"wasm-backend.mjs",
	"profile-rotation.mjs"
];

for (const example of examples) {
	await import(new URL(example, import.meta.url));
}

console.log(`Verified ${examples.length} runnable FISE examples.`);

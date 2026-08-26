import {
	Fise,
	FISE_WIRE_VERSION,
	FISF_WIRE_VERSION,
	isParallelSupported,
	isWasmSupported
} from "fise";
import profile from "/profile.mjs";

const result = document.querySelector("#result");

try {
	const pageResponse = await fetch(location.href, { cache: "no-store" });
	const csp = pageResponse.headers.get("content-security-policy") ?? "";
	if (!csp.includes("'wasm-unsafe-eval'") || !csp.includes("worker-src 'self'")) {
		throw new Error("packed browser CSP does not authorize the tested WASM/worker paths");
	}
	if (!isWasmSupported() || !isParallelSupported()) {
		throw new Error("this browser does not expose WebAssembly and dedicated workers");
	}
	if (FISE_WIRE_VERSION.major !== 2 || FISF_WIRE_VERSION.major !== 2) {
		throw new Error("unexpected FISE/FISF wire version");
	}

	const javascript = new Fise(profile);
	const context = [23, "packed-browser"];
	const structured = { browser: true, text: "FISE 2.0 \ud83c\udf0d", values: [1, null, false] };
	const input = Uint8Array.from(
		{ length: 300_007 },
		(_, index) => (index * 31 + 17) & 0xff
	);
	assertDeepEqual(javascript.decrypt(javascript.encrypt(structured, context), context), structured);
	assertBytes(javascript.decrypt(javascript.encrypt(input, context), context), input);

	const wasm = await javascript.withWasm();
	assertBytes(wasm.decrypt(javascript.encrypt(input, context), context), input);
	assertBytes(javascript.decrypt(wasm.encrypt(input, context), context), input);

	const parallel = await javascript.parallel({ workerCount: 2, minimumParallelBytes: 0 });
	let frameCount = 0;
	try {
		assertBytes(await parallel.decrypt(javascript.encrypt(input, context), context), input);
		assertBytes(javascript.decrypt(await parallel.encrypt(input, context), context), input);

		const framed = await parallel.encryptFramed(input, context, { frameSize: 64 * 1024 });
		assertBytes(await parallel.decryptFramed(framed, context), input);
		assertBytes(
			await parallel.decryptRange(
				framed,
				{ start: 65_000, endExclusive: 232_000 },
				context
			),
			input.slice(65_000, 232_000)
		);
		const frames = [];
		for await (const frame of parallel.decryptProgressive(framed, context)) {
			frames.push(frame);
			frameCount++;
		}
		assertBytes(join(frames), input);
	} finally {
		await parallel.close();
	}

	result.value = "PASS: packed FISE 2.0 profile + structured/binary + JS/WASM/workers + FISF range/progressive";
	result.textContent = result.value;
	document.documentElement.dataset.status = "pass";
	document.documentElement.dataset.profile = profile.fingerprint;
	document.documentElement.dataset.frames = String(frameCount);
	document.documentElement.dataset.csp = "pass";
} catch (error) {
	result.value = `FAIL: ${error instanceof Error ? error.message : String(error)}`;
	result.textContent = result.value;
	document.documentElement.dataset.status = "fail";
	throw error;
}

function assertBytes(actual, expected) {
	if (!(actual instanceof Uint8Array) || actual.length !== expected.length) {
		throw new Error("restored byte length differs");
	}
	for (let index = 0; index < actual.length; index++) {
		if (actual[index] !== expected[index]) throw new Error(`restored byte ${index} differs`);
	}
}

function assertDeepEqual(actual, expected) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error("restored structured value differs");
	}
}

function join(frames) {
	const output = new Uint8Array(frames.reduce((length, frame) => length + frame.length, 0));
	let offset = 0;
	for (const frame of frames) {
		output.set(frame, offset);
		offset += frame.length;
	}
	return output;
}

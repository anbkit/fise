import {
	Fise,
	FISE_WIRE_VERSION,
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
	if (FISE_WIRE_VERSION.major !== 2) {
		throw new Error("unexpected FISE wire version");
	}

	const javascript = new Fise(profile);
	const edgeJavascript = new Fise(profile, {
		binary: { mode: "edges", edgeBytes: 32 * 1024 }
	});
	const fallback = new Fise(profile, { strict: false });
	const expiring = new Fise(profile, { ttlSeconds: 3_600 });
	const context = [23, "packed-browser"];
	const structured = { browser: true, text: "FISE 2.0 \ud83c\udf0d", values: [1, null, false] };
	const compressedStructured = {
		records: Array.from({ length: 300 }, (_, index) => ({
			id: index,
			resource: "packed-browser-compression",
			status: index % 2 === 0 ? "ready" : "pending"
		})),
		status: "ok"
	};
	const input = Uint8Array.from(
		{ length: 300_007 },
		(_, index) => (index * 31 + 17) & 0xff
	);
	const structuredEnvelope = javascript.encrypt(structured, context);
	const compressedStructuredEnvelope = javascript.encrypt(compressedStructured, context);
	const binaryEnvelope = javascript.encrypt(input, context);
	const edgeEnvelope = edgeJavascript.encrypt(input, context);
	if (typeof structuredEnvelope !== "string" || !(binaryEnvelope instanceof Uint8Array)) {
		throw new Error("encrypted transport representation does not match input type");
	}
	if (compressedStructuredEnvelope.length >= JSON.stringify(compressedStructured).length) {
		throw new Error("adaptive structured compression did not reduce the repetitive fixture");
	}
	assertDeepEqual(javascript.decrypt(structuredEnvelope, context), structured);
	assertDeepEqual(
		javascript.decrypt(compressedStructuredEnvelope, context),
		compressedStructured
	);
	assertBytes(javascript.decrypt(binaryEnvelope, context), input);
	assertBytes(javascript.decrypt(edgeEnvelope, context), input);
	const ttlEnvelope = expiring.encrypt(structured, context);
	assertDeepEqual(javascript.decrypt(ttlEnvelope, context), structured);
	if (expiring.ttlSeconds !== 3_600) throw new Error("constructor TTL was not retained");
	const unsupported = new Date("2026-08-27T00:00:00.000Z");
	if (fallback.encrypt(unsupported) !== unsupported) {
		throw new Error("JavaScript raw fallback did not preserve its input");
	}

	const wasm = await javascript.withWasm();
	const edgeWasm = await edgeJavascript.withWasm();
	assertDeepEqual(wasm.decrypt(ttlEnvelope, context), structured);
	assertDeepEqual(wasm.decrypt(compressedStructuredEnvelope, context), compressedStructured);
	assertBytes(wasm.decrypt(javascript.encrypt(input, context), context), input);
	assertBytes(wasm.decrypt(edgeEnvelope, context), input);
	assertBytes(javascript.decrypt(edgeWasm.encrypt(input, context), context), input);
	assertBytes(javascript.decrypt(wasm.encrypt(input, context), context), input);
	const fallbackWasm = await fallback.withWasm();
	if (fallbackWasm.strict || fallbackWasm.encrypt(unsupported) !== unsupported) {
		throw new Error("WASM raw fallback did not preserve its input");
	}

	const parallel = await fallback.parallel({ workerCount: 2, minimumParallelBytes: 0 });
	let chunkCount = 0;
	try {
		if (parallel.strict || (await parallel.encrypt(unsupported)) !== unsupported) {
			throw new Error("worker raw fallback did not preserve its input");
		}
		assertBytes(await parallel.decrypt(binaryEnvelope, context), input);
		assertBytes(await parallel.decrypt(edgeEnvelope, context), input);
		assertDeepEqual(await parallel.decrypt(ttlEnvelope, context), structured);
		assertDeepEqual(
			await parallel.decrypt(compressedStructuredEnvelope, context),
			compressedStructured
		);
		assertBytes(javascript.decrypt(await parallel.encrypt(input, context), context), input);

		assertBytes(
			await parallel.decryptRange(
				binaryEnvelope,
				{ start: 65_000, endExclusive: 232_000 },
				context
			),
			input.slice(65_000, 232_000)
		);
		assertBytes(
			await parallel.decryptRange(
				edgeEnvelope,
				{ start: 31_000, endExclusive: 268_000 },
				context
			),
			input.slice(31_000, 268_000)
		);
		const chunks = [];
		for await (const chunk of parallel.decryptProgressive(binaryEnvelope, context, {
			chunkSize: 64 * 1024
		})) {
			chunks.push(chunk);
			chunkCount++;
		}
		assertBytes(join(chunks), input);
	} finally {
		await parallel.close();
	}

	result.value =
		"PASS: packed FISE 2.0 profile + Base64URL/binary + adaptive structured compression + full/edge coverage + TTL + raw fallback + JS/WASM/workers + direct range/progressive";
	result.textContent = result.value;
	document.documentElement.dataset.status = "pass";
	document.documentElement.dataset.profile = profile.fingerprint;
	document.documentElement.dataset.chunks = String(chunkCount);
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

function join(chunks) {
	const output = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.length;
	}
	return output;
}

import {
	FISE_WIRE_VERSION,
	compileFiseProfileManifest,
	createParallelXorBinaryCipher,
	createWasmXorBinaryCipher,
	defaultBinaryProfile,
	defaultStringProfile,
	fiseBinaryDecrypt,
	fiseBinaryEncrypt,
	fiseBinaryDecryptAsync,
	fiseBinaryEncryptAsync,
	fiseDecrypt,
	fiseEncrypt,
	fiseFramedBinaryDecrypt,
	fiseFramedBinaryDecryptProgressive,
	fiseFramedBinaryDecryptRange,
	fiseFramedBinaryEncrypt,
	resolveFiseTimeWindow,
	withBinaryBackend,
	xorBinaryCipher
} from "/dist/index.js";
import {
	createFiseJsonResponse,
	readFiseJsonResponse
} from "/dist/http.js";

const result = document.querySelector("#result");
const equal = (left, right) =>
	left.length === right.length && left.every((byte, index) => byte === right[index]);

try {
	const pageResponse = await fetch(location.href, { cache: "no-store" });
	const csp = pageResponse.headers.get("content-security-policy") ?? "";
	const compiled = await compileFiseProfileManifest({
		schema: "fise.profile/1",
		name: "browser.smoke",
		revision: 1,
		representation: "binary",
		transform: "xor-u8-v1",
		saltRange: { min: 10, max: 12 },
		marker: { kind: "uint-be", width: 2 },
		offset: {
			kind: "affine",
			lengthMultiplier: 7,
			saltMultiplier: 3
		},
		limits: { maxEnvelopeLength: 1_000_000 }
	});
	const jsonResponse = createFiseJsonResponse(
		{ browser: true, profileId: compiled.profileId },
		compiled.profile
	);
	const restoredJson = await readFiseJsonResponse(jsonResponse, compiled.profile);
	const timeWindow = resolveFiseTimeWindow(60_000, { durationMs: 60_000 });
	const wasmCipher = await createWasmXorBinaryCipher({ maxMemoryPages: 8 });
	const text = "FISE browser round trip \ud83c\udf0d";
	const textEnvelope = fiseEncrypt(text, defaultStringProfile);
	const restoredText = fiseDecrypt(textEnvelope, defaultStringProfile);
	const input = Uint8Array.from(
		{ length: 256 * 1024 },
		(_, index) => (index * 31 + 17) & 0xff
	);
	const salt = Uint8Array.from({ length: 67 }, (_, index) => index + 1);
	const parity = wasmCipher.encrypt(input, salt);
	const expected = xorBinaryCipher.encrypt(input, salt);
	const jsEnvelope = fiseBinaryEncrypt(input, defaultBinaryProfile);
	const jsDecrypted = fiseBinaryDecrypt(jsEnvelope, defaultBinaryProfile);
	const wasmProfile = withBinaryBackend(defaultBinaryProfile, wasmCipher);
	const wasmEnvelope = fiseBinaryEncrypt(input, wasmProfile);
	const wasmDecrypted = fiseBinaryDecrypt(wasmEnvelope, wasmProfile);
	const jsEnvelopeViaWasm = fiseBinaryDecrypt(jsEnvelope, wasmProfile);
	const wasmEnvelopeViaJs = fiseBinaryDecrypt(wasmEnvelope, defaultBinaryProfile);
	const parallel = await createParallelXorBinaryCipher({
		workerCount: 2,
		minimumParallelBytes: 0
	});
	let parallelDecrypted;
	let framedDecrypted;
	let framedRange;
	let progressiveLength = 0;
	try {
		const parallelEnvelope = await fiseBinaryEncryptAsync(
			input,
			defaultBinaryProfile,
			{ backend: parallel }
		);
		parallelDecrypted = await fiseBinaryDecryptAsync(
			parallelEnvelope,
			defaultBinaryProfile,
			{ backend: parallel }
		);
		const framed = await fiseFramedBinaryEncrypt(input, defaultBinaryProfile, {
			frameSize: 64 * 1024,
			concurrency: 2,
			backend: parallel
		});
		framedDecrypted = await fiseFramedBinaryDecrypt(
			framed,
			defaultBinaryProfile,
			{ concurrency: 2, backend: parallel }
		);
		framedRange = await fiseFramedBinaryDecryptRange(
			framed,
			defaultBinaryProfile,
			{ start: 65_000, endExclusive: 132_000 },
			{ backend: parallel }
		);
		for await (const frame of fiseFramedBinaryDecryptProgressive(
			framed,
			defaultBinaryProfile,
			{ backend: parallel }
		)) {
			progressiveLength += frame.length;
		}
	} finally {
		await parallel.close();
	}
	let memoryCapRejected = false;
	try {
		wasmCipher.encrypt(new Uint8Array(8 * 64 * 1024), new Uint8Array([1]));
	} catch (error) {
		memoryCapRejected = error?.code === "WASM_MEMORY_LIMIT";
	}

	const hasBinaryV11Header =
		wasmEnvelope[0] === 0x46 &&
		wasmEnvelope[1] === 0x49 &&
		wasmEnvelope[2] === 0x53 &&
		wasmEnvelope[3] === 0x45 &&
		wasmEnvelope[4] === 1 &&
		wasmEnvelope[5] === 1;
	if (
		FISE_WIRE_VERSION.major !== 1 ||
		FISE_WIRE_VERSION.minor !== 1 ||
		!csp.includes("'wasm-unsafe-eval'") ||
		!csp.includes("worker-src 'self'") ||
		restoredJson.browser !== true ||
		restoredJson.profileId !== compiled.profileId ||
		!compiled.profileId.startsWith("browser.smoke.v1.") ||
		!Object.isFrozen(compiled.manifest) ||
		!Object.isFrozen(compiled.manifest.offset) ||
		timeWindow.timestamp !== 1 ||
		timeWindow.startMs !== 60_000 ||
		timeWindow.endExclusiveMs !== 120_000 ||
		restoredText !== text ||
		!textEnvelope.startsWith("FISE0101") ||
		!hasBinaryV11Header ||
		!equal(parity, expected) ||
		!equal(jsDecrypted, input) ||
		!equal(wasmDecrypted, input) ||
		!equal(jsEnvelopeViaWasm, input) ||
		!equal(wasmEnvelopeViaJs, input) ||
		!equal(parallelDecrypted, input) ||
		!equal(framedDecrypted, input) ||
		!equal(framedRange, input.slice(65_000, 132_000)) ||
		progressiveLength !== input.length ||
		!memoryCapRejected
	) {
		throw new Error("Manifest, time window, CSP, HTTP, string, JS/WASM/worker binary, or framed check failed");
	}

	result.value = "PASS: packed manifest + time window + CSP + HTTP + string + JS/WASM/worker + framed range/progressive";
	result.textContent = result.value;
	document.documentElement.dataset.status = "pass";
	document.documentElement.dataset.profile = compiled.profileId;
	document.documentElement.dataset.csp = "pass";
} catch (error) {
	result.value = `FAIL: ${error.message}`;
	result.textContent = result.value;
	document.documentElement.dataset.status = "fail";
	throw error;
}

import {
	FISE_WIRE_VERSION,
	compileFiseProfileManifest,
	createWasmXorBinaryCipher,
	defaultBinaryProfile,
	defaultStringProfile,
	fiseBinaryDecrypt,
	fiseBinaryEncrypt,
	fiseDecrypt,
	fiseEncrypt,
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
		restoredJson.browser !== true ||
		restoredJson.profileId !== compiled.profileId ||
		!compiled.profileId.startsWith("browser.smoke.v1.") ||
		!Object.isFrozen(compiled.manifest) ||
		!Object.isFrozen(compiled.manifest.offset) ||
		restoredText !== text ||
		!textEnvelope.startsWith("FISE0101") ||
		!hasBinaryV11Header ||
		!equal(parity, expected) ||
		!equal(jsDecrypted, input) ||
		!equal(wasmDecrypted, input) ||
		!equal(jsEnvelopeViaWasm, input) ||
		!equal(wasmEnvelopeViaJs, input) ||
		!memoryCapRejected
	) {
		throw new Error("Manifest, CSP, HTTP, string, JS binary, or WASM check failed");
	}

	result.value = "PASS: packed manifest + CSP + HTTP + string + JS/WASM binary";
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

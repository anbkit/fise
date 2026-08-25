import {
	defaultBinaryProfile,
	defaultStringProfile,
	createParallelXorBinaryCipher,
	createWasmXorBinaryCipher,
	defineStringProfile,
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
	xorCipher,
	type FiseTimeWindow,
	type FiseTimeWindowOptions,
	type FiseBinaryRange,
	type FiseFramedBinaryEncryptOptions,
	type ParallelXorBinaryCipherOptions,
	type FiseStringProfile,
	type WasmXorBinaryCipherOptions
} from "fise";
import {
	createBinaryConformanceEnvelope,
	createFramedBinaryConformanceEnvelope,
	createStringConformanceEnvelope
} from "fise/conformance";
import {
	createFiseJsonResponse,
	readFiseJsonResponse
} from "fise/http";
import {
	compileFiseProfileManifest,
	createFiseProfileArtifact
} from "fise/profiles";

const stringProfile: FiseStringProfile = defineStringProfile({
	id: "types.consumer.string",
	representation: "string",
	transform: xorCipher,
	layout: {
		markerSize: 2,
		offset(input) {
			return input.transformedLength;
		},
		createMarker(input) {
			return input.saltLength.toString(36).padStart(2, "0");
		}
	}
});

const stringEnvelope = fiseEncrypt("types", stringProfile);
const stringValue: string = fiseDecrypt(stringEnvelope, stringProfile);
const binaryEnvelope = fiseBinaryEncrypt(new Uint8Array([1]), defaultBinaryProfile);
const binaryValue: Uint8Array = fiseBinaryDecrypt(binaryEnvelope, defaultBinaryProfile);
const wasmOptions: WasmXorBinaryCipherOptions = { maxMemoryPages: 32 };
void createWasmXorBinaryCipher(wasmOptions);
const timeWindowOptions: FiseTimeWindowOptions = { durationMs: 60_000 };
const timeWindow: FiseTimeWindow = resolveFiseTimeWindow(Date.now(), timeWindowOptions);
fiseEncrypt("windowed", defaultStringProfile, { timestamp: timeWindow.timestamp });

createStringConformanceEnvelope(
	stringValue,
	"0123456789",
	defaultStringProfile
);
createBinaryConformanceEnvelope(
	binaryValue,
	new Uint8Array(10),
	defaultBinaryProfile
);
createFramedBinaryConformanceEnvelope(
	binaryValue,
	[new Uint8Array(10)],
	defaultBinaryProfile,
	{ frameSize: 1 }
);

async function verifySubpaths(): Promise<void> {
	const parallelOptions: ParallelXorBinaryCipherOptions = {
		workerCount: 2,
		minimumParallelBytes: 1024
	};
	const parallel = await createParallelXorBinaryCipher(parallelOptions);
	try {
		const asyncEnvelope = await fiseBinaryEncryptAsync(
			binaryValue,
			defaultBinaryProfile,
			{ backend: parallel }
		);
		await fiseBinaryDecryptAsync(asyncEnvelope, defaultBinaryProfile, {
			backend: parallel
		});
		const framedOptions: FiseFramedBinaryEncryptOptions = {
			frameSize: 1,
			concurrency: 2,
			backend: parallel
		};
		const framed = await fiseFramedBinaryEncrypt(
			binaryValue,
			defaultBinaryProfile,
			framedOptions
		);
		await fiseFramedBinaryDecrypt(framed, defaultBinaryProfile);
		const range: FiseBinaryRange = { start: 0, endExclusive: 1 };
		await fiseFramedBinaryDecryptRange(
			framed,
			defaultBinaryProfile,
			range
		);
		for await (const frame of fiseFramedBinaryDecryptProgressive(
			framed,
			defaultBinaryProfile
		)) {
			void frame;
		}
	} finally {
		await parallel.close();
	}
	const compiled = await compileFiseProfileManifest({
		schema: "fise.profile/1",
		name: "types.consumer",
		revision: 1,
		representation: "binary",
		transform: "xor-u8-v1",
		marker: { kind: "uint-be", width: 2 },
		offset: { kind: "affine" }
	});
	if (compiled.profile.representation !== "binary") {
		throw new Error("expected the binary manifest to compile as a binary profile");
	}
	createFiseProfileArtifact(compiled);
	const response = createFiseJsonResponse({ ok: true }, compiled.profile);
	const restored = await readFiseJsonResponse<{ ok: boolean }>(
		response,
		compiled.profile
	);
	if (!restored.ok) throw new Error("unreachable");
}

void verifySubpaths;

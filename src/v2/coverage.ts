import { FiseError } from "../errors.js";
import { snapshotOwnDataProperties } from "./options.js";
import { bindExpiryToEncodedContext } from "./temporal.js";

const MAX_UINT32 = 0xffff_ffff;
const EDGE_BINDING_PREFIX = Uint8Array.of(
	0x00,
	0x46,
	0x49,
	0x53,
	0x45,
	0x2d,
	0x45,
	0x44,
	0x47,
	0x45,
	0x01
);

export const DEFAULT_EDGE_BYTES = 1024 * 1024;

export interface FiseBinaryOptions {
	readonly mode: "edges";
	readonly edgeBytes?: number;
}

export type ResolvedFiseBinaryOptions = Readonly<{
	mode: "edges";
	edgeBytes: number;
}>;

export type EnvelopeCoverage =
	| Readonly<{ mode: "full"; edgeBytes: 0 }>
	| Readonly<{ mode: "edges"; edgeBytes: number }>;

export const FULL_ENVELOPE_COVERAGE: EnvelopeCoverage = Object.freeze({
	mode: "full",
	edgeBytes: 0
});

export function normalizeBinaryOptions(
	binary: unknown
): ResolvedFiseBinaryOptions | undefined {
	if (binary === undefined) return undefined;
	const binaryProperties = snapshotOwnDataProperties(
		binary,
		["mode", "edgeBytes"],
		"INVALID_INPUT",
		"binary options"
	);
	if (binaryProperties.get("mode") !== "edges") {
		throw new FiseError("INVALID_INPUT", "FISE: binary mode must be \"edges\".");
	}
	const configuredEdgeBytes = binaryProperties.get("edgeBytes");
	const edgeBytes = configuredEdgeBytes ?? DEFAULT_EDGE_BYTES;
	if (
		typeof edgeBytes !== "number" ||
		!Number.isInteger(edgeBytes) ||
		edgeBytes < 1 ||
		edgeBytes > MAX_UINT32
	) {
		throw new FiseError("INVALID_INPUT", "FISE: edgeBytes must be a positive uint32.");
	}
	return Object.freeze({ mode: "edges", edgeBytes });
}

export function resolveEncryptCoverage(
	binary: ResolvedFiseBinaryOptions | undefined,
	isBinary: boolean,
	contentLength: number
): EnvelopeCoverage {
	if (!isBinary || binary === undefined) return FULL_ENVELOPE_COVERAGE;
	if (binary.edgeBytes * 2 >= contentLength) return FULL_ENVELOPE_COVERAGE;
	return Object.freeze({ mode: "edges", edgeBytes: binary.edgeBytes });
}

export function bindEnvelopeStateToEncodedContext(
	encodedContext: Uint8Array,
	expiresAtSeconds: bigint,
	coverage: EnvelopeCoverage
): Uint8Array {
	const expiryBound = bindExpiryToEncodedContext(encodedContext, expiresAtSeconds);
	if (coverage.mode === "full") return expiryBound;
	const output = new Uint8Array(
		expiryBound.length + EDGE_BINDING_PREFIX.length + Uint32Array.BYTES_PER_ELEMENT
	);
	output.set(expiryBound, 0);
	output.set(EDGE_BINDING_PREFIX, expiryBound.length);
	new DataView(output.buffer, output.byteOffset, output.byteLength).setUint32(
		expiryBound.length + EDGE_BINDING_PREFIX.length,
		coverage.edgeBytes,
		false
	);
	return output;
}

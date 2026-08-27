import profile from "./profile-a.generated.mjs";
import {
	Fise,
	FiseError,
	FISE_WIRE_VERSION,
	isParallelSupported,
	isWasmSupported,
	Profile,
	type FiseContext,
	type FiseContextValue,
	type FiseEncrypted,
	type FiseEncryptedResult,
	type FiseBinaryOptions,
	type FiseOptions,
	type FiseJsonValue,
	type FiseRange,
	type FiseValue
} from "fise";
import type { ParallelFise, ParallelOptions } from "fise";
import { Profile as RuntimeProfile } from "fise/profile-runtime";

const context: FiseContext = [1, "route"];
const contextValue: FiseContextValue = "route";
const json: FiseJsonValue = { text: "hello", values: [1, true, null] };
const value: FiseValue = json;
const range: FiseRange = { start: 0, endExclusive: 1 };
const fise = new Fise(profile);
const strictFlag: true = fise.strict;
const defaultTtl: number | undefined = fise.ttlSeconds;
const envelope: string = fise.encrypt(value, context);
const binaryEnvelope: Uint8Array = fise.encrypt(new Uint8Array([1]), context);
const binaryOptions: FiseBinaryOptions = { mode: "edges" };
const edgeFise = new Fise(profile, { binary: binaryOptions });
const edgeEnvelope: Uint8Array = edgeFise.encrypt(new Uint8Array([1, 2, 3]), context);
const acceptedEnvelope: FiseEncrypted = envelope;
const restored: FiseValue = fise.decrypt(envelope, context);
const selected: Uint8Array = fise.decryptRange(binaryEnvelope, range, context);
const progressive: AsyncGenerator<Uint8Array, void, void> = fise.decryptProgressive(
	binaryEnvelope,
	context,
	{ chunkSize: 1 }
);
const progressiveWithoutContext: AsyncGenerator<Uint8Array, void, void> =
	fise.decryptProgressive(binaryEnvelope, { chunkSize: 1 });
const wasm: Promise<Fise> = fise.withWasm();
const parallelOptions: ParallelOptions = { workerCount: 2, minimumParallelBytes: 0 };
const parallel: Promise<ParallelFise> = fise.parallel(parallelOptions);

const fallbackOptions: FiseOptions<false> = { strict: false };
const fallback = new Fise(profile, fallbackOptions);
const fallbackFlag: false = fallback.strict;
const inlineFallback = new Fise(profile, { strict: false });
const inlineFallbackFlag: false = inlineFallback.strict;
const explicitDefault = new Fise(profile, {});
const explicitDefaultFlag: true = explicitDefault.strict;
const expiring = new Fise(profile, { ttlSeconds: 30 });
const configuredTtl: number | undefined = expiring.ttlSeconds;
const rawDate = new Date();
const fallbackEnvelope: string | Date = fallback.encrypt(rawDate, context);
const inlineFallbackEnvelope: string | Date = inlineFallback.encrypt(rawDate, context);
const fallbackRestored: FiseValue | Date = fallback.decrypt(rawDate, context);
const fallbackWasm: Promise<Fise<false>> = fallback.withWasm();
const fallbackParallel: Promise<ParallelFise<false>> = fallback.parallel(parallelOptions);

interface DomainPayload {
	readonly id: number;
	readonly label: string;
	readonly nested: { readonly enabled: boolean };
}

type DomainContext = readonly [tenant: number, route: string];

declare const domainPayload: DomainPayload;
declare const domainContext: DomainContext;
const domainEnvelope: string = fise.encrypt(domainPayload, domainContext);
const domainEnvelopeType: FiseEncryptedResult<DomainPayload> = domainEnvelope;
const binaryEnvelopeType: FiseEncryptedResult<Uint8Array> = binaryEnvelope;
void domainEnvelope;
void domainEnvelopeType;
void binaryEnvelopeType;
void edgeEnvelope;

async function checkParallelDomainInput(runtime: ParallelFise): Promise<void> {
	await runtime.encrypt(domainPayload, domainContext);
}
void checkParallelDomainInput;

// @ts-expect-error Nested typed arrays are outside the structured-data contract.
fise.encrypt({ nested: new Uint8Array([1]) });
// @ts-expect-error Class instances are outside the structured-data contract.
fise.encrypt(new Date());
// @ts-expect-error Functions are outside the structured-data contract.
fise.encrypt(() => "not data");
// @ts-expect-error Context accepts only positional JSON scalars.
fise.encrypt("value", new Date());
// @ts-expect-error Context is not a semantic object.
fise.encrypt("value", { tenant: 1 });
// @ts-expect-error Nested arrays are not positional scalar context.
fise.encrypt("value", [[1]]);
// @ts-expect-error Strict decrypt only accepts Base64URL or byte envelopes.
fise.decrypt(rawDate);
// @ts-expect-error Range restoration accepts binary envelope bytes only.
fise.decryptRange(envelope, range);
// @ts-expect-error FISE 2.0 has no framed-encryption API.
fise.encryptFramed(new Uint8Array([1]));
// @ts-expect-error The strict option must be a boolean.
new Fise(profile, { strict: "false" });
// @ts-expect-error The TTL must be a number of seconds.
new Fise(profile, { ttlSeconds: "30" });
// @ts-expect-error Binary coverage belongs to the constructor.
fise.encrypt(new Uint8Array([1]), context, { binary: { mode: "edges" } });
// @ts-expect-error Edge mode is the only optional binary mode.
new Fise(profile, { binary: { mode: "full" } });
// @ts-expect-error Custom edgeBytes must be numeric.
new Fise(profile, { binary: { mode: "edges", edgeBytes: "1 MiB" } });

const profileCheck: Profile = profile;
const runtimeProfileCheck: RuntimeProfile = profile;
const error: FiseError = new FiseError("INVALID_INPUT", "test");
void restored;
void selected;
void progressive;
void progressiveWithoutContext;
void wasm;
void parallel;
void strictFlag;
void defaultTtl;
void fallbackFlag;
void inlineFallbackFlag;
void explicitDefaultFlag;
void configuredTtl;
void fallbackEnvelope;
void inlineFallbackEnvelope;
void fallbackRestored;
void fallbackWasm;
void fallbackParallel;
void isWasmSupported();
void isParallelSupported();
void profileCheck;
void runtimeProfileCheck;
void error;
void contextValue;
void acceptedEnvelope;
void FISE_WIRE_VERSION;

import * as api from "fise";
// @ts-expect-error FISE 2.0 intentionally removed the legacy function API.
void api.fiseEncrypt;
// @ts-expect-error FISE 2.0 intentionally removed default profiles.
void api.defaultBinaryProfile;
// @ts-expect-error FISE 2.0 intentionally removed the public builder.
void api.FiseBuilder;
// @ts-expect-error FISE 2.0 has no FISF wire export.
void api.FISF_WIRE_VERSION;

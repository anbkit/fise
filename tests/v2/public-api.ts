import profile from "./profile-a.generated.mjs";
import {
	Fise,
	FiseError,
	FISE_WIRE_VERSION,
	FISF_WIRE_VERSION,
	isParallelSupported,
	isWasmSupported,
	Profile,
	type FiseContext,
	type FiseContextValue,
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
const envelope: Uint8Array = fise.encrypt(value, context);
const restored: FiseValue = fise.decrypt(envelope, context);
const framed: Uint8Array = fise.encryptFramed(new Uint8Array([1]), context);
const selected: Uint8Array = fise.decryptRange(framed, range, context);
const progressive: AsyncGenerator<Uint8Array, void, void> = fise.decryptProgressive(framed, context);
const wasm: Promise<Fise> = fise.withWasm();
const parallelOptions: ParallelOptions = { workerCount: 2, minimumParallelBytes: 0 };
const parallel: Promise<ParallelFise> = fise.parallel(parallelOptions);

interface DomainPayload {
	readonly id: number;
	readonly label: string;
	readonly nested: { readonly enabled: boolean };
}

type DomainContext = readonly [tenant: number, route: string];

declare const domainPayload: DomainPayload;
declare const domainContext: DomainContext;
const domainEnvelope: Uint8Array = fise.encrypt(domainPayload, domainContext);
const framedWithOptions = fise.encryptFramed(
	new Uint8Array([1, 2]),
	undefined,
	{ frameSize: 1 }
);
void domainEnvelope;
void framedWithOptions;

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

const profileCheck: Profile = profile;
const runtimeProfileCheck: RuntimeProfile = profile;
const error: FiseError = new FiseError("INVALID_INPUT", "test");
void restored;
void selected;
void progressive;
void wasm;
void parallel;
void isWasmSupported();
void isParallelSupported();
void profileCheck;
void runtimeProfileCheck;
void error;
void contextValue;
void FISE_WIRE_VERSION;
void FISF_WIRE_VERSION;

import * as api from "fise";
// @ts-expect-error FISE 2.0 intentionally removed the legacy function API.
void api.fiseEncrypt;
// @ts-expect-error FISE 2.0 intentionally removed default profiles.
void api.defaultBinaryProfile;
// @ts-expect-error FISE 2.0 intentionally removed the public builder.
void api.FiseBuilder;

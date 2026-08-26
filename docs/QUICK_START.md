# Quick start

## 1. Install the runtime

```sh
npm install fise
```

FISE is ESM-only. Runtime operations require Node.js 20+ or a modern browser.
Secure randomness is consumed by the Node-based generator only.

## 2. Generate a profile

```sh
npx fise generate ./src/fise.profile.ts
```

The command writes one module whose default export is an immutable `Profile`
instance. Every invocation intentionally writes a different profile. Commit the
file to Git and deploy the same file to every producer and consumer.

The generator does not create or retain a seed, name, revision, manifest,
profile lock, or history database.

## 3. Bind and use it

```ts
import { Fise } from "fise";
import profile from "./fise.profile.js";

const fise = new Fise(profile);
const context = [
  "session_7f4a",
  "user_42",
  "tenant_acme",
  3,
  "orders:v1",
  18
] as const;

const envelope = fise.encrypt({ message: "hello" }, context);
const restored = fise.decrypt(envelope, context);
```

`envelope` is always a `Uint8Array`. The restored value is either the original
JSON-safe value or a new `Uint8Array`, as declared by the transformed payload's
metadata segment.

## Accepted values

```ts
fise.encrypt("text");
fise.encrypt(null);
fise.encrypt({ list: [1, true, "three"] });
fise.encrypt(Uint8Array.from([0, 1, 255]));
```

Structured values must be plain JSON-safe data. FISE rejects functions,
symbols, accessors, sparse arrays, proxies, custom prototype chains, cycles,
`undefined`, non-finite numbers, negative zero, typed arrays nested inside
JSON, and class instances. Convert application-specific values before calling
FISE.

Named TypeScript interfaces work directly; callers do not need to add a JSON
index signature to domain models. The public type surface rejects known
non-data shapes, and the runtime still validates every actual value.

## Context

Think of the Profile as the generated recipe and context as temporary values
added to that recipe for one application flow. Context is an optional
positional array. It is not stored in the envelope:

```ts
// Positions mean: session, user, tenant, connection epoch, resource, sequence.
const context = [
  session.bindingId,
  session.userId,
  session.tenantId,
  session.connectionEpoch,
  "orders:v1",
  responseSequence
] as const;

const envelope = fise.encrypt(data, context);
const dataAgain = fise.decrypt(envelope, context);
```

Each item must be `null`, a boolean, a finite number other than negative zero,
or a string. The array must be dense and cannot contain nested arrays, objects,
accessors, symbols, or custom properties. Position carries application meaning;
FISE intentionally stores no key names. Producer and consumer must provide the
same values in the same order. `undefined` means `[]`.

Choose values already available to both producer and consumer. Short-lived
session or connection state is usually more useful than fixed public literals.
Context is not a password, secret key, authentication tag, or authorization
decision; the server must still enforce access independently.

For each operation, FISE snapshots the array, canonicalizes it as JSON, encodes
those bytes as unpadded Base64URL, mixes the complete encoding into four lanes,
and derives a profile-specific circular segment using the generated offset and
length. The segment and lanes drive the byte pipeline, marker, and layout. The
original array, encoded form, and segment are absent from the envelope. FISE
does not guess context or search adjacent values.

## Framed binary

```ts
const container = fise.encryptFramed(bytes, context, {
  frameSize: 256 * 1024
});

const range = fise.decryptRange(
  container,
  { start: 1000, endExclusive: 2000 },
  context
);

for await (const frame of fise.decryptProgressive(container, context)) {
  consume(frame);
}
```

## WASM and workers

```ts
const wasm = await fise.withWasm();
const wasmEnvelope = wasm.encrypt(data, context);

const parallel = await fise.parallel({ workerCount: 4 });
try {
  const workerEnvelope = await parallel.encrypt(bytes, context);
} finally {
  await parallel.close();
}
```

See [Generated profiles](./PROFILES.md), [the specification](./SPEC.md), and
[the security boundary](./SECURITY.md).

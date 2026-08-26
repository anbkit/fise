# FISE — Fast Interoperable Structured Envelope

[![npm version](https://img.shields.io/npm/v/fise.svg)](https://www.npmjs.com/package/fise)
[![license](https://img.shields.io/github/license/anbkit/fise.svg)](./LICENSE)
[![Tests](https://github.com/anbkit/fise/actions/workflows/test.yml/badge.svg)](https://github.com/anbkit/fise/actions/workflows/test.yml)

**Generate a profile. Import it. Encrypt and decrypt.**

FISE replaces directly consumable frontend payloads with a profile-specific
application representation. Each generated profile contains a different
deterministic, reversible byte pipeline. This raises the cost of reusable
static inspection and generic decoding; it does not make client-visible data
secret.

> `encrypt` and `decrypt` are operational API terms. FISE is keyless
> representation and obfuscation, not cryptographic confidentiality,
> authenticity, integrity, authorization, expiry, or replay prevention. Keep
> TLS and use authenticated encryption when those properties are required.

## Highlights

- **Generated profile as code:** every CLI run emits a different immutable,
  profile-specific reversible pipeline.
- **One API for every value:** strings, JSON-safe domain objects, and
  `Uint8Array` use the same `encrypt` and `decrypt` methods.
- **Optional positional context:** a scalar array can bind restoration to
  application-known values without storing those values in the envelope.
- **Independent frame encryption:** FISF encrypts binary data frame by frame
  instead of forcing one monolithic transform.
- **Partial restoration:** `decryptRange` transforms only frames intersecting
  the requested byte range.
- **Lazy frame decrypt:** `decryptProgressive` restores exactly one independent
  frame per consumer pull.
- **Shared JS, WASM, and parallel-worker wire:** execution backends interoperate
  through the same generated profile and envelope format.

## Profile and context, in plain language

**A Profile is the generated recipe.** Running `fise generate` creates a source
file containing one random reversible byte pipeline. Import that file on both
the producer and consumer, then bind it once with `new Fise(profile)`. The same
Profile handles objects, strings, and binary data. Generating another file means
choosing another recipe, so old envelopes require the old committed file.

**Context is temporary application state added to that recipe.** It is an
optional ordered array containing values both sides already know, such as a
session binding, user, tenant, connection epoch, resource version, or message
sequence. Context changes the resulting representation. Decrypt must receive
the same values in the same order.

```text
data     + Profile + context  -> envelope
envelope + Profile + context  -> original data
```

FISE does not put the context or its key names in the envelope. Context is not a
password, secret key, authorization check, or replacement for server security.
Use it to make the representation depend on short-lived application state, not
to grant access to data.

## Start

Install the runtime:

```sh
npm install fise
```

Generate a profile directly into your source tree:

```sh
npx fise generate ./src/fise.profile.ts
```

Every invocation creates a new independent profile. The generated file is the
complete source of truth and should be committed to Git. FISE stores no seed,
manifest, name, revision, lock, rotation record, or regeneration history.

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

const envelope = fise.encrypt(
  { id: 7, roles: ["editor"] },
  context
);

const restored = fise.decrypt(envelope, context);
```

The same profile handles strings, JSON-safe values, and bytes:

```ts
fise.encrypt("text");
fise.encrypt({ structured: true });
fise.encrypt(Uint8Array.from([0, 1, 255]));
```

FISE normalizes structured values to canonical JSON and UTF-8. Binary values
remain bytes. A transformed internal metadata segment records whether decrypt
must return a structured value or `Uint8Array`; there is no separate JSON,
string, or binary profile.

Context is optional and defaults to `[]`. When used, it must be a dense
positional array containing only `null`, booleans, finite numbers, or strings.
Order is semantic: encrypt and decrypt must receive the same values in the same
positions. FISE snapshots the array; it stores neither the original context nor
its derived segment in the envelope.

## Generated profiles

The CLI uses a cryptographically secure random source once per generation to
select reversible operations and parameters. It then:

```text
typed reversible IR
→ reject dead or identity stages
→ derive the inverse
→ fuse specialized JavaScript kernels
→ compile the same kernel to WASM
→ validate
→ emit one immutable Profile instance
```

Randomness is used only while generating the file. Runtime behavior is fully
deterministic for the same profile, payload, and context, so equal inputs under
equal context produce equal envelopes. This equality leakage is intentional
and is another reason FISE must not be described as cryptographic encryption.
Profile code, fingerprint, context convention, and envelope layout are public
assumptions rather than secrets.

## Binary framing

The same `Fise` instance exposes independent FISF 2.0 frames for binary data:

```ts
const container = fise.encryptFramed(bytes, context, {
  frameSize: 256 * 1024
});

const selected = fise.decryptRange(
  container,
  { start: 1_000_000, endExclusive: 1_250_000 },
  context
);

for await (const frame of fise.decryptProgressive(container, context)) {
  consume(frame);
  if (done()) break;
}
```

Range restoration transforms only intersecting frames. Progressive restoration
decrypts one frame per consumer pull. Both APIs receive a complete in-memory
container; they do not fetch HTTP ranges, stream JSON, or provide lazy object
properties.

## WASM and workers

Generated profiles carry matching specialized JavaScript and WASM semantics:

```ts
const wasm = await fise.withWasm();
const envelope = wasm.encrypt(data, context);
```

For retained parallel workers:

```ts
const parallel = await fise.parallel({ workerCount: 4 });

try {
  const envelope = await parallel.encrypt(bytes, context);
  const restored = await parallel.decrypt(envelope, context);
} finally {
  await parallel.close();
}
```

Workers preserve absolute byte positions, so JavaScript, WASM, worker, full,
range, and progressive operations share one profile fingerprint and wire
contract.

## Compatibility

Package 2.0 implements only FISE 2.0 and FISF 2.0. It does not expose the 1.x
function API, default profiles, builders, manifests, rotation helpers, string
wire, or legacy decoder. Producer and consumer must deploy the same generated
profile together. Replacing the committed profile intentionally invalidates
envelopes created by the previous file unless that earlier code is restored
from Git.

## Documentation

- [Quick start](./docs/QUICK_START.md)
- [Generated profiles](./docs/PROFILES.md)
- [FISE 2.0 specification](./docs/SPEC.md)
- [Framed binary](./docs/FRAMED_BINARY.md)
- [WASM and workers](./docs/WASM.md)
- [Security boundary](./docs/SECURITY.md)
- [Engineering whitepaper](./docs/WHITEPAPER.md)
- [Runnable examples](./examples/README.md)

## Development

```sh
npm test
npm run verify:examples
npm run verify:types
npm run verify:package
npm run verify:browser
```

FISE is ESM-only and requires Node.js 20+ or a modern browser. Secure randomness
is required by the Node-based profile generator, not by runtime operations.
The browser gate uses the packed npm artifact in Chromium under a restrictive
CSP and covers generated profiles, structured/binary data, WASM, workers, and
FISF range/progressive restoration.

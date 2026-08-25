# FISE — Fast Interoperable Structured Envelope

[![npm version](https://img.shields.io/npm/v/fise.svg)](https://www.npmjs.com/package/fise)
[![license](https://img.shields.io/github/license/anbkit/fise)](./LICENSE)
[![Tests](https://github.com/anbkit/fise/actions/workflows/test.yml/badge.svg)](https://github.com/anbkit/fise/actions/workflows/test.yml)

**One payload. One profile. One explicit wire contract.**

## Why FISE

TLS protects data in transit, but every payload delivered to and used by a
frontend is ultimately observable in that client. Conventional JSON and byte
payloads are also immediately intelligible and reusable by generic tooling.
FISE calls the difference between receiving that payload and reproducing the
application's restoration path the **client adaptation gap**.

FISE 1.1 replaces a directly consumable representation with a versioned,
profile-governed envelope. A consumer must reproduce the expected profile,
external context, and restoration pipeline before it can use the payload. This
can add inspection, integration, and maintenance work; the size of that effect
is deployment-specific and must be measured.

FISE's **built-in model is keyless by design**: its default profiles create,
exchange, store, and rotate no secret encryption key. Instead, one public
executable **profile-as-code** contract owns the transform, layout, context,
limits, representation, and compatibility identity. The profile and carried
random salt are not secrets. Keyless is an operational property, not a
cryptographic security claim.

> FISE keeps the API terms `encrypt` and `decrypt`, but its built-in XOR
> profiles provide reversible encoding and obfuscation—not cryptographic
> confidentiality, authenticity, or integrity. Keep TLS, access control, and
> authenticated encryption wherever those properties are required.

## Install

```sh
npm install fise
```

FISE is ESM-only. It requires Node 20+ or a browser with Web Crypto.

## Use

```ts
import { defaultStringProfile, fiseDecrypt, fiseEncrypt } from "fise";

const envelope = fiseEncrypt("hello", defaultStringProfile);
const restored = fiseDecrypt(envelope, defaultStringProfile);
```

Producer and consumer must use the same profile and external context. FISE
does not guess profiles, scan context ranges, or fall back to an older wire
format.

## Highlights

- **Keyless built-in model:** default profiles require no secret-key lifecycle;
  custom transforms retain responsibility for any stronger property.
- **Profile as code:** one public, executable compatibility contract changes
  transform, layout, context, limits, representation, and identity together.
- **Exact, fail-closed wire:** magic, version, profile ID, salt length, and
  transformed length are validated; legacy input, drift, truncation, trailing
  data, malformed markers, and size violations produce typed errors.
- **Reproducible lifecycle:** canonical manifests produce content-derived IDs,
  deterministic vectors, rotation diffs, and atomic rollout artifacts.
- **WASM parity and parallel workers:** optional WASM and dedicated Node/browser
  module workers share the same binary transform identity and ordinary FISE
  1.1 wire bytes.
- **Selective and lazy frame restoration:** `FISF` range restore decrypts only
  intersecting frames, while progressive restore defers each inner-envelope
  decrypt until the consumer requests that frame.
- **Application surfaces:** strings, binary data, UTF-8/JSON, strict HTTP
  responses, and deterministic time-window context use one profile model.

Markers are bounded consistency signals for context-dependent layout
disagreement when it changes the expected value or position. They do not cover
every payload byte, are not a MAC, and do not authenticate who created an
envelope.

This lazy behavior exists only at the independent-frame decrypt boundary.
`FISF` APIs still consume a complete in-memory container and produce bytes;
they do not claim HTTP range fetching, streaming input, or lazy JSON parsing.
See [Framed Binary](./docs/FRAMED_BINARY.md).

## When FISE fits

Use FISE when one release owner controls both the producer and authorized
client, changing the client representation has product value, and coordinated
producer/consumer upgrades are acceptable.

Do not use FISE as the boundary for secrets, authorization decisions,
regulated confidentiality, or a public API that requires long-lived
third-party wire compatibility.

## FISF in one minute

```text
Profile decides HOW
Frame index decides WHERE
Consumer pull decides WHEN
```

```ts
import {
  defaultBinaryProfile,
  fiseFramedBinaryDecryptProgressive,
  fiseFramedBinaryDecryptRange,
  fiseFramedBinaryEncrypt
} from "fise";

const bytes = Uint8Array.from(
  { length: 2_000_000 },
  (_, index) => index & 0xff
);
const container = await fiseFramedBinaryEncrypt(bytes, defaultBinaryProfile, {
  frameSize: 256 * 1024
});
const slice = await fiseFramedBinaryDecryptRange(
  container,
  defaultBinaryProfile,
  { start: 1_000_000, endExclusive: 1_250_000 }
);

let consumedFrames = 0;
let consumedBytes = 0;
for await (const frame of fiseFramedBinaryDecryptProgressive(
  container,
  defaultBinaryProfile
)) {
  consumedBytes += frame.length;
  if (++consumedFrames === 2) break;
}

console.log(slice.length, consumedBytes);
```

The complete `container` is already available in memory. Range restoration
transforms only intersecting frames; progressive restoration transforms one
indexed frame per pull and stops after the consumer stops. It is not HTTP Range
acquisition, incremental network input, streaming JSON, or lazy JSON.

## Choose a surface

| Need | API | Import |
| --- | --- | --- |
| JavaScript strings | `fiseEncrypt`, `fiseDecrypt` | `fise` |
| Binary data | `fiseBinaryEncrypt`, `fiseBinaryDecrypt` | `fise` |
| Worker binary transform | `createParallelXorBinaryCipher`, `fiseBinary*Async` | `fise` |
| Indexed range/lazy frame bytes | `fiseFramedBinary*` | `fise` |
| Deterministic time-window context | `resolveFiseTimeWindow` | `fise` |
| UTF-8, JSON, HTTP `Response` | `fiseUtf8*`, `fiseJson*`, `createFise*Response` | `fise/http` |
| Profiles and manifests | `define*Profile`, `compileFiseProfileManifest` | `fise`, `fise/profiles` |
| Deterministic vectors | `create*ConformanceEnvelope` | `fise/conformance` |
| Optional WASM backend | `createWasmXorBinaryCipher`, `withBinaryBackend` | `fise` |

See the [quick start](./docs/QUICK_START.md) for time-window, binary, JSON,
HTTP, and WASM examples.

## Reproducible profiles

Prefer declarative manifests when profile identity must be reproducible across
builds and deployments:

```sh
fise profile validate profile.json
fise profile build profile.json
fise profile vectors profile.json
fise profile diff deployed.json next.json
```

The compiler canonicalizes and deeply freezes the manifest, derives its profile
ID from SHA-256 content identity, and emits artifacts for validation and atomic
rotation. This is the portable profile path. Handwritten profiles remain a
trusted application-local contract and are not implicitly cross-language.

The repository includes an independent standard-library
[Python binary reference](./reference/python/README.md) for compiled artifact
identity and byte-level conformance.

## Optional WASM

```ts
import {
  createWasmXorBinaryCipher,
  defaultBinaryProfile,
  withBinaryBackend
} from "fise";

const backend = await createWasmXorBinaryCipher({ maxMemoryPages: 1024 });
const profile = withBinaryBackend(defaultBinaryProfile, backend);
```

The JavaScript and WASM implementations share the same binary transform
semantics and profile identity. WASM changes execution, not the security
boundary. Its linear memory is capped and retains its bounded high-water until
the backend instance is discarded. See [WASM](./docs/WASM.md).

## Version 1.1 boundary

FISE 1.1 intentionally has no legacy API or decoder. Upgrade producers and
consumers together, then regenerate or invalidate old stored, queued, and
cached envelopes. See [Migrating to 1.1](./docs/MIGRATION_V1_1.md).

The npm package version can evolve independently from the wire version. Package
1.2 keeps ordinary FISE `1.1` bytes and FISF `1.0` bytes unchanged.

## Documentation

- [Runnable examples](./examples/README.md)
- [Quick start](./docs/QUICK_START.md)
- [Reference specification](./docs/SPEC.md)
- [Profiles](./docs/PROFILES.md) and [profile manifests](./docs/PROFILE_MANIFEST.md)
- [HTTP](./docs/HTTP.md), [WASM](./docs/WASM.md), [framed binary](./docs/FRAMED_BINARY.md), and [conformance](./docs/CONFORMANCE.md)
- [Security boundary](./docs/SECURITY.md)
- [Performance](./docs/PERFORMANCE.md) and [adaptation evaluation](./docs/ADAPTATION_EVALUATION.md)
- [Release evidence](./docs/RELEASE_EVIDENCE.md)
- [Engineering whitepaper](./docs/WHITEPAPER.md)

## Development

```sh
npm run release:check
npm run verify:browser:serve
```

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT © An Nguyen

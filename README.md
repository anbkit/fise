# FISE — Fast Interoperable Structured Envelope

[![npm version](https://img.shields.io/npm/v/fise.svg)](https://www.npmjs.com/package/fise)
[![license](https://img.shields.io/github/license/anbkit/fise)](./LICENSE)
[![Tests](https://github.com/anbkit/fise/actions/workflows/test.yml/badge.svg)](https://github.com/anbkit/fise/actions/workflows/test.yml)

**One payload. One profile. One explicit wire contract.**

FISE 1.1 creates versioned application envelopes for strings and binary data.
A single profile owns every decode-relevant rule: transform, layout, context,
limits, and compatibility identity.

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

## Core contract

- **Atomic profile:** transform, layout, context, limits, and identity change
  together.
- **Explicit envelope:** magic, wire version, profile ID, salt length, and
  transformed length are carried and validated.
- **Fail closed:** wrong profiles, unsupported versions, legacy input,
  truncation, trailing data, malformed markers, and size violations are
  rejected with typed `FiseError.code` values.
- **Bounded parsing:** profile and caller limits constrain envelope processing;
  bounded HTTP readers count decoded stream bytes.

Markers are bounded consistency signals for context-dependent layout
disagreement when it changes the expected value or position. They do not cover
every payload byte, are not a MAC, and do not authenticate who created an
envelope.

Binary workloads can opt into a real worker backend without changing ordinary
1.1 envelope bytes. A separate indexed `FISF` container adds frame-level range
restore and progressive byte output. It does not claim HTTP range fetching,
streaming input, or lazy JSON parsing. See [Framed Binary](./docs/FRAMED_BINARY.md).

## Choose a surface

| Need | API | Import |
| --- | --- | --- |
| JavaScript strings | `fiseEncrypt`, `fiseDecrypt` | `fise` |
| Binary data | `fiseBinaryEncrypt`, `fiseBinaryDecrypt` | `fise` |
| Worker binary transform | `createParallelXorBinaryCipher`, `fiseBinary*Async` | `fise` |
| Indexed range/progressive bytes | `fiseFramedBinary*` | `fise` |
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

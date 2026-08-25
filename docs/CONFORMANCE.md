# FISE 1.1 Conformance

Production APIs always generate fresh salt. The `fise/conformance` subpath
accepts explicit salt only for golden fixtures and alternate implementations.

## Canonical string vector

Inputs:

```text
profile:   fise.default.string
plaintext: Hello FISE
salt:      0123456789
timestamp: 0
```

Envelope:

```text
FISE010113000a0000001cfise.default.string0aAHgAVABeAF8AWwAVAHAAfgBrAHw=0123456789
```

## Canonical binary vector

Inputs:

```text
profile:      fise.default.binary
plaintextHex: 00010203feff
saltHex:      00010203040506070809
timestamp:    0
```

Envelope hexadecimal:

```text
46495345010113000a00000006666973652e64656661756c742e62696e617279000a00000000fafa00010203040506070809
```

## Fixture API

```ts
import {
  createBinaryConformanceEnvelope,
  createStringConformanceEnvelope
} from "fise/conformance";

const envelope = createStringConformanceEnvelope(
  "Hello FISE",
  "0123456789",
  defaultStringProfile,
  { timestamp: 0 }
);
```

Compiled manifests can emit their own deterministic vectors with
`createManifestConformanceVector` or `fise profile vectors`.

## Independent Python binary reference

The standard-library-only [Python reference](../reference/python/README.md)
loads a normalized compiled binary artifact and independently verifies:

- canonical manifest JSON, SHA-256 digest, and content-derived profile ID;
- the complete binary header, exact framing, marker, offset, salt tail, and
  `xor-u8-v1` transform;
- TypeScript-vector decode and byte-identical Python-vector encode; and
- typed failure for length, marker, and wrong-context cases.

Run:

```sh
npm run verify:interop
```

This is concrete cross-language evidence for the manifest-compiled binary
subset. It is not evidence for arbitrary callback profiles or for preserving
the JavaScript-specific UTF-16 string domain in every language.

## Required implementation checks

An alternate implementation should verify:

1. exact string and binary vectors above;
2. registered built-in backend binding plus JS/WASM byte equality when WASM is
   supported;
3. empty payloads, full byte range, arbitrary UTF-16 code units, and sizes over
   one WASM memory page;
4. every salt length for each compiled profile;
5. required/forbidden/wrongly typed context;
6. exact rejection of legacy magic, wrong versions and profiles, truncation,
   trailing data, malformed fixed fields, marker changes, and limits;
7. media type/version/profile, identity/compressed length handling, and bounded
   cancellation for HTTP helpers;
8. stable typed errors rather than untyped parser exceptions; and
9. deterministic canonical manifest digest, deep immutability, and rotation
   diff; and
10. strict numeric manifest types plus WASM retained-page-cap boundaries.

## Evidence boundary

A passing golden vector proves one exact representation. It does not prove
cryptographic security, broad browser support, or correctness for arbitrary
handwritten callback profiles. Pair vectors with property tests, malformed
input tests, package tests, and real target-runtime execution.

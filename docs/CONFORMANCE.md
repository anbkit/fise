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

## Canonical framed binary vector

Inputs:

```text
container:    FISF 1.0
profile:      fise.default.binary
plaintextHex: 00010203feff
frameSize:    4
frame0Salt:   00010203040506070809
frame1Salt:   0a0b0c0d0e0f10111213
timestamp:    0
```

Container hexadecimal:

```text
464953460100001300000004000000060000000200080000666973652e64656661756c742e62696e6172790000003b000000300000006b0000002e46495345010113000a00000004666973652e64656661756c742e62696e617279000a000000000001020304050607080946495345010113000a00000002666973652e64656661756c742e62696e617279000af4f40a0b0c0d0e0f10111213
```

This vector fixes the outer header/index and two complete inner 1.1 envelopes.
It is byte-level evidence for one fixture, not an independent second-language
implementation of `FISF`.

## Fixture API

```ts
import {
  createBinaryConformanceEnvelope,
  createFramedBinaryConformanceEnvelope,
  createStringConformanceEnvelope
} from "fise/conformance";

const envelope = createStringConformanceEnvelope(
  "Hello FISE",
  "0123456789",
  defaultStringProfile,
  { timestamp: 0 }
);

const frame0Salt = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const frame1Salt = Uint8Array.from([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
const framed = createFramedBinaryConformanceEnvelope(
  Uint8Array.from([0, 1, 2, 3, 254, 255]),
  [frame0Salt, frame1Salt],
  defaultBinaryProfile,
  { frameSize: 4, timestamp: 0 }
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
8. stable typed errors rather than untyped parser exceptions;
9. deterministic canonical manifest digest, deep immutability, and rotation
	 diff;
10. strict numeric manifest types plus WASM retained-page-cap boundaries;
11. async worker parity at non-divisible salt/chunk boundaries, cancellation,
	 close, reserved transform identity, and ordinary-wire interoperability;
12. `FISF` magic/version, index contiguity, exact count/length, full/range/
	 progressive restoration, selected-frame failure, bounds, and the canonical
	 framed vector; and
13. instrumented `FISF` selected-frame transform counts, zero progressive
	 prefetch, early termination, abort-on-next-pull, input snapshot ownership,
	 synchronous outer-index validation, and empty completion.

## Evidence boundary

A passing golden vector proves one exact representation. It does not prove
cryptographic security, broad browser support, or correctness for arbitrary
handwritten callback profiles. Pair vectors with property tests, malformed
input tests, package tests, and real target-runtime execution.

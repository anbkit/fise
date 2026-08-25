# FISE 1.1 Reference Envelope Specification

## 1. Status and scope

This document specifies the string and binary wire formats implemented by FISE
1.1. A conforming decoder accepts exactly version `1.1`. It rejects the earlier
magic-less representation; no legacy negotiation exists in this version.

The opt-in `FISF` indexed container is a distinct layered format whose inner
values are complete 1.1 binary envelopes. Its version 1.0 grammar and
range/progressive semantics are specified in
[FRAMED_BINARY.md](./FRAMED_BINARY.md); they do not alter the grammar below.

The functions are operationally named `encrypt` and `decrypt`. This
specification defines reversible framing, compatibility, and structural
validation. A transform supplies any stronger property. The built-in XOR
transforms provide neither cryptographic confidentiality nor authenticity.

FISE defines no secret-key field, negotiation, derivation, storage, or rotation
protocol. The built-in profiles are therefore keyless: reversal depends on the
envelope, public profile behavior, and required external context rather than a
protected key. A custom transform may compose with external key management,
but its cryptographic properties and lifecycle are outside this specification.

The key words MUST, MUST NOT, SHOULD, and MAY describe interoperability
requirements.

## 2. Atomic profile model

Each operation receives exactly one profile:

```ts
interface FiseLayoutInput {
  transformedLength: number;
  saltLength: number;
}

interface FiseLayout<T extends string | Uint8Array> {
  markerSize: number;
  saltRange?: { min: number; max: number };
  offset(input: FiseLayoutInput, ctx: FiseContext): number;
  createMarker(input: FiseLayoutInput, ctx: FiseContext): T;
}

interface FiseStringProfile {
  id: string;
  representation: "string";
  transform: FiseCipher;
  layout: FiseLayout<string>;
  context?: FiseContextContract;
  limits?: { maxEnvelopeLength?: number };
  manifestDigest?: string;
}

interface FiseBinaryProfile {
  id: string;
  representation: "binary";
  transform: FiseBinaryCipher;
  layout: FiseLayout<Uint8Array>;
  context?: FiseContextContract;
  limits?: { maxEnvelopeLength?: number };
  manifestDigest?: string;
}
```

The profile owns its transform. Passing an unrelated cipher in operation
options is not part of 1.1. A byte-compatible implementation backend MAY be
bound only when its stable transform ID equals the profile transform ID and it
passes the implementation-compatibility checks. Built-in string and binary
transform IDs are reserved for implementations registered by FISE; custom IDs
remain an application-owned trusted-code boundary.

The async binary API MAY instead receive one registered asynchronous backend
with the same transform identity. The built-in dedicated-worker backend for
`fise.xor.u8.v1` partitions by absolute byte offset and produces ordinary 1.1
envelope bytes. Async execution does not change profile ownership or wire
negotiation.

`defineStringProfile` and `defineBinaryProfile` validate the static surface and
return frozen copies. Runtime operations additionally validate active context,
marker output, offset output, transform output, and envelope fields.

The common runtime interface does not imply one common portability guarantee.
A profile compiled from `fise.profile/1` is reproducible by implementations of
that declarative schema. An application-defined callback profile is a trusted
local contract whose ID and cross-language semantics remain the application's
responsibility.

## 3. Profile invariants

A conforming profile satisfies all of the following:

1. `id` contains 1–63 ASCII characters matching
   `[A-Za-z0-9][A-Za-z0-9._-]*`.
2. `representation` matches the selected operation.
3. `transform.id` follows the same identifier grammar.
4. `saltRange` defaults to 10–99 and satisfies
   `1 <= min <= max <= 65535`.
5. `markerSize` is an integer from 1 through 255.
6. `createMarker` returns exactly `markerSize` string units or bytes.
7. `offset` returns a finite number. The reference runtime normalizes it as:

   ```text
   p = max(0, min(trunc(offset), transformedLength))
   ```

8. Layout behavior is deterministic from `FiseLayoutInput` and the declared
   context. It MUST NOT require transformed payload contents.
9. Producer and consumer use the same profile and relevant external context.
10. A profile-level envelope bound, when present, is a non-negative safe
    integer.
11. A profile claiming a reserved built-in transform ID uses a FISE-registered
    implementation function pair.

There is no marker decoder. Salt length is a declared header field. The decoder
recomputes the expected marker from `{ transformedLength, saltLength }` and the
active context, then compares it with the marker found at the expected offset.

The marker is a profile-consistency signal, not a MAC. Context mismatches are
detectable only when the profile maps them to a different marker or marker
position; collisions are possible and deliberate rewriting remains possible.
The marker does not cover transformed payload or salt contents, so a
same-length mutation outside the marker is not generally detected. No generic
false-acceptance probability is specified because bytes read at an incorrect
position need not follow a uniform distribution.

## 4. Context contract

`timestamp` can be `required`, `optional`, or `forbidden`. Metadata fields can
be required or optional primitive `string`, `number`, or `boolean` values.
Numbers MUST be safe integers. Undeclared metadata is rejected unless
`allowAdditionalMetadata` is true.

Operation options and metadata MUST be plain objects containing only own,
enumerable data properties with string keys. Accessors and symbol keys are
rejected. The runtime snapshots these values once before validation and uses
that immutable snapshot for the complete operation.

Context is external and is not serialized in the envelope. FISE does not try a
previous timestamp or alternate metadata value. Rollover, replay, and fallback
policy belong to the application.

### 4.1 Deterministic time-window helper

`resolveFiseTimeWindow(timeMs, { durationMs, originMs? })` is a convenience API
for deriving an external integer timestamp from Unix-millisecond values. All
three numeric inputs MUST be safe integers, `durationMs` MUST be positive, and
`originMs` defaults to `0`. Options MUST be a plain object containing only own,
enumerable `durationMs` and optional `originMs` data properties.

For mathematical floor division, it returns a frozen object defined by:

```text
timestamp      = floor((timeMs - originMs) / durationMs)
startMs        = originMs + timestamp * durationMs
endExclusiveMs = startMs + durationMs
```

The result MUST fail with `INVALID_INPUT` if an input or result is outside the
safe-integer range. The interval is `[startMs, endExclusiveMs)`, including for
times before `originMs`.

This helper is not part of the envelope grammar. It does not read a clock,
serialize context, synchronize clocks, try adjacent windows, validate expiry,
or prevent replay. Applications MUST coordinate the exact returned `timestamp`
when producer and consumer do not share one operation anchor. A profile may map
multiple timestamp values to the same marker or position; the default profiles
use only `timestamp % 11` in their offset.

## 5. Common logical layout

Both representations use:

```text
H || X[0:p] || M || X[p:N] || S
```

Where:

- `H` is the FISE header;
- `X` is the transformed payload;
- `N` is the declared length of `X`;
- `M` is the fixed-width profile marker;
- `p` is the normalized marker offset; and
- `S` is the salt of declared length `L`.

Salt is always at the tail. The exact total length is:

```text
length(E) = headerLength + N + markerSize + L
```

## 6. String header

The fixed header is 22 ASCII string units followed by the ASCII profile ID.

| String offsets | Width | Encoding | Field |
| ---: | ---: | --- | --- |
| `0..3` | 4 | literal | `FISE` |
| `4..5` | 2 | hexadecimal | major version, `01` |
| `6..7` | 2 | hexadecimal | minor version, `01` |
| `8..9` | 2 | hexadecimal | profile ID length |
| `10..13` | 4 | hexadecimal | salt length `L` |
| `14..21` | 8 | hexadecimal | transformed length `N` |
| `22..` | declared | ASCII | profile ID |

The encoder emits lowercase hexadecimal. The parser accepts either letter
case. Lengths and offsets are JavaScript string-unit counts.

## 7. Binary header

The fixed header is 13 bytes followed by the ASCII profile ID.

| Byte offsets | Width | Encoding | Field |
| ---: | ---: | --- | --- |
| `0..3` | 4 | `46 49 53 45` | `FISE` |
| `4` | 1 | unsigned byte | major version, `1` |
| `5` | 1 | unsigned byte | minor version, `1` |
| `6` | 1 | unsigned byte | profile ID length |
| `7..8` | 2 | unsigned big-endian | salt length `L` |
| `9..12` | 4 | unsigned big-endian | transformed length `N` |
| `13..` | declared | ASCII | profile ID |

Binary lengths and offsets are byte counts.

## 8. Encode algorithm

Inputs are payload `P`, atomic profile `R`, and caller options.

1. Validate the profile representation and active context.
2. Select salt length `L` uniformly from the inclusive profile range using
   rejection sampling over Web Crypto.
3. Generate salt `S`. String salt uses unbiased alphanumeric characters;
   binary salt uses the full byte range.
4. Compute `X = R.transform.encrypt(P, S)` and validate its representation.
5. Let `N = length(X)` and `I = { transformedLength: N, saltLength: L }`.
6. Compute `M = R.layout.createMarker(I, ctx)` and require its exact width.
7. Compute normalized position `p` from `R.layout.offset(I, ctx)`.
8. Encode `H` with version 1.1, profile ID, `L`, and `N`.
9. Require the final length to fit the profile envelope limit, when present.
10. Return `H || X[0:p] || M || X[p:N] || S`.

## 9. Decode algorithm

Inputs are envelope `E`, expected profile `R`, and caller options.

1. Validate the profile representation and active context.
2. Resolve the stricter of profile and caller `maxEnvelopeLength`; reject an
   oversized `E` before header parsing.
3. Require magic `FISE` and exact version 1.1.
4. Parse and validate profile length, profile ID, `L`, and `N`.
5. Require the parsed profile ID to equal `R.id`.
6. Require `L` to be inside the profile salt range.
7. Require the exact total-length equation from section 5.
8. Construct `I = { transformedLength: N, saltLength: L }` and compute `p`.
9. Read actual marker `M` at `p`; recompute the expected marker and require
   byte-for-byte or string-unit equality.
10. Read the final `L` units as salt `S` and remove `M` to reconstruct `X`.
11. Compute `P = R.transform.decrypt(X, S)` and validate its representation.
12. Return `P`.

No candidate scanning, profile fallback, legacy parsing, or context fallback is
permitted.

## 10. Default profiles

### `fise.default.string`

- transform ID: `fise.xor.utf16.v1`;
- salt range: 10–99 alphanumeric string units;
- marker: two-character lowercase base36 encoding of salt length;
- position: `(N * 7 + ((timestamp ?? 0) % 11)) % (N || 1)`; and
- transform: repeating XOR over UTF-16 code units, serialized as two
  big-endian bytes per unit and canonical base64.

An implementation in another language MUST model this representation as a
sequence of 16-bit code units, not as Unicode scalar values. Implementations
that cannot preserve lone surrogates SHOULD support the binary/UTF-8 surface
instead of claiming full conformance to the default string profile.

### `fise.default.binary`

- transform ID: `fise.xor.u8.v1`;
- salt range: 10–99 arbitrary bytes;
- marker: two-byte unsigned big-endian salt length;
- position: the same formula; and
- transform: repeating byte XOR in JavaScript, the byte-compatible WASM
  backend, or the byte-compatible async dedicated-worker backend.

Both default profiles allow an optional safe-integer timestamp and reject all
metadata.

## 11. Error contract

Validation failures are `FiseError` values with stable codes:

| Code | Meaning |
| --- | --- |
| `INVALID_INPUT` | Wrong public input type or invalid caller limit |
| `INVALID_PROFILE` | Invalid profile, manifest, layout, marker, or offset |
| `INVALID_CONTEXT` | Missing, forbidden, undeclared, or wrongly typed context |
| `INVALID_SALT` | Invalid or out-of-profile salt |
| `INVALID_ENVELOPE` | Malformed header or field |
| `UNSUPPORTED_VERSION` | Selected ordinary/media/framed version is unsupported |
| `PROFILE_MISMATCH` | Envelope/media profile differs from the supplied profile |
| `TRANSFORM_MISMATCH` | Backend transform identity or semantics are incompatible |
| `LENGTH_MISMATCH` | Declared and actual envelope lengths differ |
| `ENVELOPE_LIMIT` | Envelope exceeds a configured maximum |
| `MARKER_MISMATCH` | Recomputed marker differs from the envelope marker |
| `INVALID_CIPHERTEXT` | Transform input/output is malformed |
| `INVALID_PAYLOAD` | Restored UTF-8, JSON, or HTTP metadata is malformed |
| `INVALID_RANGE` | A framed plaintext range is malformed or out of bounds |
| `FRAME_LIMIT` | A framed count, index, or 32-bit container field exceeds its bound |
| `OPERATION_ABORTED` | An async transform or framed operation was cancelled |
| `RANDOM_UNAVAILABLE` | Web Crypto randomness is unavailable or failed |
| `RUNTIME_UNAVAILABLE` | Another required runtime primitive is unavailable |
| `PARALLEL_UNAVAILABLE` | Dedicated workers cannot be initialized in the runtime or policy |
| `PARALLEL_WORKER_FAILED` | A retained worker failed or was already closed |
| `WASM_UNAVAILABLE` | Required WebAssembly APIs are absent |
| `WASM_COMPILE_FAILED` | WASM compilation, instantiation, or export validation failed |
| `WASM_MEMORY_LIMIT` | WASM memory32 capacity or growth failed |

Existing `FiseError` values thrown by application callbacks retain their code.
Other transform exceptions are normalized to `INVALID_CIPHERTEXT`; other
layout exceptions are normalized to `INVALID_PROFILE`. Compiled profiles avoid
the open callback surface for supported declarative behavior.

## 12. Complexity and resource bounds

Let `n` be transformed length. Header work is constant apart from copying the
bounded profile ID. Transform, assembly, reconstruction, and output storage are
`O(n)`. Version 1.1 has no salt-range candidate factor.

The ordinary-envelope API holds complete input and output buffers. Its async
worker backend copies transform inputs into worker-owned chunks and assembles a
complete result. It does not change the ordinary wire or make parsing
streaming.

The separate `FISF` layer snapshots a complete container but can transform only
selected inner envelopes or yield one restored byte frame per consumer pull.
The latter is lazy only at the independent-frame decrypt boundary: the next
inner envelope is not decrypted until that pull. It is not defined by
concatenating 1.1 envelopes and does not imply HTTP range fetching, incremental
transport ingestion, or lazy JSON values.

HTTP response adapters may ingest a body incrementally only to enforce an
effective decoded-envelope maximum before complete allocation. They still
return a complete decoded value and do not define streaming wire semantics.
Non-identity `Content-Length` describes the coded representation and is not
compared with bytes exposed by Fetch after decoding.

The optional WASM backend defaults to at most 1,024 retained 64-KiB pages per
instance. `maxMemoryPages` may configure 1 through 65,536 pages. Required
capacity is page-rounded over input plus salt; linear memory retains its
high-water page count until the instance is discarded.

## 13. Conformance and security interpretation

Deterministic fixtures are defined in [CONFORMANCE.md](./CONFORMANCE.md).
Manifest and rotation behavior are defined in
[PROFILE_MANIFEST.md](./PROFILE_MANIFEST.md).

The independent Python reference verifies the compiled binary subset and is
linked from [CONFORMANCE.md](./CONFORMANCE.md). It does not make handwritten
callbacks or the JavaScript UTF-16 surface portable by implication.

Headers, lengths, and markers detect malformed input and many accidental
mismatches. They do not identify the producer or prevent deliberate rewriting.
See [SECURITY.md](./SECURITY.md).

# FISE Framed Binary 1.0

FISE Framed Binary is an opt-in indexed container for independent FISE 1.1
binary envelopes. It supplies real frame-level range restoration and
lazy, progressive byte restoration without changing the ordinary `FISE` 1.1
grammar.

The container magic is `FISF`, and its own version is `1.0`. An ordinary
`fiseBinaryDecrypt()` call rejects it; framed APIs reject ordinary envelopes.
There is no automatic format fallback.

## API

```ts
import {
  defaultBinaryProfile,
  fiseFramedBinaryDecrypt,
  fiseFramedBinaryDecryptProgressive,
  fiseFramedBinaryDecryptRange,
  fiseFramedBinaryEncrypt
} from "fise";

const container = await fiseFramedBinaryEncrypt(bytes, defaultBinaryProfile, {
  frameSize: 256 * 1024
});

const range = await fiseFramedBinaryDecryptRange(
  container,
  defaultBinaryProfile,
  { start: 1_000_000, endExclusive: 1_250_000 }
);

for await (const frame of fiseFramedBinaryDecryptProgressive(
  container,
  defaultBinaryProfile
)) {
  consumeBytes(frame);
}
```

All four operations are binary-only. The container and input are still complete
`Uint8Array` values; progressive restore does not fetch a remote stream.

## Container layout

```text
+----------------------+------------+-------------------+-------------------+
| 24-byte fixed header | profile ID | N x 8-byte index  | N inner envelopes |
+----------------------+------------+-------------------+-------------------+
```

The fixed header fields are unsigned big-endian values:

| Offset | Width | Value |
| ---: | ---: | --- |
| 0 | 4 | bytes for `FISF` |
| 4 | 1 | framed major version `1` |
| 5 | 1 | framed minor version `0` |
| 6 | 1 | flags, currently `0` |
| 7 | 1 | profile ID length |
| 8 | 4 | plaintext frame size |
| 12 | 4 | complete plaintext length |
| 16 | 4 | frame count `N` |
| 20 | 2 | index entry width, currently `8` |
| 22 | 2 | reserved, currently `0` |

The ASCII profile ID follows the fixed header. Each index entry then contains:

| Entry offset | Width | Value |
| ---: | ---: | --- |
| 0 | 4 | absolute byte offset of the inner envelope |
| 4 | 4 | exact inner-envelope byte length |

Every inner value is a complete FISE 1.1 binary envelope using the same profile
ID and external context as the container operation. Each non-final frame
restores to exactly `frameSize` bytes; the final frame restores to the remaining
plaintext length. An empty payload has zero frames but still carries the profile
ID.

## Structural invariants

A decoder validates the complete outer header and index before transforming a
frame. It requires:

1. exact `FISF` magic and framed version `1.0`;
2. zero flags and reserved fields plus an 8-byte index entry width;
3. the supplied profile ID to match the outer profile ID;
4. `frameCount = ceil(plaintextLength / frameSize)`, with zero frames only for
   an empty plaintext;
5. the configured container and frame-count bounds;
6. the first frame to begin immediately after the index;
7. every frame to be positive-length and contiguous; and
8. the last indexed frame to end exactly at the container length.

Selected inner envelopes then undergo the complete FISE 1.1 validation path,
including profile, length, marker, salt, context, and per-envelope limits. The
restored frame length must match its position in the outer index.

## Range semantics

`fiseFramedBinaryDecryptRange()` accepts a half-open plaintext range
`[start, endExclusive)`. It transforms only frames intersecting that range, then
copies the requested boundary bytes. An empty valid range returns an empty byte
array.

The complete outer index is validated, but inner envelopes outside the selected
range are not parsed or transformed. A later full or overlapping restore can
therefore fail even if an earlier disjoint range succeeded. This selective
validation is the deliberate meaning of partial restoration.

Range restoration is not an HTTP Range client. The current function receives
the complete container in memory. A transport-aware API that first fetches the
header/index and then selected envelope byte ranges remains separate work.

## Progressive and lazy frame semantics

`fiseFramedBinaryDecryptProgressive()` returns an async generator. It validates
the outer structure at creation and restores exactly one inner envelope per
consumer pull. This provides frame-level byte backpressure and stops work when
the consumer stops iterating.

At this boundary, **lazy decrypt** means that decryption of the next independent
inner envelope is deferred until the consumer requests its frame. It does not
mean that an ordinary FISE envelope, its transport, UTF-8 text, or application
values are decrypted lazily.

The input container is snapshotted in full. The API is therefore progressive
restoration, not incremental network ingestion. It yields bytes, not parsed
application values. In particular, it does not claim lazy JSON decoding; that
would require a separate incremental UTF-8/parser and application-observation
contract.

## Parallel backend

Framed operations accept the same optional async backend as
`fiseBinaryEncryptAsync()` and `fiseBinaryDecryptAsync()`. `concurrency` bounds
the number of frame operations in flight. With no async backend, increasing
`concurrency` does not create CPU parallelism.

`createParallelXorBinaryCipher()` supplies the built-in worker implementation.
Its chunks retain the absolute byte offset when selecting salt bytes, so it is
byte-compatible with `fise.xor.u8.v1`. It copies caller data before transfer,
retains dedicated workers until `close()`, and explicitly fails on worker
startup, worker execution, cancellation, or use after close.

Browser deployment requires module workers and CSP permission for the worker
module, commonly `worker-src 'self'`. `isParallelXorBinaryCipherSupported()`
checks API presence only; factory initialization remains the policy/CSP test.

## Limits and security boundary

`maxContainerLength` bounds the outer `FISF` value. `maxFrameCount` defaults to
65,536. `maxEnvelopeLength` and the selected profile limit apply to every inner
envelope that is restored. Index offsets, inner lengths, frame size, frame
count, and plaintext length use unsigned 32-bit fields.

Framing and indexing add no authentication. Reordering or rewriting bytes can
remain undetected when the public profile and structural lengths can be made
consistent. Use TLS, authorization, schema validation, and standard
authentication or encryption controls where their properties are required.

The deterministic fixture API and canonical hexadecimal vector are documented
in [CONFORMANCE.md](./CONFORMANCE.md).

The test suite also instruments a supported application transform to prove
selected-frame call counts, zero progressive prefetch, early termination,
abort-on-next-pull, input snapshot ownership, and empty behavior. Performance
methodology and scoped measurements are documented in
[PERFORMANCE.md](./PERFORMANCE.md); those results do not change these normative
semantics.

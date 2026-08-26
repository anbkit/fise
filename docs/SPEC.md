# FISE 2.0 specification

This document defines package 2.0's ordinary FISE wire, logical payload,
context derivation, generated-profile contract, and fail-closed parsing
behavior. Multi-byte integers are unsigned big-endian.

## Data model

The public runtime accepts either:

- a JSON-safe structured value, including a JavaScript string; or
- a top-level `Uint8Array`.

Structured values are canonicalized by recursively sorting object keys and
using JSON string/number/boolean/null syntax. Arrays must be dense and use a
same-realm or genuine cross-realm `Array.prototype`. Objects must be plain or
null-prototype objects with enumerable data properties. Proxies, custom
prototype chains, cycles, accessors, symbols, functions, `undefined`,
non-finite numbers, negative zero, class instances, and nested typed arrays are
invalid.

The logical plaintext begins with a fixed two-byte metadata segment:

| Offset | Size | Field |
| ---: | ---: | --- |
| 0 | 1 | Metadata version, currently `1` |
| 1 | 1 | Data type: `1` structured JSON/UTF-8, `2` raw binary |
| 2 | variable | Canonical UTF-8 JSON or raw bytes |

The complete logical plaintext is transformed by the selected generated
profile. Metadata is therefore not a clear header field.

## Positional context

The optional second API argument is a dense positional array. Every item must
be `null`, a boolean, a finite number other than negative zero, or a string.
Nested arrays, objects, accessors, symbols, holes, and custom properties are
invalid. An omitted argument is equivalent to `[]`.

For each operation, the runtime:

1. snapshots and freezes the validated array;
2. serializes it as canonical JSON and UTF-8;
3. encodes those bytes as unpadded Base64URL, producing `E`;
4. mixes all bytes of `E` into four profile-specific `uint32` lanes;
5. derives a context segment `S` from the generated profile parameters.

Every valid context has a non-empty encoding; for example, `[]` becomes
Base64URL text `W10`. Segment derivation is circular:

```text
start = contextSegmentOffset mod E.length
S[j]  = E[(start + j) mod E.length]
        for j in 0 .. contextSegmentLength - 1
```

The original context, `E`, and `S` are not stored in the envelope. Array order
is semantic. Encrypt and decrypt must receive equal values in equal positions.
The runtime limits canonical context to 65,536 UTF-8 bytes.

## Profile requirements

A valid profile supplies:

- a 16-byte content-derived fingerprint;
- a `uint32` context-segment offset;
- a context-segment length from 8 through 1024 bytes;
- a context mixer returning four unsigned 32-bit lanes;
- length-preserving forward and reverse byte kernels;
- an offset in the inclusive range `0..transformedLength`;
- a 32-bit marker value;
- optionally, a byte-compatible generated WASM module.

The current CLI chooses context-segment lengths from 12 through 32 bytes. Its
generated transform, layout, and marker depend on the derived segment and mixed
lanes.

The low-level JavaScript callback contract is conceptually:

```ts
mixContext(encodedContext, context)
offset(layout, contextState, contextSegment, context)
marker(layout, contextState, contextSegment, context)
forward(input, contextSegment, contextState, absoluteOffset, context)
reverse(input, contextSegment, contextState, absoluteOffset, context)
```

`layout` contains `transformedLength`, `encodedContextLength`, and
`contextSegmentLength`. The context argument is the frozen positional snapshot.
Callbacks must not mutate inputs and kernels must return newly owned bytes of
identical length. CLI-generated profiles preserve identical byte semantics in
JavaScript, WASM, and workers. A manually changed JavaScript callback cannot
claim that parity unless its embedded WASM is changed and verified as well.

## FISE 2.0 envelope

The fixed header is 32 bytes:

| Offset | Size | Field |
| ---: | ---: | --- |
| 0 | 4 | ASCII `FISE` |
| 4 | 1 | Major version `2` |
| 5 | 1 | Minor version `0` |
| 6 | 1 | Header length `32` |
| 7 | 1 | Flags, currently `0` |
| 8 | 16 | Generated profile fingerprint |
| 24 | 4 | Transformed payload length |
| 28 | 4 | Reserved, must be zero |

The body is:

```text
transformed[0:offset]
marker:uint32
transformed[offset:transformedLength]
```

Expected envelope length is exactly:

```text
32 + transformedLength + 4
```

Trailing and missing bytes are invalid.

## Encrypt

1. Validate and snapshot the input.
2. Encode the metadata segment and content.
3. Prepare positional context, mixed lanes, and the profile-derived segment.
4. Run the profile forward kernel at absolute offset zero.
5. Compute the profile offset and marker from layout, segment, lanes, and context.
6. Write the fixed header and split transformed bytes around the marker.

## Decrypt

1. Validate input type and the global size limit.
2. Validate magic, exact version, fixed fields, fingerprint, and exact length.
3. Prepare caller-provided context using the same deterministic derivation.
4. Recompute the marker position and value; reject mismatch.
5. Reassemble transformed bytes around the marker.
6. Run the profile reverse kernel at absolute offset zero.
7. Validate metadata version, data type, UTF-8, and canonical structured form.
8. Return a parsed structured value or newly owned bytes.

FISE does not try other profiles, contexts, versions, or legacy formats.

## Determinism and marker boundary

For a fixed profile, payload, and context, the complete envelope is
deterministic. Equal inputs therefore reveal equality. The context-derived
segment increases profile-specific reconstruction work but is not a key,
nonce, salt, password hash, MAC, or cryptographic KDF.

The 32-bit marker is only a bounded consistency signal for profile/context
mismatch. It can collide and does not cover arbitrary payload tampering.

## Limits

Ordinary transformed length uses `uint32`. The JavaScript implementation also
caps complete ordinary and framed allocations and advertised FISF plaintext at
512 MiB. Advertised lengths are rejected before output allocation. Runtimes may
fail at lower limits due to platform memory policy. FISF additionally caps one
container at 65,536 frames and carries an outer profile/context marker, including
when its frame count is zero.

## Version behavior

FISE 2.0 accepts exactly wire `2.0`. Package 2.0 contains no 1.x decoder or
fallback. Future incompatible header or payload changes require a new wire
major version.

See [FISF](./FRAMED_BINARY.md) for indexed independent frames.

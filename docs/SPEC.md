# FISE 2.0 specification

This document defines package 2.0's data model, transport representation,
ordinary binary wire, positional context, generated Profile contract, envelope
lifetime, binary coverage modes, direct restoration, parser behavior, and
optional raw fallback. Multi-byte integers are unsigned big-endian.

## Data model

The public runtime accepts either:

- a JavaScript string or JSON-safe structured value; or
- a top-level `Uint8Array`.

For every value FISE accepts, canonical output follows the JSON Canonicalization
Scheme in [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html): no
inter-token whitespace, ECMAScript JSON primitive serialization, recursive
property sorting, and UTF-8 output. Property names are compared in raw form as
unsigned UTF-16 code-unit sequences, independent of locale. Array order is
preserved.

Strings and property names must contain only valid Unicode scalar values.
Unpaired UTF-16 surrogates are invalid. FISE does not normalize Unicode, so
canonically equivalent composed and decomposed strings remain different data.
Numbers use the IEEE-754 binary64 model and the exact ECMAScript JSON number
representation captured by RFC 8785. Non-finite values and negative zero are
invalid; FISE deliberately rejects negative zero instead of serializing it as
zero. Other language bindings must not serialize native arbitrary-precision
integers or decimals directly as FISE numbers. Values requiring exact precision
beyond binary64, including large identifiers and decimal amounts, should use
JSON strings.

The accepted in-memory graph is narrower than general JSON serializer input.
Arrays must be dense and use a same-realm or genuine cross-realm
`Array.prototype`. Objects must be plain or null-prototype objects with
enumerable data properties. Proxies, custom prototype chains, cycles,
accessors, symbols, functions, `undefined`, class instances, and nested typed
arrays are invalid. FISE canonicalizes an already constructed value; it does
not parse source JSON or recover duplicate property names discarded by an
upstream parser.

The logical plaintext begins with a fixed two-byte metadata segment:

| Offset | Size | Field |
| ---: | ---: | --- |
| 0 | 1 | Metadata version, currently `1` |
| 1 | 1 | Data type: `1` plain structured, `2` top-level binary, `3` compressed structured |
| 2 | variable | Type-specific content |

Metadata is not a clear header field. Full coverage transforms the complete
logical plaintext. Binary edge coverage always transforms metadata and the
configured content edges.

For type `1`, content begins at offset `2` and is canonical JSON encoded as
UTF-8. For type `2`, original binary content begins at offset `2`. Type `3`
uses this layout:

| Offset | Size | Field |
| ---: | ---: | --- |
| 0 | 1 | Metadata version `1` |
| 1 | 1 | Data type `3` |
| 2 | 4 | Original canonical UTF-8 length |
| 6 | variable | One independent LZ4 block |

The structured encoder considers compression only when canonical UTF-8 is at
least 256 bytes. It uses the deterministic FISE LZ4 block encoder and selects
type `3` only when `compressedLength + 4 < originalLength`; otherwise it emits
type `1`. The block has no frame header, dictionary, or checksum. Decompression
is bounded by the declared original length, must consume the exact block and
produce the exact declared byte count, and is followed by the same fatal UTF-8,
JSON, and canonical-form validation as type `1`. The declared original length
must not exceed 512 MiB or 256 times the compressed block length (with a
256-byte floor for small valid blocks).

### Deterministic FISE LZ4 block

FISE fixes one encoder, not only the set of LZ4 blocks a decoder may accept.
All arithmetic used for hashing is unsigned 32-bit arithmetic modulo `2^32`.
Four-byte input sequences and two-byte match distances are little-endian. The
encoder constants are:

| Name | Value |
| --- | ---: |
| minimum match | `4` |
| last literals | `5` |
| match-find limit | `12` |
| maximum distance | `65,535` |
| hash bits / entries | `16` / `65,536` |
| hash multiplier | `0x9e3779b1` |
| hash shift | `16` |

The encoder initializes every signed hash-table entry to `-1`. At each cursor
position `p` while `p <= inputLength - 12`, it reads the little-endian `uint32`
sequence `x`, computes `hash = (x * 0x9e3779b1 mod 2^32) >>> 16`, reads the one
stored candidate, and then stores `p` in that entry before testing the
candidate. A candidate matches only when it is non-negative, its distance is at
most `65,535`, and its first four bytes equal `x`. A miss advances `p` by one.
The encoder does not retain collision chains, search an alternative candidate,
or extend a match backward.

On a match, the encoder extends forward byte-for-byte only while
`p < inputLength - 5`. It emits the literal run since the previous anchor, the
little-endian match distance, and the match length, then makes the end of that
match the next anchor and cursor. After search ends it always emits one final
literal-only sequence, including for empty input. Match copies may overlap.

Each sequence token stores `min(literalLength, 15)` in its high nibble and
`min(matchLength - 4, 15)` in its low nibble. When either encoded length reaches
`15`, extension bytes encode the remaining length as zero or more `255` bytes
followed by one remainder byte from `0` through `254`. The exact encoder outputs
for literal-only, overlapping, extended, latest-candidate, and hash-collision
cases are frozen in the conformance corpus.

The bounded decoder must reject truncated lengths or distances, distance zero,
distances beyond already restored output, input or output overruns, an output
length different from the declared length, trailing bytes, and terminal
sequences that violate the LZ4 boundaries. When a block contains a match, its
final literal run must contain at least five bytes and its final match must begin
no later than `outputLength - 12`.

## Public transport representation

FISE has one binary wire. `encrypt()` represents that wire according to the
plaintext input:

- a string or JSON-safe structured value returns canonical unpadded Base64URL,
  suitable for a JSON API field;
- top-level binary data returns a newly owned `Uint8Array`.

`decrypt()` accepts either representation, inspects the transformed metadata,
and returns the original data type. Passing the binary bytes behind a
structured value is valid; metadata, not the outer JavaScript type, determines
the restored plaintext type. Base64URL is only an outer transport encoding. It
does not create a second wire format or add a security property.

String input to `decrypt()` must be canonical unpadded Base64URL:

- only `A-Z`, `a-z`, `0-9`, `-`, and `_` are accepted;
- padding, whitespace, and other characters are rejected;
- a length congruent to `1 mod 4` is rejected;
- unused trailing bits must be zero; and
- the decoded-size limit is checked before allocation.

The decoder does not trim, coerce, or guess arbitrary strings.

## Positional context

The optional second API argument is a dense positional array. Every item must
be `null`, a boolean, a finite number other than negative zero, or a string.
Nested arrays, objects, accessors, symbols, holes, and custom properties are
invalid. An omitted argument is equivalent to `[]`.

Context strings and numbers use the same Unicode-scalar and binary64
canonicalization rules as structured data.

For each operation, the runtime:

1. snapshots and freezes the validated array;
2. serializes it as canonical JSON and UTF-8;
3. encodes those bytes as unpadded Base64URL, producing `E`;
4. binds any wire expiry and binary edge policy to `E`, producing `B`;
5. mixes all bytes of `B` into four Profile-specific `uint32` lanes;
6. derives a context segment `S` from generated Profile parameters.

Every valid context has a non-empty encoding; for example, `[]` becomes
Base64URL text `W10`. Segment derivation is circular:

```text
start = contextSegmentOffset mod B.length
S[j]  = B[(start + j) mod B.length]
        for j in 0 .. contextSegmentLength - 1
```

Let `B0 = E` when expiry is zero. Otherwise:

```text
B0 = E || 0x00 || ASCII("FISE-TTL") || 0x01 || expiresAtSeconds:uint64
```

For full coverage, `B = B0`. For binary edge coverage:

```text
B = B0 || 0x00 || ASCII("FISE-EDGE") || 0x01 || edgeBytes:uint32
```

These bindings are not application context values. Generated callbacks receive
only the caller's frozen positional array as their `context` argument. Binding
wire policy makes blind expiry, coverage-mode, or edge-length edits change the
Profile-derived lanes, segment, layout, and marker. It is not a cryptographic
authentication scheme.

The original context, `E`, and `S` are not stored in the envelope. Array order
is semantic. Encrypt and decrypt must receive equal values in equal positions.
The runtime limits canonical context to 65,536 UTF-8 bytes.

Context values are an application contract and must already be available to the
consumer. Context is not a reason to expose an authentication token, protected
cookie, HttpOnly session value, or another credential to a frontend.

## Profile requirements

A valid Profile supplies:

- a 16-byte opaque fingerprint derived by the CLI from generated semantic IR;
- a `uint32` context-segment offset;
- a context-segment length from 8 through 1024 bytes;
- a context mixer returning four unsigned 32-bit lanes;
- length-preserving forward and reverse byte kernels;
- an insertion offset in the inclusive range `0..transformedLength`;
- a 32-bit marker value; and
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

`layout` contains `transformedLength`, `operationBindingLength`, and
`contextSegmentLength`. `operationBindingLength` is exactly `B.length`, after
TTL and edge policy have been appended when present; it is not the length of
the caller-only encoding `E`. The context argument is the frozen positional
snapshot.
Callbacks must not mutate inputs. Kernels must return newly owned bytes of
identical length and preserve byte semantics when called on any contiguous
range with its logical absolute offset. This byte-local requirement enables
direct range, progressive, parallel, and edge-only work without a second
container format.

CLI-generated Profiles preserve identical byte semantics in JavaScript, WASM,
and workers. Generated source is a versioned compatibility artifact and must be
imported unchanged; the runtime does not attest manually edited source from the
supplied fingerprint.

## FISE 2.0 binary wire

The fixed header is 40 bytes:

| Offset | Size | Field |
| ---: | ---: | --- |
| 0 | 4 | ASCII `FISE` |
| 4 | 1 | Major version `2` |
| 5 | 1 | Minor version `0` |
| 6 | 1 | Header length `40` |
| 7 | 1 | Flags: bit `0` means binary edge coverage; all other bits are zero |
| 8 | 16 | Generated Profile fingerprint |
| 24 | 4 | Logical payload length: two-byte metadata plus content |
| 28 | 4 | Edge bytes per side, or zero for full coverage |
| 32 | 8 | Absolute Unix expiry seconds, or zero for no expiry |

The body is:

```text
wirePayload[0:markerOffset]
marker:uint32
wirePayload[markerOffset:logicalPayloadLength]
```

Expected envelope length is exactly:

```text
40 + logicalPayloadLength + 4
```

Trailing and missing bytes are invalid. The marker is a physical four-byte
insertion; it is not part of the logical payload or plaintext. Under full
coverage, every `wirePayload` byte is transformed. Under edge coverage, its
declared middle content region is copied without transformation.

Full coverage requires a zero flag byte and zero edge bytes. Edge coverage
requires flag bit `0`, a positive edge length, binary content, and:

```text
2 * edgeBytes < binaryContentLength
```

Non-canonical or unknown combinations are invalid.

## Binary coverage modes

Full coverage is the default when the instance has no binary policy:

```js
const fise = new Fise(profile);
const encrypted = fise.encrypt(data, context);
```

An instance may opt its top-level binary encryption into symmetric edge
coverage for lower transform cost:

```js
const fise = new Fise(profile, {
  binary: { mode: "edges" }
});

const encrypted = fise.encrypt(video, context);
```

The constructor snapshots the binary option. `edgeBytes` is optional; omission
resolves to `1,048,576` bytes (1 MiB) per side. A supplied value must be a
positive integer `uint32`. Unknown fields, accessors, unsupported modes, and
invalid edge lengths are `INVALID_INPUT` during construction.

The resolved `edgeBytes` counts original binary content bytes per side and
excludes the two-byte logical metadata. For binary content length `n`, edge mode
transforms:

```text
logical metadata + content[0:edgeBytes]
content[n-edgeBytes:n]
```

The middle `content[edgeBytes:n-edgeBytes]` is copied into the wire without the
Profile transform. If the requested edges meet or overlap, the producer
canonicalizes that envelope to full coverage. The binary policy has no effect
on string or structured encryption, so one instance still handles all supported
data types.

This mode reduces Profile-kernel work but still allocates and returns one
complete envelope. It preserves FISE parsing, Profile/context marker checks,
TTL behavior, and restoration correctness. It does not conceal the middle
bytes. Applications must choose it only when that explicit exposure and weaker
transformation coverage are acceptable.

## Encrypt

1. Validate and snapshot the input.
2. Encode metadata and content. Structured input uses the canonical adaptive
   compression rule above.
3. Resolve full or canonical binary edge coverage from the instance policy.
4. If the instance has `ttlSeconds`, read producer milliseconds and compute
   `expiresAtSeconds = ceil(nowMilliseconds / 1000) + ttlSeconds`; otherwise
   use zero. This makes the usable lifetime at least the configured number of
   whole seconds even when encryption begins during a partial second.
5. Prepare positional context and the wire-policy-bound operation state.
6. Run the Profile forward kernel over the complete logical payload for full
   coverage, or over only metadata plus the two binary edges for edge coverage.
7. Compute the Profile marker offset and marker from layout, segment, lanes,
   and context.
8. Write the fixed header and split logical bytes around the marker.
9. Return binary wire bytes for binary plaintext, or canonical unpadded
   Base64URL for string and structured plaintext.

## Decrypt

1. Decode canonical Base64URL when the supplied representation is a string.
2. Validate input type and the global size limit.
3. Validate magic, exact version, fixed fields, coverage policy, fingerprint,
   and exact length.
4. Prepare caller-provided context, parsed expiry, and parsed coverage using the
   same binding.
5. Recompute the marker position and value; reject mismatch.
6. If expiry is nonzero, read the current Unix second and reject with
   `ENVELOPE_EXPIRED` when `nowSeconds >= expiresAtSeconds`.
7. Reassemble logical bytes around the marker.
8. Reverse the complete logical payload for full coverage, or reverse only the
   metadata and two covered edges while copying the middle for edge coverage.
9. Validate metadata version, data type, UTF-8, and canonical structured form.
   Edge coverage additionally requires top-level binary metadata.
10. Return a parsed structured value or newly owned binary bytes.

FISE does not try other Profiles, contexts, versions, or legacy formats.

## Direct binary range restoration

`decryptRange(envelope, { start, endExclusive }, context)` accepts only the raw
binary envelope produced for top-level binary data. The range is a half-open
interval over original binary content and excludes the two metadata bytes.
Empty ranges are valid.

Before returning requested content, the runtime validates the complete supplied
envelope's header, coverage policy, fingerprint, exact length, Profile/context
marker, and TTL. For an ordinary local `Uint8Array` backed by `ArrayBuffer`,
the synchronous path may borrow the input for the duration of the call and copy
only fixed fields, marker, metadata, and the requested range. Inputs whose byte
brand or ownership cannot be trusted are snapshotted before use. The runtime
then restores only logical bytes `[0, 2)` and requires binary metadata version
`1`, type `2`.

For a requested content range `[start, endExclusive)`, the runtime maps it to
logical positions:

```text
logicalStart = 2 + start
logicalEnd   = 2 + endExclusive
```

It copies only that range from around the physical marker insertion. Under full
coverage, the reverse kernel receives the whole selected range with
`absoluteOffset = logicalStart`. Under edge coverage, the reverse kernel
receives only intersections with the two transformed edge regions; a selected
middle region is already plaintext and is copied without reverse work.

Range restoration does not allocate or reverse the complete plaintext payload.
Header, marker, context, TTL, and metadata validation still require access to
the complete in-memory encrypted envelope.

## Progressive binary restoration

`decryptProgressive(envelope, context?, { chunkSize, signal }?)` accepts the same
ordinary binary envelope. When context is omitted, the options object may be
passed directly as the second argument. `chunkSize` is a positive `uint32` and
defaults to 256 KiB. It is a runtime read size, not an encryption option or wire
field.

At iterator creation, the runtime snapshots the complete envelope and performs
the same context, marker, TTL, coverage, and binary-metadata validation as
`decryptRange()`. The snapshot protects later asynchronous pulls from caller
mutation. Each pull restores the next content range with correct logical
absolute offsets and edge intersections. The iterator does not prefetch later
plaintext chunks; an aborted signal is checked before each pull. An iterator
created while its envelope is valid does not recheck TTL between later pulls.

Progressive restoration is pull-driven computation over an envelope already in
memory. It is not an HTTP Range client, incremental network parser, or
independently retryable/cacheable chunk container.

## Parallel runtime

`parallel()` may split covered forward and reverse kernel work into internal
worker chunks. Because generated kernels are byte-local and receive correct
logical absolute offsets, worker and JavaScript execution produce the same
ordinary wire bytes. Worker chunk boundaries are runtime details and are not
encoded in the envelope. Direct range and progressive methods preserve their
public semantics while using the retained worker runtime for selected reverse
work.

## Runtime envelope lifetime

`new Fise(profile, { ttlSeconds })` accepts a positive integer `uint32`. Zero,
negative, fractional, non-finite, non-number, and out-of-range values are
`INVALID_INPUT`. The option is snapshotted at construction and applies to every
envelope encrypted by that instance. Omitting it creates non-expiring
envelopes.

The wire expiry and resolved binary coverage are authoritative during
decryption. A decrypting instance does not need the producer's TTL or binary
configuration, and its own constructor options do not replace parsed wire
policy. `withWasm()` and `parallel()` preserve the source instance's TTL and
binary options. Time belongs to TypeScript orchestration; generated JavaScript,
WASM, and worker kernels receive no clock and remain deterministic byte engines.

Full, range, and progressive restoration verify the expiry-bound marker and
expiration before restoring content. Progressive restoration checks once when
the iterator is created; an iterator created while valid does not expire
between later pulls.

Clock inspection failure is `CLOCK_UNAVAILABLE`. Expiration is
`ENVELOPE_EXPIRED`. Both always propagate, including from `{ strict: false }`.
This is fail-closed normal-runtime freshness, not cryptographic expiry,
revocation, authorization, or replay prevention.
When producer and consumer use different device clocks, applications must also
account for clock skew and network delay in the chosen lifetime.

## Runtime strictness and raw fallback

`new Fise(profile)` is equivalent to `new Fise(profile, { strict: true })`.
Under this default, every `FiseError` from `encrypt()` or `decrypt()` is
propagated to the caller.

`new Fise(profile, { strict: false })` changes only application-level error
handling for `encrypt()` and `decrypt()`:

1. the runtime attempts the same complete validation and operation;
2. success returns the normal envelope representation or restored value;
3. a recoverable `FiseError` returns the exact original method input by identity;
4. an unexpected non-`FiseError` is propagated.

For `encrypt()`, fallback returns the caller's original data. For `decrypt()`,
it returns the supplied envelope or raw value. The public TypeScript result is
therefore a union of the normal result and input type. Fallback does not add a
wire flag, label, copy, serialization, send, retry, Profile search, or context
search. `ENVELOPE_EXPIRED` and `CLOCK_UNAVAILABLE` are not recoverable fallback
events and always propagate.

`withWasm()` and `parallel()` preserve the source instance's strict option.
`decryptRange()`, `decryptProgressive()`, backend startup, and calls on a closed
parallel runtime remain strict. Low-level parsers still reject invalid data;
`strict: false` only converts a caught recoverable ordinary-operation
`FiseError` into application-level raw pass-through.

## Determinism and marker boundary

Without TTL, fixed Profile, payload, context, and coverage produce a
deterministic complete envelope. With TTL, the same inputs and absolute expiry
remain deterministic; encryption in different Unix seconds can produce
different envelopes. Equal non-TTL inputs therefore reveal equality. The
context-derived segment increases Profile-specific reconstruction work but is
not a key, nonce, salt, password hash, MAC, or cryptographic KDF.

Adaptive structured compression is also deterministic. Its type selection and
LZ4 bytes depend only on canonical UTF-8 content, not platform state.

The 32-bit marker is only a bounded consistency signal for Profile/context and
wire-policy mismatch. It can collide and does not cover arbitrary payload
tampering.

## Limits

Transformed length uses `uint32`. The JavaScript implementation caps a complete
decoded binary envelope at 512 MiB and rejects advertised lengths before output
allocation. Base64URL transport adds approximately one third to string size;
its decoded binary size is checked against the same cap before allocation.
Runtimes may fail at lower limits because of platform memory policy.

Range restoration allocates only the requested plaintext range after envelope
validation and two-byte metadata restoration. Common synchronous `decrypt` and
range paths can avoid a full encrypted-input snapshot for a plain local
`Uint8Array`; hostile, shared, or otherwise non-borrowable input is copied.
Progressive and asynchronous restoration retain a complete owned snapshot
because work continues after the call returns. Every method still requires the
complete encrypted envelope in memory. Edge-mode encryption reduces kernel
work, not envelope length or complete-output allocation.

## Version behavior

FISE 2.0 accepts exactly wire `2.0`. Package 2.0 contains no 1.x decoder,
framed container, or legacy-format fallback. Future incompatible header or
payload changes require a new wire major version.

## Conformance corpus

[`conformance/v2`](../conformance/README.md) contains one immutable generated
JavaScript Profile and machine-readable golden vectors. The corpus fixes
canonical JSON, UTF-8, binary64 number rendering, logical payload metadata,
deterministic LZ4 decisions and malformed blocks, compression thresholds,
Base64URL transport, full and edge binary wires, positional context, TTL,
range/progressive restoration, and malformed transport/wire/payload failures.
It is test material, not an application Profile or a public runtime import.

Every additional language or backend must reproduce accepted vectors
byte-for-byte, reject invalid vectors, restore JavaScript-produced envelopes,
and produce envelopes restored by JavaScript. The corpus must not be
regenerated during install, build, or test. An intentional change to these
bytes is a protocol change and requires version review.

The current JavaScript fixture freezes the cross-language baseline but does not
claim another language runtime already conforms. A future multi-language CLI
must emit every language artifact from the same transient generation IR in one
operation and verify the pair bidirectionally. Independently regenerating a
Profile in another language is incompatible even if both files target wire 2.0.

See [binary data](./BINARY_DATA.md) for practical full, edge, range,
progressive, and large-file guidance.

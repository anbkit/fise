# FISE 1.1 Binary Envelope

The binary API operates directly on `Uint8Array` and is the preferred base for
HTTP, JSON-over-UTF-8, images, and complete media segments.

## Wire layout

```text
+----------------------+-------------------+--------+-------------------+------+
| 13-byte fixed header | ASCII profile ID  | X[0:p] | marker | X[p:N] | salt |
+----------------------+-------------------+--------+-------------------+------+
```

The fixed header fields are:

| Offset | Width | Value |
| ---: | ---: | --- |
| 0 | 4 | bytes for `FISE` |
| 4 | 1 | major `1` |
| 5 | 1 | minor `1` |
| 6 | 1 | profile ID length |
| 7 | 2 | salt length, unsigned big-endian |
| 9 | 4 | transformed length, unsigned big-endian |

The ASCII profile ID immediately follows. The salt is always the declared
number of trailing bytes.

## Decode validation

The decoder checks the active profile/context, configured limit, magic,
version, profile syntax and equality, salt range, exact total length, marker
position/value, and transform output type. Truncated and trailing data fail
with typed errors. Legacy candidate scanning is absent.

## JavaScript, WASM, and worker parity

The default JavaScript and WASM transforms both identify as
`fise.xor.u8.v1`. `withBinaryBackend` binds either implementation to the same
atomic profile. The built-in ID requires a registered FISE implementation, and
binding runs profile-range semantic checks. Conformance tests require
byte-for-byte transform and envelope parity across memory growth boundaries.

`createParallelXorBinaryCipher()` implements the same transform ID through
dedicated module workers. It is supplied to `fiseBinaryEncryptAsync()` or
`fiseBinaryDecryptAsync()` rather than frozen into the synchronous profile.
Chunks retain their absolute input offset when indexing the repeating salt, so
ordinary 1.1 envelopes interoperate across JavaScript, WASM, and worker paths.
The backend snapshots bytes, uses explicit cancellation/failure, and retains
workers until `close()`.

The WASM wrapper copies input and salt into linear memory and copies output
back into an owned `Uint8Array`. It is not zero-copy and not an enclave.

## Payload formats

FISE treats bytes as opaque. Wrap a complete PNG, WebP, MP4/CMAF segment, or
other object only if producer and consumer both operate on the entire object.
The ordinary `FISE` 1.1 envelope does not modify codec containers internally
and has no range or progressive semantics. Applications that can split opaque
bytes at arbitrary boundaries may opt into the separate indexed `FISF`
container described in [FRAMED_BINARY.md](./FRAMED_BINARY.md). That layer still
does not make a codec independently decodable at each byte frame.

Use [HTTP.md](./HTTP.md) for UTF-8/JSON and `Response` helpers.

## Limits

The wire field supports transformed lengths through `2^32 - 1`, but actual
limits are lower in browsers, Node, WASM memory32, proxies, and devices. Set a
profile limit and a caller limit, then enforce a transport limit before
complete buffering. The stricter FISE limit wins. The WASM transform has a
separate retained-page cap (64 MiB by default) that counts input plus salt.

The synchronous and async ordinary-envelope APIs allocate complete envelopes
and restored payloads. `fiseBinary*Async` may offload the byte transform to the
worker backend while preserving the same wire bytes; it does not make assembly
or parsing streaming. The framed progressive API also snapshots its complete
outer container before yielding restored byte frames.

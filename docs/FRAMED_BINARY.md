# FISF 2.0 framed binary

FISF divides one binary value into independent ordinary FISE 2.0 envelopes.
The outer index enables full, selected-range, and pull-driven progressive
restoration with the same generated profile.

## API

```ts
const container = fise.encryptFramed(bytes, context, { frameSize: 256 * 1024 });
const full = fise.decryptFramed(container, context);
const range = fise.decryptRange(
  container,
  { start: 1000, endExclusive: 2000 },
  context
);

for await (const frame of fise.decryptProgressive(container, context)) {
  consume(frame);
}
```

Framed operations accept binary input only. This does not require a binary
profile; every generated profile is a byte profile.

## Header

The fixed FISF header is 40 bytes:

| Offset | Size | Field |
| ---: | ---: | --- |
| 0 | 4 | ASCII `FISF` |
| 4 | 1 | Major version `2` |
| 5 | 1 | Minor version `0` |
| 6 | 2 | Header length `40` |
| 8 | 16 | Profile fingerprint |
| 24 | 4 | Plaintext frame size |
| 28 | 4 | Complete plaintext length |
| 32 | 4 | Frame count |
| 36 | 4 | Profile/context consistency marker |

The header is followed by `frameCount` index entries. Each entry is eight
bytes: absolute container offset followed by envelope length, both `uint32`.
Indexed envelopes must be positive-length, contiguous, in bounds, and consume
the container exactly.

The JavaScript runtime caps both advertised plaintext and the complete
container at 512 MiB, and caps one container at 65,536 frames. Advertised
plaintext length is checked before output allocation. Async worker-backed full
and range operations process frames in bounded sequence; each selected frame
may still divide its byte kernel across the retained workers.

## Semantics

Each frame is transformed independently with the same profile and positional
context. Each inner plaintext carries ordinary FISE payload metadata and
declares binary data. The final frame may be shorter than `frameSize`. Because
ordinary FISE 2.0 is deterministic, equal frame plaintext under equal context
produces equal inner envelopes; FISF does not hide repeated-frame equality.

The outer marker is recomputed from the selected profile, positional context,
and declared plaintext length before allocation or an empty-range return. It
therefore binds even a zero-frame container to its context. Like the ordinary
FISE marker, it is a bounded consistency signal, not authentication or
integrity protection.

Full restoration validates and decrypts every frame. Range restoration
validates the outer index, decrypts only frames intersecting `[start,
endExclusive)`, and slices boundary bytes after restoring those frames.
Progressive restoration snapshots and validates the complete container when
the iterator is created, then decrypts one frame per pull.

Skipped inner envelopes are not transformed by range restore. Their internal
validity is therefore not established by that operation.

## Non-claims

FISF APIs receive a complete in-memory container. They do not fetch remote HTTP
ranges, incrementally acquire a stream, lazily parse JSON, or expose lazy object
properties. "Lazy decrypt" means deferred independent-frame work only.

WASM and worker runtimes use the same format. Worker chunking preserves the
absolute position supplied to generated kernels.

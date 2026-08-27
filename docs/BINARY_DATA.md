# Binary data

FISE 2.0 uses the same ordinary envelope for binary data (images, documents,
archives, audio, and video) as it does internally for text and structured data.
Binary `encrypt()` returns binary output; there is no separate framed container.
Every current binary API receives or returns one complete in-memory envelope;
FISE is not an incremental network or storage format.

## Choose a coverage mode

| Mode | Instance | Profile transform coverage | Use when |
| --- | --- | --- | --- |
| Full | `new Fise(profile)` | Metadata and every content byte | Default; consistent coverage matters |
| Edges | `new Fise(profile, { binary: { mode: "edges" } })` | Metadata plus the first and last resolved edge bytes | Lower transform cost matters and a readable middle is acceptable |

Full mode is the default and requires no options.

The Python runtime uses the same wire with idiomatic option and method names:

```python
media_fise = Fise(profile, binary="edges", edge_bytes=4 * 1024 * 1024)
encrypted_file = media_fise.encrypt(file_bytes, context)
selected = media_fise.decrypt_range(encrypted_file, 1_000, 2_000, context)

for chunk in media_fise.decrypt_progressive(
    encrypted_file,
    context,
    chunk_size=256 * 1024,
):
    consume(chunk)
```

Python `bytes` corresponds to top-level JavaScript binary data. Its range is
also half-open, and its progressive iterator is pull-driven and synchronous.

Edge mode is inspired by the practical head/tail pattern used for large video
files. It keeps one ordinary FISE envelope and records the resolved policy in
that envelope:

```js
const mediaFise = new Fise(profile, {
  binary: { mode: "edges" }
});

const encryptedVideo = mediaFise.encrypt(videoBytes, context);
const restoredVideo = mediaFise.decrypt(encryptedVideo, context);
```

The consumer does not pass edge options. FISE binds the mode and edge length to
the same Profile/context marker used by the envelope, then restores the correct
regions automatically.

Omitting `edgeBytes` uses 1 MiB per side. Applications that need to tune the
trade-off can provide a positive byte count:

```js
const mediaFise = new Fise(profile, {
  binary: { mode: "edges", edgeBytes: 4 * 1024 * 1024 }
});
```

If the two resolved regions meet or overlap, FISE canonicalizes that envelope
to full mode. The policy applies only to top-level binary input; text and
structured data still use full coverage on the same instance.

## Edge mode boundary

Edge mode reduces Profile-kernel work, but it does not reduce envelope length or
avoid producing one complete in-memory result. The middle content bytes are
copied without the Profile transform and remain directly inspectable.

For a video, changing the beginning and end can prevent ordinary playback for
some container layouts, but FISE does not parse media formats and does not
guarantee that the file is unplayable or unrecoverable. Container metadata may
appear at different locations, and media bytes in the middle remain available.
Choose edge size based on application measurements and accepted exposure, not
as a confidentiality guarantee.

Profile/context mismatch, TTL, exact length, binary metadata, and malformed
coverage policy are still checked. The marker is not a cryptographic integrity
tag and does not detect arbitrary middle-byte tampering.

## Restore one range

```js
const selected = fise.decryptRange(
  encryptedFile,
  { start: 1_000, endExclusive: 2_000 },
  context
);
```

The range is half-open and addresses the original binary content. FISE first
validates the complete envelope, restores its two metadata bytes, then returns
only the requested content bytes. For an ordinary local `Uint8Array`, the
synchronous path can read the envelope during the call and copy only the fixed
fields, marker, metadata, and selected range. It snapshots inputs whose byte
ownership cannot be trusted.

Under full mode, the reverse kernel processes the selected range. Under edge
mode, it processes only selected bytes that intersect a transformed edge; a
range wholly inside the middle is copied without reverse-kernel work.

Range restoration does not allocate or restore the complete plaintext, but the
complete encrypted envelope must already be accessible in memory. Repeated
calls still repeat header and marker validation; FISE does not expose a
long-lived parsed-envelope handle.

## Restore progressively

```js
for await (const chunk of fise.decryptProgressive(encryptedFile, context, {
  chunkSize: 256 * 1024
})) {
  consume(chunk);
}
```

`chunkSize` controls plaintext bytes returned per pull and defaults to 256 KiB.
It is not stored during encryption. Validation occurs when the iterator is
created and the complete envelope is snapshotted so later caller mutation
cannot affect it; later chunks are restored only when requested. An optional
`AbortSignal` is checked before each pull. Without context, options can be the
second argument: `fise.decryptProgressive(encryptedFile, { chunkSize })`.

Progressive restoration is not network streaming. FISE does not fetch HTTP
ranges, parse incoming fragments, or create independently cacheable/retryable
chunks. The application supplies one complete envelope.

## WASM and workers

The same full and edge envelopes interoperate across JavaScript, generated WASM,
and retained workers:

```js
const wasm = await fise.withWasm();
const restored = wasm.decrypt(encryptedFile, context);

const mediaFise = new Fise(profile, {
  binary: { mode: "edges" }
});
const parallel = await mediaFise.parallel({ workerCount: 4 });
try {
  const encrypted = await parallel.encrypt(videoBytes, context);
} finally {
  await parallel.close();
}
```

Worker splits are runtime details and do not appear in the wire. For small edge
regions, worker startup and messaging can cost more than the transform; measure
with representative files before choosing a backend.

## Limits

The decoded envelope cap is 512 MiB. Progressive and asynchronous restoration
snapshot the complete encrypted input, while common synchronous full/range
paths can avoid that full input copy. Encryption and full decryption still
allocate complete outputs and may temporarily hold multiple large buffers.
Platform and mobile-browser memory limits can be much lower than the wire cap.

For files beyond that boundary or true network streaming, define an
application-level storage/transport protocol and apply FISE to independently
owned objects. Do not split producer and consumer with independently generated
Profiles.

See the runnable [binary restoration example](../examples/binary-restoration.mjs),
the [HTTP JSON/binary example](../examples/web-application.mjs), the
[web integration guide](./WEB_APPLICATIONS.md), the
[normative specification](./SPEC.md), and the [security boundary](./SECURITY.md).

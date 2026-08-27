# Security boundary

FISE 2.0 is a generated application-representation protocol. It is not a
cryptographic confidentiality, authenticity, or integrity system.

## Intended property

Conventional frontend JSON and byte payloads are directly intelligible to
generic tooling. FISE replaces that representation with one requiring the
application's generated Profile, context convention, and restoration path.

Different Profile generations change byte semantics, operation order,
constants, fused JavaScript, and WASM code. The intended effect is to reduce
reuse of one static signature or universal application-specific decoder and to
increase Profile-specific integration work.

That effect is deployment-dependent and should be measured. It must not be
described as secrecy, impossibility of decoding, or cryptographic strength.
Base64URL transport for structured values adds no protection.
Adaptive structured compression is a transport optimization and adds no
security property. Envelope length can reveal payload size and compressibility.

## Public inputs

The following are public and may be obtained by a client-side attacker:

- generated Profile source and fingerprint;
- envelope, coverage, context derivation, and positional context convention;
- optional absolute envelope expiry;
- runtime package and wire specification;
- marker and length behavior; and
- JavaScript, WASM, and worker execution paths.

The Profile is executable code shipped to the consumer, not a secret key.
Context is application-supplied external data, not a FISE-managed secret. A
derived context segment is omitted from the envelope, but an attacker can test
context candidates using the public Profile and 32-bit marker.

Only use context values that the client is already allowed to know. Never make
an authentication token, protected cookie, HttpOnly session value, or other
credential client-visible just to use it as FISE context.

The CLI derives a fingerprint when it generates a Profile, but the runtime uses
that value only as an opaque compatibility identifier. It is not proof that a
source file is unchanged, a global uniqueness guarantee, or an authentication
or integrity tag.

Without TTL, runtime output is deterministic. The same Profile, payload,
context, and binary coverage produce the same envelope, so observers can detect
equality. TTL adds a visible absolute expiry and can change bytes between Unix
seconds. FISE provides no semantic security or nonce-based randomization.

## Attacker capabilities

A determined attacker controlling or instrumenting the client can:

- call `decrypt` with the application's Profile and context;
- enumerate or infer low-entropy positional context values;
- hook the generated reverse kernel;
- break after restoration and read application state;
- inspect network, memory, workers, or WASM linear memory;
- modify FISE code or bypass it entirely;
- change the client clock or remove the runtime expiration check;
- replay or tamper with envelopes; and
- directly inspect every untransformed byte in binary edge mode.

FISE cannot prevent these actions. Client-visible plaintext is ultimately
observable where the application uses it.

## Properties not provided

FISE does not provide:

- confidentiality;
- authenticity or sender identity;
- payload integrity;
- authorization;
- cryptographic expiry, revocation, or replay prevention;
- secret-key management;
- tamper-proof client execution; or
- protection from XSS, malicious extensions, compromised devices, or runtime hooks.

The 32-bit marker detects many accidental Profile/context/wire-policy
mismatches. It can collide and does not protect arbitrary payload bytes.

## Binary edge mode

Binary edge mode is an explicit constructor-level producer policy. It
transforms logical metadata plus the first and last resolved content bytes. An
omitted `edgeBytes` uses 1 MiB per side. The middle content is copied unchanged
into the envelope. This can reduce Profile-kernel work for a large file, but it
deliberately has weaker coverage than default full mode.

Changing a file's edges may disrupt ordinary parsing or playback for some
formats. That is not a confidentiality guarantee: FISE does not understand file
formats, and middle bytes remain readable and reusable. Applications must not
describe edge mode as protecting the complete file.

The mode and edge length are carried in the ordinary header and included in the
Profile/context operation binding. Blind changes normally cause parser or marker
failure, but the marker is not a MAC. Edge mode keeps the same TTL,
wrong-Profile, wrong-context, exact-length, range, and progressive checks as
full mode.

## Runtime envelope TTL

An instance configured with `{ ttlSeconds }` writes one absolute expiry into
every envelope it creates. The normal unmodified full, range, and progressive
paths verify the expiry-bound Profile marker and throw `ENVELOPE_EXPIRED` at
`nowSeconds >= expiresAtSeconds`. Progressive restoration checks when its
iterator is created.

This is application freshness behavior, not a security boundary. It cannot
revoke plaintext already restored, stop replay while an envelope is valid,
enforce server authorization, resist clock rollback, or prevent a controlled
client from patching the check. Applications that require trusted expiry must
enforce it independently on a trusted server. For backend-to-browser flows,
network delay and producer/consumer clock skew can also reject an otherwise
ordinary response; choose a sufficiently wide lifetime or omit TTL when this
would break correctness.

## Required companion controls

Use TLS for transport and enforce authorization on trusted servers. If data
must remain confidential or tamper-evident outside that trust boundary, use a
reviewed authenticated-encryption construction and manage keys outside the
untrusted frontend. Apply CSP, dependency controls, schema validation, size
limits, and ordinary secure-development practices independently of FISE.

## Raw fallback mode

Default `new Fise(profile)` behavior propagates rejected operations.
`{ strict: false }` is an explicit availability option that instead returns the
exact original input for recoverable `encrypt` or `decrypt` failures.
`ENVELOPE_EXPIRED` and `CLOCK_UNAVAILABLE` always propagate so fallback cannot
bypass a configured lifetime.

This mode weakens the application boundary by design. Failed `encrypt` can let
readable text, JSON, or binary data continue toward a client. Failed `decrypt`
can let malformed, attacker-controlled, wrong-Profile, or wrong-context input
continue into application code. The return value has no trusted success
discriminant, and raw binary has the same JavaScript type as a FISE binary
envelope. The mode is not safe downgrade negotiation and must not be enabled
where FISE transformation is required.

If availability requirements justify it, the surrounding application must
accept both output shapes, validate the restored or raw value against its own
schema, and monitor fallback at the transport boundary. FISE does not send,
log, label, authenticate, or authorize returned raw input. Range and
progressive methods remain strict.

## Parser and resource safety

The runtime rejects unknown versions, profiles, flags, metadata types, coverage
combinations, lengths, ranges, context shapes, proxy/custom-prototype wrappers,
invalid Unicode scalar strings or property names, ambiguous numbers, and
invalid generated Profile outputs. Unicode is preserved without normalization;
composed and decomposed strings can therefore produce different envelopes.
Canonical Base64URL parsing rejects
padding, whitespace, invalid alphabet, impossible lengths, and nonzero unused
bits. Default strict mode propagates failures; opt-in raw fallback converts only
recoverable `encrypt`/`decrypt` `FiseError` results as described above.

Compressed structured payloads declare an original byte length before their
LZ4 block. The runtime bounds that length and its expansion ratio, requires the
block to consume and produce exact lengths, rejects invalid offsets and runs,
and then repeats fatal UTF-8, JSON, and canonical-form validation. Compression
does not bypass the global structured-output cap.

The implementation snapshots mutable inputs before asynchronous worker or
progressive execution. A synchronous decrypt or range operation may borrow an
ordinary local `Uint8Array` only for the duration of the call; shared, cross-realm,
subclassed, or otherwise non-borrowable byte input falls back to an owned
snapshot. Advertised envelope and decompressed lengths are checked before large
allocation or kernel work. Context depth, context size, envelope size, worker
count, and WASM memory are bounded. Range and progressive APIs validate the
complete envelope and binary metadata before returning selected bytes. Public
byte, option, range, and context inspection failures are converted to stable
`FiseError` codes. WASM input and context bytes are cleared from the used linear
memory region on both success and failure. Closed parallel runtimes reject all
operations.

These controls reduce parser and resource hazards. They do not elevate FISE to
a cryptographic security boundary.

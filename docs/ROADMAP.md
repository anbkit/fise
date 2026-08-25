# FISE Roadmap

This roadmap separates implemented 1.1 behavior from future research. Proposed
items are not package APIs or delivery promises.

## Version 1.1 baseline

Implemented in the current source tree:

- strict versioned string and binary envelopes with no legacy decoder;
- atomic profiles owning transform, layout, context, limits, and identity;
- marker recomputation with no `decodeLength`;
- exact lengths, fixed tail salt, typed failures, and pre-parse core bounds;
- canonical profile manifests, 128-bit digest-prefix IDs, full-digest
  deeply immutable artifacts, strict numeric/exhaustive salt-range validation,
  vectors, and rotation diffs;
- `fise profile validate|build|vectors|diff` CLI;
- binary-first UTF-8, JSON, strict HTTP media, compression-aware lengths, and
  bounded response ingestion;
- registered built-in JavaScript/WASM backend binding, semantic checks, bounded
  WASM memory, and parity tests;
- deterministic Unicode/binary property sweeps;
- an independent standard-library Python reference for compiled binary
  artifact identity and wire conformance;
- runtime adaptation benchmark with explicit claim boundaries; and
- package, migration, specification, security, and conformance documentation.

## Reliability and interoperability

### Malformed-input fuzz corpus

Add coverage-guided fuzzing for headers, declared lengths, media parameters,
base64, manifests, and WASM sizes with explicit time/allocation budgets.
Property round trips are present; adversarial corpus minimization is not.

### Broader cross-language conformance

The Python reference now verifies the compiled binary subset. Add a second
implementation language, independent review from the specification, malformed
artifact corpora, and an explicit 16-bit-code-unit model before extending the
evidence claim to the default string profile.

### Release evidence bundle

Persist machine-readable test/runtime versions, package contents, browser
console output, benchmark metadata, profile artifacts, and vectors for each
release candidate.

### Browser/device matrix

Automate Chromium, Firefox, and WebKit, then record representative mobile,
embedded, and Smart TV measurements before making broad support claims.

## Performance and integration

### Parallel binary transform backends

Specify deterministic byte-range partitioning for transforms that explicitly
declare position separability. Evaluate workers, transferable buffers, SIMD,
and runtime-supported threads while preserving transform identity, output
ownership, cancellation, failure, and full-envelope conformance. Measure
startup and transfer cost, main-thread responsiveness, throughput, and the
payload-size crossover before presenting parallel encrypt/decrypt as a
supported capability.

### Caller-owned output

Explore opt-in buffers with precise ownership, aliasing, partial-failure, and
memory-lifetime rules. Keep the current owned-output contract unchanged.

### Representative benchmark suite

Add raw samples, confidence intervals, allocation/GC observation, compression,
no-FISE baselines, and real application payload distributions.

## Protocol research

### Partial and range restoration

Define a profile capability for slice-local transforms, an absolute-offset API,
marker-aware range mapping, caller and transport bounds, and deterministic
range vectors. Do not infer sliceability for arbitrary runtime callbacks. The
current 1.1 decoder validates and reconstructs complete envelopes and is not a
range-request protocol.

### Framed streaming and lazy restoration wire v2

Streaming needs new magic/version negotiation, bounded frames, ordering and
truncation semantics, incremental parsing, backpressure, resource limits,
frame/index validation, and golden vectors. Define separately when restored
bytes and application values may become observable; incremental byte output
does not automatically make JSON decoding lazy. Concatenating 1.1 envelopes is
not a streaming protocol.

### Authenticated composition

Specify tested composition with standard AEAD/signatures at a boundary where
keys can be protected. Do not retrofit an authentication claim onto the
current public marker.

### Signed profile artifacts

Define canonical signed bytes, issuer trust, algorithm agility, expiry/skew,
rollback, revocation, and offline verification. Current SHA-256 artifacts are
unsigned content identities.

### Profile registry and negotiation

Explore a registry only with bounded lookup, explicit allowlists, downgrade
resistance, caching rules, and no automatic legacy fallback.

### Media-specific profiles

Start with complete-segment wrapping. Codec-internal MP4/CMAF, JPEG, WebP, or
AVIF mutation remains out of scope until format, range-request, CDN, device,
and recovery behavior is specified and tested.

## Promotion criteria

A proposal becomes supported only when it has:

- a versioned contract and migration story;
- deterministic independent conformance evidence;
- bounded malformed-input behavior;
- real target-runtime verification;
- measured legitimate-user and adaptation benefit; and
- security wording limited to the property actually delivered.

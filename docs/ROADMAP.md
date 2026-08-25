# FISE Roadmap

This roadmap separates the stable FISE 1.1 / FISF 1.0 protocol contracts,
package 1.2 evidence tooling, and future research. Proposed items are not
package APIs or delivery promises.

## Stable protocol baseline

Implemented in the current source tree:

- strict versioned string and binary envelopes with no legacy decoder;
- atomic profiles owning transform, layout, context, limits, and identity;
- marker recomputation with no `decodeLength`;
- exact lengths, fixed tail salt, typed failures, and pre-parse core bounds;
- deterministic half-open Unix-millisecond time-window context derivation with
  no hidden clock read, context serialization, or adjacent-window fallback;
- canonical profile manifests, 128-bit digest-prefix IDs, full-digest
  deeply immutable artifacts, strict numeric/exhaustive salt-range validation,
  vectors, and rotation diffs;
- `fise profile validate|build|vectors|diff` CLI;
- binary-first UTF-8, JSON, strict HTTP media, compression-aware lengths, and
  bounded response ingestion;
- registered built-in JavaScript/WASM backend binding, semantic checks, bounded
  WASM memory, and parity tests;
- deterministic Unicode/binary property sweeps;
- real dedicated-worker XOR execution with absolute-offset partitioning,
  cancellation, explicit lifecycle, strict backend identity, and unchanged
  ordinary 1.1 envelope bytes;
- the opt-in indexed `FISF` 1.0 container with bounded independent inner 1.1
  envelopes, full/range restore, and pull-driven progressive byte restore;
- eight dependency-free, packed, executable public-API examples;
- an independent standard-library Python reference for compiled binary
  artifact identity and wire conformance;
- runtime adaptation benchmark with explicit claim boundaries; and
- package, migration, specification, security, and conformance documentation.

Package 1.2 adds evidence and release tooling without changing either wire
contract:

- instrumented range/progressive tests prove selected-frame transform counts,
  zero prefetch, early termination, abort-on-next-pull, caller-container
  snapshot ownership, empty behavior, and synchronous outer-index validation;
- deterministic framed and worker benchmark suites with warm statistics, raw
  samples on request, explicit setup boundaries, process-memory observations,
  correctness preflights, and machine-readable non-claims;
- exact-tarball empty-consumer verification shared by release-candidate and
  packed-browser paths; and
- an external release-evidence bundle plus tag workflow recording package,
  source, runtime, commands, artifact metadata, and SHA-256 without digest
  self-reference or automatic npm publication.

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

### Signed and retained release provenance

The repository now produces a machine-readable external evidence bundle and
uploads it for version tags. Future work can add signed attestations, longer
retention, npm trusted publishing, and browser-console artifacts after defining
their trust and credential boundaries.

### Browser/device matrix

Automate Chromium, Firefox, and WebKit, then record representative mobile,
embedded, and Smart TV measurements before making broad support claims.

## Performance and integration

### Browser worker evidence and additional backends

The built-in XOR worker backend has deterministic absolute-offset partitioning,
caller-input snapshots, cancellation, explicit close, strict identity, and
ordinary-envelope conformance. The Node suite now records aggregate startup,
first/warm operation, close, throughput, and representative `FISF` results.
Add real browser main-thread/timer evidence and representative device crossover
measurements before making a general speedup or responsiveness claim. SIMD and
runtime-supported threads remain separate backend research; do not infer
position separability for arbitrary profile callbacks.

### Caller-owned output

Explore opt-in buffers with precise ownership, aliasing, partial-failure, and
memory-lifetime rules. Keep the current owned-output contract unchanged.

### Representative benchmark suite

Raw samples and scoped process-memory observations now exist for framed and
worker suites. Add confidence intervals, controlled GC/allocation tooling,
compression and no-FISE baselines, and real application payload distributions.

## Protocol research

### Transport-aware range restoration

`FISF` range restore now validates one outer index and transforms only selected
independent inner envelopes. Add a transport API that fetches a bounded
header/index first and then only required envelope ranges, with HTTP validator,
cache, cancellation, retry, and compressed-transfer semantics. Ordinary `FISE`
1.1 envelopes remain complete-value formats and arbitrary callbacks are not
treated as sliceable.

### Incremental transport and application lazy decoding

`FISF` 1.0 defines magic/version negotiation, bounded indexed frames,
ordering/truncation checks, pull-driven byte backpressure, resource limits, and
a golden vector. Its current API still receives the complete container. A true
streaming reader needs incremental header/index/body ingestion and bounded
buffer ownership. Lazy JSON additionally needs an incremental UTF-8/parser and
an explicit rule for when partial application values become observable.
Concatenating ordinary 1.1 envelopes remains unsupported.

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
- measured legitimate-user or adaptation benefit before making a benefit
  claim; and
- security wording limited to the property actually delivered.

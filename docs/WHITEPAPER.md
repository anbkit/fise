# FISE 2.0: Generated Profile-Governed Application Representations

## Abstract

FISE—Fast Interoperable Structured Envelope—is a keyless data-representation
protocol for web applications. Instead of a secret encryption key, FISE uses
generated Profile runtime code as the reversible rule shared by the frontend
and backend. An application generates one Profile, deploys the exact generated
artifact or verified JavaScript/Python pair to both sides, encrypts on one side,
and decrypts on the other. Here, keyless means there is no built-in secret
encryption-key lifecycle; the Profile remains public application code, and the
verbs `encrypt` and `decrypt` do not claim cryptographic confidentiality.

Frontend applications eventually receive usable data. Transport encryption can
protect that data between endpoints, but it does not make plaintext secret from
the authorized client that renders, computes with, or stores it. Conventional
JSON and ordinary byte payloads are also immediately consumable by generic
tools once observed at that client.

Within that boundary, FISE explores a narrower engineering goal: replace a
directly consumable application representation with a strict, generated,
profile-specific representation. Each FISE 2.0 Profile is one immutable
compatibility unit. A JavaScript deployment uses one generated source artifact;
a Python backend uses the JavaScript/Python pair emitted from the same transient
IR. Each imported instance contains the same randomly generated but deterministic
reversible byte pipeline, inverse, context mixing, and layout calculations, with
matching JavaScript, Python, and JavaScript/WASM execution. Producer and consumer
version the exact artifact or pair through ordinary source control.

The central hypothesis is not that FISE creates secrecy. It is that semantic
diversity across generated profiles can reduce reuse of static signatures and
generic application-specific decoders, requiring additional profile-specific
analysis and integration work. The size and value of this adaptation gap are
deployment-specific empirical questions.

## 1. Problem boundary

TLS protects network transport against parties outside the encrypted channel.
Server-side authorization determines whether a client may obtain a response.
Neither property changes the fact that an authorized frontend must eventually
possess a representation it can use.

For a conventional response, observation often yields immediately meaningful
JSON property names, strings, numbers, arrays, or standard media bytes. An
observer can feed that representation directly to existing parsers and tools.
FISE inserts an application-owned restoration step between observation and
ordinary use:

```text
ordinary value
→ canonical bytes and type metadata
→ adaptive structured compression when smaller
→ generated profile transform
→ strict envelope
→ generated profile reverse
→ ordinary value
```

This step may increase the cost of building a reusable extraction or adaptation
path. It cannot prevent a party that controls the client runtime from invoking,
hooking, or bypassing the same restoration step.

## 2. Claims and non-claims

FISE 2.0 makes the following bounded engineering claims:

1. A generated profile is a single immutable compatibility unit.
2. Generation independently samples meaningful reversible semantics; its
   variability is not limited to identifiers or dead source changes.
3. The generated JavaScript, Python, WASM, and worker paths are byte-compatible.
4. Wire parsers are strict, versioned, bounded, and reject invalid input; the
   default runtime propagates those failures.
5. Byte-local kernels permit direct range and pull-driven restoration from one
   ordinary binary envelope.
6. The runtime requires no encryption-key lifecycle.
7. An optional instance lifetime makes the normal restoration path reject an
   envelope after its encoded absolute expiry.
8. An explicit binary edge mode can reduce transform work by leaving a declared
   middle region untransformed.
9. Structured input uses deterministic bounded compression before the Profile
   transform only when its complete internal representation is smaller.

FISE does not claim:

- cryptographic confidentiality;
- authenticity, integrity, or sender identity;
- authorization, cryptographic expiry, revocation, or replay prevention;
- resistance to dynamic instrumentation;
- secrecy of the profile, context derivation, wire, or implementation;
- impossibility of decoding;
- a quantified security level derived from pipeline length or random parameters.

The API retains the familiar verbs `encrypt` and `decrypt`. They describe
forward and reverse operations, not a cryptographic guarantee.

## 3. Design principles

### 3.1 One generated Profile

The CLI emits one JavaScript module whose default export is a `Profile`
instance. When a Python backend is selected, that same operation emits an
adjacent Python module from the same in-memory IR. The application does not
compose public rules, select a complexity tier, or manage a separate manifest:

```ts
import profile from "./fise.profile.js";

const fise = new Fise(profile);
```

Making the profile mandatory at construction prevents a profile-less runtime
state and avoids repeating the profile on every operation.

### 3.2 Git is the lifecycle mechanism

Every successful generator invocation uses fresh entropy to sample profile
code. FISE stores no seed, entropy record, human name, revision, lock, rotation
record, or recipe for deterministic regeneration. The generated source file is
the complete behavioral artifact. Git already supplies history, review,
deployment linkage, and rollback. The CLI refuses to replace an existing file
unless the caller explicitly supplies `--override`.

Replacing the file is therefore an explicit compatibility change. If an old
envelope must be restored, the corresponding old generated code must still be
available from application history or deployment artifacts.

### 3.3 One byte core

FISE 1.x separated string and binary profiles. FISE 2.0 removes that distinction.
All Profile kernels operate on bytes:

```text
JSON-safe value, including string → canonical JSON → UTF-8 → optional LZ4 block
Uint8Array                       → copied raw bytes
```

A transformed metadata segment records the metadata version and whether content
is plain structured UTF-8, top-level binary, or compressed structured UTF-8.
Compressed form additionally declares the exact original byte length. The same
Profile therefore restores strings, objects, arrays, primitives, and bytes.
JSON is a serialization of structured data, not a third transformation
algorithm.

For accepted structured values, canonical JSON follows RFC 8785 primitive
serialization and UTF-16 property ordering. FISE further rejects negative zero
and unpaired surrogates, preserves Unicode without normalization, and treats
numbers as IEEE-754 binary64. A machine-readable conformance corpus freezes the
resulting JSON, UTF-8, payload, compression, transport, and wire bytes for the
current Python runtime and future language runtimes.

Canonical structured UTF-8 of at least 256 bytes is encoded as one independent,
deterministic LZ4 block only when that block plus its four-byte original-length
field is smaller than the plain representation. Restore bounds the declared
length, requires exact block consumption/output, then repeats fatal UTF-8, JSON,
and canonical-form validation. Restore also caps expansion at 256 times the
compressed block length, with a small-input floor. This
compress-before-transform step captures repetition before the Profile transform
makes it difficult for downstream HTTP compression to exploit, while
deliberately keeping the public synchronous API. It does not guarantee a
smaller final response for every payload.

The internal wire is always binary. Public `encrypt` returns canonical unpadded
Base64URL for text and structured input so it can travel in JSON, and raw bytes
for top-level binary input. Base64URL is transport representation only.

### 3.4 Public code is not a key

Generated source, embedded WASM, profile fingerprint, wire, and context
derivation are shipped to the client. They are assumed observable. Keyless
means that the built-in design creates no secret encryption key to distribute
or rotate; it does not mean that public code acquires secret-key properties.

## 4. Profile generation

### 4.1 Random generation, deterministic execution

Node's cryptographically secure random source is consulted during an explicit
`fise generate` command. The result is a typed internal representation of one
profile. Runtime imports do not regenerate or mutate it.

For a fixed Profile, payload, positional context, absolute position, expiry,
and binary coverage, forward and reverse behavior is deterministic. Without TTL, equal payloads
under equal context produce equal complete envelopes. With TTL, equal inputs
created for different absolute expiries can differ. Equality leakage remains a
deliberate simplicity tradeoff, not a confidentiality property.

### 4.2 Reversible primitive set

The current generator chooses four to seven byte-local stages from a constrained
set:

- XOR with a generated position/context-segment/lane mask;
- addition modulo 256 and inverse subtraction;
- data-dependent eight-bit rotation and inverse rotation;
- affine byte mapping with an odd multiplier and its inverse modulo 256.

Masks mix an absolute byte position, selected context lanes, generated 32-bit
constants, and a generated shift into the profile-derived context segment. The
transform is length-preserving and operates independently at each absolute
position.

This locality is a capability constraint, not merely a performance choice. It
allows worker chunks to run independently and lets the same generated semantics
compile to a small WASM loop. Global permutations are excluded because they
would require full-payload state, weaken range locality, and complicate backend
parity.

### 4.3 Inverse construction

The generator does not ask users to write reverse callbacks. It derives reverse
execution by traversing the forward stages in reverse order and replacing each
operation with its mathematical inverse. The emitted low-level forward and
reverse callbacks receive the frozen positional context snapshot. They are part
of the generated compatibility artifact, not a supported customization surface;
applications generate a new verified profile instead of editing them.

### 4.4 Rejecting meaningless diversity

Different text is not sufficient evidence of different behavior. Dead code,
renamed variables, neutral parameters, and canceling operations can be normalized
away by tools and do not create semantic diversity.

Before emission, FISE evaluates the candidate over fixed empty, boundary,
all-byte, and larger vectors; checks forward/reverse equality; requires at least
one changed output; removes each stage in turn and rejects the candidate if the
semantic signature remains unchanged; and checks offset bounds over small and
large lengths. The runtime repeats a small inverse smoke test when the generated
module creates its `Profile` instance.

This validation does not justify an entropy-bit claim. Measuring effective
equivalence classes remains future evaluation work.

Before writing the candidate, the CLI also runs full encrypt/decrypt round
trips for text, adaptive structured values, and binary with random synthetic positional
context, plus empty values with the default context. It checks deterministic
re-encryption, binary full/edge coverage, direct range and progressive
restoration, plus both
JavaScript → WASM/worker and WASM/worker → JavaScript interoperability. Any
failure prevents the candidate from being published. New destinations use an
atomic no-clobber publish, while `--override` uses atomic replacement. `fise
verify` repeats the runtime gate without modifying the profile file.

### 4.5 Specialized output

The internal stage representation is fused into one JavaScript loop for forward
execution and one for reverse execution. Runtime does not dispatch through an
array of per-byte functions or allocate an intermediate buffer for every stage.
The same typed stages are compiled into a profile-specific WASM module.

The CLI derives a 128-bit opaque fingerprint from normalized semantic IR. The
runtime uses it for early wrong-profile rejection, but does not recompute the IR
or attest the exact generated source. It is not a global uniqueness guarantee,
secret, authentication tag, or integrity proof.

## 5. Context as external data

Applications may provide a dense positional array of JSON scalar values:

```ts
fise.encrypt(value, [42, "2026.08"]);
```

Context is snapshotted and canonicalized once per operation, encoded as
unpadded Base64URL, and mixed in full into four profile-specific 32-bit lanes.
Each generated profile also owns a random `uint32` segment offset and a 12–32
byte segment length. The runtime circularly cuts that segment from the encoded
context, wrapping when necessary. Transform, marker, and layout use the segment
and lanes. The raw frozen context is also passed to every low-level callback.

The envelope carries neither the original context, its encoded form, nor its
derived segment, and decrypt does not guess them. Position is the application
contract: `[42, "2026.08"]` differs from `["2026.08", 42]`. Context rejects
objects, nested arrays, accessors, symbols, sparse arrays, ambiguous numbers,
and excessive size. An omitted context is the empty array `[]`.

Context must be composed only from values already available to the consumer.
An application must not expose an authentication token, protected cookie, or
HttpOnly session value just to make it context. Context is not a credential or
authorization input.

When TTL or binary edge coverage is enabled, core appends domain-separated wire
policy to an internal operation binding derived from the encoded context. The
binding drives the same mixer, segment, layout, and marker path, while generated
callbacks still receive only the caller's positional array. This makes blind
expiry or coverage edits inconsistent with the representation; it does not
authenticate those fields.

The mixer is a specified deterministic application mixer, not a cryptographic
authentication hash. A 32-bit marker provides bounded mismatch detection and
can collide.

## 6. Wire format

FISE 2.0 uses one binary envelope. Its fixed header carries magic, exact version,
header length, flags, a 16-byte Profile fingerprint, transformed length,
binary edge bytes per side or zero, and an absolute Unix expiry or zero. The generated marker is
inserted at the Profile-calculated offset inside the logical wire payload.
Context-derived data is not appended to the wire.

The decoder validates every declared bound before allocating or transforming.
It rejects unsupported versions, unknown flags, wrong profiles, truncation,
trailing data, and marker disagreement. It never scans candidate profiles or
contexts and contains no legacy decoder.

For compressed structured metadata it also validates the original-length and
expansion-ratio caps, LZ4 offsets, literal/match bounds, exact input consumption, exact output length,
UTF-8, JSON, and canonical form. Compression adds no confidentiality; observable
wire length still reveals size and compressibility information.

Length remains an ordinary unsigned 32-bit field. Randomizing header field order
or length codecs would create more protocol complexity, complicate indexing,
and provide little additional protection against a runtime observer who already
possesses the decoder. FISE concentrates diversity in executable profile
semantics instead.

## 7. Selective, parallel, and lazy restoration

### 7.1 One ordinary envelope

Generated kernels are length-preserving and byte-local. Every kernel call
receives the logical absolute position of its first byte. FISE can therefore
restore a selected binary interval directly from the ordinary envelope without
an outer container, frame index, or independently encrypted inner envelopes.

Range restoration validates the complete envelope, checks its Profile/context
marker and TTL, and restores only the two logical metadata bytes plus the
requested half-open content interval. For an ordinary local `Uint8Array`, the
synchronous call can borrow input for the duration of that call and copy only
the fields and selected bytes it needs. Non-borrowable inputs are snapshotted.
The physical marker insertion is removed while copying selected wire-payload
bytes. The reverse kernel receives `2 + start` as its logical absolute offset.

Progressive restoration owns a complete input snapshot, performs the same
validation when the iterator is created, and restores the next range on each
pull. `chunkSize` is a runtime read option, not a wire or encryption parameter.
Stopping iteration stops future reverse work.

This is lazy byte restoration, not lazy JSON or network streaming. The complete
encrypted envelope is already in memory; FISE does not perform HTTP Range
acquisition or incremental envelope parsing.

### 7.2 Binary edge coverage

Full coverage transforms metadata and all content bytes. An optional edge mode
transforms metadata plus symmetric leading and trailing binary regions while
copying the middle unchanged. The ordinary header carries the resolved edge
length, and that policy is included in the Profile/context marker binding.
Applications select edge mode once on the producing `Fise` instance. Omitting
an explicit edge length resolves to 1 MiB per side; smaller inputs whose edges
meet or overlap canonicalize to full coverage.

Edge mode can reduce forward and reverse kernel work for large files, including
video-oriented head/tail use cases. It still returns one complete envelope and
does not reduce allocation or transfer length. The clear middle remains
directly inspectable; disrupting a file parser or player is not a confidentiality
guarantee. Range and progressive restoration reverse only intersections with
covered edges and copy selected middle bytes directly.

### 7.3 WASM parity

The CLI embeds a WASM module compiled from the exact generated stages. Calling
`withWasm()` compiles and instantiates that module once, then returns another
profile-bound `Fise`. Envelope layout remains in TypeScript; only the byte kernel
runs in WASM. JavaScript can decrypt WASM-created envelopes and vice versa.

### 7.4 Worker parity

A retained parallel runtime starts dedicated Node or browser module workers.
Each worker compiles the generated profile's WASM module once. Large inputs are
split into contiguous chunks; tasks receive the original absolute position,
derived context segment, and context lanes. Byte-local kernels therefore produce the same result
as an unsplit loop. Small inputs stay local to avoid worker overhead.

Parallel encrypt/decrypt and range work are asynchronous and the retained pool has
an explicit close lifecycle. TTL remains TypeScript orchestration: generated
JavaScript, WASM, and worker kernels receive no clock.

The packed-browser release gate exercises native ESM and a Vite production
build under restrictive CSP. It verifies that the package worker is emitted and
runs in Chromium, and that the bundled frontend fetches and restores
backend-produced JSON and binary HTTP responses. This is concrete
Vite/Chromium evidence, not a claim about every bundler, framework, browser,
mobile device, or deployed CSP.

### 7.5 Explicit raw fallback

The default profile-bound runtime propagates every rejected ordinary operation.
Applications with an explicit availability requirement may construct
`new Fise(profile, { strict: false })`. The runtime still performs the same
validation and transform, but a caught recoverable `FiseError` from ordinary
`encrypt` or `decrypt` returns that method's exact input. Expiration and clock
failures always propagate. WASM and worker instances preserve the option;
range/progressive methods, backend startup, and closed-worker calls remain
strict.

This is application-level pass-through, not a second wire decoder. It makes a
deliberate tradeoff: readable input can continue after failed encryption, and
untrusted input can continue after failed decryption. The result has no trusted
success discriminator. Deployments that enable it must support both outcomes,
validate application data independently, and measure fallback at the transport
boundary.

## 8. Threat model

FISE assumes the application controls producer and consumer releases but does
not trust the client as a secret-holding or tamper-proof environment. An attacker
may read bundled JavaScript, generated profile code, WASM bytes, envelopes,
context conventions, and application state. They may instrument functions,
workers, network calls, memory, and clock behavior.

Against such an attacker, FISE cannot protect plaintext once the application
uses it. The strongest accurate statement is:

> Generated execution diversity can reduce reusable static signatures and
> require profile-specific analysis; it does not prevent runtime observation or
> provide cryptographic confidentiality.

TLS, trusted-server authorization, and authenticated encryption remain separate
controls. FISE must not be used as the sole boundary for secrets, regulated
confidentiality, authorization decisions, or tamper-evident records.

## 9. Evaluation requirements

Correctness is necessary but does not prove the adaptation hypothesis. A useful
evaluation program should separate four questions.

### 9.1 Semantic correctness

- forward/reverse property sweeps;
- all 256 byte values and boundary lengths;
- structured and binary metadata restoration;
- adaptive compression selection, exact LZ4 restoration, malformed blocks, and
  decompressed-size bounds;
- profile/context mismatch behavior;
- malformed Base64URL, headers, coverage fields, lengths, and ranges;
- TTL boundaries, clock failures, and expiry metadata mutation;
- input ownership and output non-aliasing;
- full/range/progressive equality;
- JavaScript/WASM/worker byte parity.

### 9.2 Generator diversity

- semantic signatures across many generated profiles;
- normalized-code similarity after minification;
- effective equivalence classes rather than parameter-count estimates;
- frequency of rejected dead or equivalent candidates;
- generated source and WASM size distributions.

### 9.3 Runtime cost

- generation time;
- import/profile validation time;
- warm and cold JS/WASM operations;
- worker startup and retained-pool throughput;
- small and large structured/binary payloads;
- structured identity, gzip, and Brotli transfer sizes before and after FISE;
- binary full/edge encryption, aligned/unaligned range, first pull, and
  complete progressive drain;
- allocation, retained WASM memory, and wire overhead.

The repository command `npm run benchmark:structured` provides the required
structured transport matrix for deterministic 1, 100, and 1,000-record fixtures
(and larger suites in full mode). It reports canonical bytes, FISE JSON bytes,
gzip/Brotli results, and encrypt/decrypt timing. Release-candidate generation
stores the machine-readable result. These fixtures demonstrate the transport
trade-off; they do not predict an application's compression ratio, CDN cost, or
latency without application-specific measurement.

A reference default run on Node 22.14.0/darwin-arm64 with the committed fixture
produced the following deterministic sizes. “FISE JSON” is one `{ data }` field;
gzip and Brotli columns show `raw / FISE` bytes:

| Records | Canonical JSON | FISE JSON | gzip raw/FISE | Brotli raw/FISE |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 177 | 309 | 156 / 278 | 122 / 261 |
| 100 | 17,652 | 6,326 | 2,804 / 4,798 | 1,980 / 4,784 |
| 1,000 | 177,485 | 54,010 | 24,502 / 40,720 | 15,238 / 40,634 |

The larger fixture shows why compression belongs before the Profile transform:
the FISE JSON representation falls from 177,485 to 54,010 bytes instead of
expanding to transformed raw-JSON size. It also shows the remaining cost:
ordinary JSON still compresses more efficiently under gzip and Brotli. The
single-record fixture demonstrates fixed envelope/Base64URL overhead. FISE
therefore needs workload-specific measurement rather than a universal “smaller”
or “faster” claim.

### 9.4 Adaptation cost

The central product hypothesis requires controlled comparison between
conventional payloads, one fixed public transform, and many generated profiles.
Measurements should distinguish static identification, implementation of a
decoder, dynamic hooking, maintenance after profile replacement, and false
positives. Results must report tools, samples, release setup, and uncertainty;
they must not be translated into cryptographic strength.

## 10. Interoperability and deployment

FISE 2.0 treats one generated Profile as the compatibility artifact. A
JavaScript-only deployment imports the exact same committed file. A Python
backend and JavaScript frontend import the exact pair emitted by
`fise generate <js-path> --backend python`; both files carry one fingerprint and
produce the same wire. Multiple Profiles are allowed for independent
application domains, but they are not tied to data types.

In a monorepo, one shared package should own the generated artifact or pair.
With separate repositories, one side generates once and distributes the exact
language artifacts; independent generation is incompatible by design. The
applications also share the positional context convention, while
operation-specific values remain outside the Profile and envelope.

Profile replacement must be coordinated. An atomic release deploys matching
producer and consumer code together. A rolling web release needs an
application-owned versioned endpoint or versioned frontend asset so old clients
continue to reach the old producer until clients and caches drain. FISE does not
add Profile-history lookup or a legacy decoder for this purpose.

Because the generator intentionally stores no seed or IR artifact, another
language backend cannot be recreated later from a generation recipe. The Python
workflow therefore emits and validates both target artifacts in the same
invocation. The packaged JavaScript/Python conformance pair and vectors provide
accepted, malformed, and exact bidirectional evidence. Any additional language
must join that same-generation, same-fingerprint, bidirectional model before it
can claim FISE 2.0 compatibility.

Package and wire 2.0 intentionally remove 1.x functions, default profiles,
manifests, builders, rotation artifacts, the separate legacy string wire, and
legacy fallback parsing. Coordinated upgrades are required.

## 11. Limitations

- Generated code is inspectable and callable.
- Dynamic hooking bypasses static diversity.
- Markers do not authenticate payloads.
- Canonical JSON does not represent arbitrary JavaScript objects.
- Adaptive compression does not guarantee a smaller HTTP response and exposes
  ordinary size/compressibility information.
- Range work is arbitrary-byte but begins with complete-envelope validation and
  metadata restoration.
- Progressive restore starts from a complete in-memory envelope.
- Binary edge mode leaves its middle region untransformed and cannot claim full
  content coverage.
- Worker and WASM availability depends on runtime and policy.
- Vite/Chromium release evidence does not prove other bundlers, browsers, mobile
  memory limits, or an application's deployed CSP.
- Source control is responsible for retaining old profile code when required.
- Opt-in raw fallback can expose untransformed data or pass rejected input to
  application code.
- Runtime TTL can be bypassed by a controlled client and cannot revoke plaintext
  already restored or prevent replay within the valid interval.
- The adaptation-gap hypothesis needs independent empirical measurement.

## 12. Conclusion

FISE 2.0 narrows the project to one coherent idea: a generated, immutable,
profile-governed application representation. A stateless CLI creates different
meaningful reversible pipelines; a profile-bound class applies them uniformly
to structured and binary data; strict parsers reject ambiguity by default;
byte-local kernels enable direct selective and lazy byte restoration; and
JavaScript, Python, WASM, and workers share the same semantics. Adaptive structured
compression reduces the transport penalty for repetitive JSON without changing
the public API. Optional
constructor TTL adds a bounded normal-runtime freshness policy, and applications
may explicitly trade other default rejection behavior for raw
ordinary-operation pass-through.

The approach is useful only when its boundary is stated precisely. FISE can add
profile-specific adaptation work. It cannot make frontend plaintext secret.

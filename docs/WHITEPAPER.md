# FISE 2.0: Generated Profile-Governed Application Representations

## Abstract

Frontend applications eventually receive usable data. Transport encryption can
protect that data between endpoints, but it does not make plaintext secret from
the authorized client that renders, computes with, or stores it. Conventional
JSON and ordinary byte payloads are also immediately consumable by generic
tools once observed at that client.

FISE—Fast Interoperable Structured Envelope—explores a narrower engineering
goal: replace a directly consumable application representation with a strict,
generated, profile-specific representation. Each FISE 2.0 profile is immutable
executable code containing a randomly generated but deterministic reversible
byte pipeline, its inverse, context mixing, layout calculations, and matching
JavaScript/WASM execution. Producer and consumer deploy the same generated
file. The file is public and is versioned by ordinary source control.

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
2. Different generation runs select different meaningful reversible semantics,
   not merely different identifiers.
3. The generated JavaScript, WASM, and worker paths are byte-compatible.
4. The wire format is strict, versioned, bounded, and fail-closed.
5. Independent frames permit selective and pull-driven binary restoration.
6. The runtime requires no encryption-key lifecycle.

FISE does not claim:

- cryptographic confidentiality;
- authenticity, integrity, or sender identity;
- authorization, expiry, or replay prevention;
- resistance to dynamic instrumentation;
- secrecy of the profile, context derivation, wire, or implementation;
- impossibility of decoding;
- a quantified security level derived from pipeline length or random parameters.

The API retains the familiar verbs `encrypt` and `decrypt`. They describe
forward and reverse operations, not a cryptographic guarantee.

## 3. Design principles

### 3.1 One generated object

The CLI emits one module whose default export is a `Profile` instance. The
application does not compose public rules, select a complexity tier, or manage
a separate manifest:

```ts
import profile from "./fise.profile.js";

const fise = new Fise(profile);
```

Making the profile mandatory at construction prevents a profile-less runtime
state and avoids repeating the profile on every operation.

### 3.2 Git is the lifecycle mechanism

Every generator invocation intentionally creates new profile code. FISE stores
no seed, entropy record, human name, revision, lock, rotation record, or recipe
for deterministic regeneration. The generated source file is the complete
behavioral artifact. Git already supplies history, review, deployment linkage,
and rollback.

Replacing the file is therefore an explicit compatibility change. If an old
envelope must be restored, the corresponding old generated code must still be
available from application history or deployment artifacts.

### 3.3 One byte core

FISE 1.x separated string and binary profiles. FISE 2.0 removes that distinction.
All profile kernels operate on `Uint8Array`:

```text
JSON-safe value, including string → canonical JSON → UTF-8 bytes
Uint8Array                       → copied raw bytes
```

A two-byte transformed metadata segment records the metadata version and
whether the content is structured or binary. The same profile therefore
restores strings, objects, arrays, primitives, and bytes. JSON is a serialization
of structured data, not a third transformation algorithm.

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

For a fixed profile, payload, positional context, and absolute position,
forward and reverse behavior is deterministic. The complete envelope is also
deterministic: equal payloads under equal context produce equal envelopes. This
equality leakage is a deliberate simplicity tradeoff, not a confidentiality
property.

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
operation with its mathematical inverse. The low-level forward and reverse
callback ABI nevertheless receives the frozen positional context snapshot for
advanced JavaScript-only customization. A manual change must provide a true
inverse and cannot claim parity with the embedded WASM unless that module and
the semantic fingerprint are regenerated and verified together.

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

### 4.5 Specialized output

The internal stage representation is fused into one JavaScript loop for forward
execution and one for reverse execution. Runtime does not dispatch through an
array of per-byte functions or allocate an intermediate buffer for every stage.
The same typed stages are compiled into a profile-specific WASM module.

A 128-bit opaque fingerprint is derived from normalized semantic IR. It identifies
compatibility and enables early wrong-profile rejection. It is not a secret or
an authentication tag.

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

The mixer is a specified deterministic application mixer, not a cryptographic
authentication hash. A 32-bit marker provides bounded mismatch detection and
can collide.

## 6. Wire format

FISE 2.0 uses one binary envelope. Its fixed header carries magic, exact version,
header length, flags, a 16-byte profile fingerprint, transformed length, and
reserved zeros. The generated marker is inserted at the profile-calculated
offset inside transformed bytes. Context-derived data is not appended to the
wire.

The decoder validates every declared bound before allocating or transforming.
It rejects unsupported versions, unknown flags, wrong profiles, truncation,
trailing data, and marker disagreement. It never scans candidate profiles or
contexts and contains no legacy decoder.

Length remains an ordinary unsigned 32-bit field. Randomizing header field order
or length codecs would create more protocol complexity, complicate indexing,
and provide little additional protection against a runtime observer who already
possesses the decoder. FISE concentrates diversity in executable profile
semantics instead.

## 7. Selective, parallel, and lazy restoration

### 7.1 Independent frames

FISF 2.0 splits a binary value into independent ordinary FISE envelopes. A
strict outer header and contiguous index carry profile fingerprint, frame size,
complete plaintext length, frame count, a profile/context consistency marker,
and each inner envelope's exact offset and length. The marker is checked before
plaintext allocation and also binds the zero-frame representation to its
caller-supplied context; it remains a bounded mismatch signal, not an
authentication tag.

Full restoration visits every frame. Range restoration decrypts only frames
intersecting a requested half-open byte interval and slices boundary bytes.
Progressive restoration snapshots the complete container, validates the outer
index, and decrypts one frame per consumer pull. Stopping iteration stops future
frame work.

This is lazy frame decrypt, not lazy JSON. The full container is already in
memory; FISF does not perform HTTP Range acquisition or incremental network
parsing.

### 7.2 WASM parity

The CLI embeds a WASM module compiled from the exact generated stages. Calling
`withWasm()` compiles and instantiates that module once, then returns another
profile-bound `Fise`. Envelope layout remains in TypeScript; only the byte kernel
runs in WASM. JavaScript can decrypt WASM-created envelopes and vice versa.

### 7.3 Worker parity

A retained parallel runtime starts dedicated Node or browser module workers.
Each worker compiles the generated profile's WASM module once. Large inputs are
split into contiguous chunks; tasks receive the original absolute position,
derived context segment, and context lanes. Byte-local kernels therefore produce the same result
as an unsplit loop. Small inputs stay local to avoid worker overhead.

Parallel ordinary and framed methods are asynchronous and the retained pool has
an explicit close lifecycle.

## 8. Threat model

FISE assumes the application controls producer and consumer releases but does
not trust the client as a secret-holding or tamper-proof environment. An attacker
may read bundled JavaScript, generated profile code, WASM bytes, envelopes,
context conventions, and application state. They may instrument functions, workers, network
calls, or memory.

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
- profile/context mismatch behavior;
- malformed headers, lengths, indexes, and ranges;
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
- FISF full, aligned range, unaligned range, first pull, and complete drain;
- allocation, retained WASM memory, and wire overhead.

### 9.4 Adaptation cost

The central product hypothesis requires controlled comparison between conventional
payloads, one fixed public transform, and many generated profiles. Measurements
should distinguish static identification, implementation of a decoder, dynamic
hooking, maintenance after profile replacement, and false positives. Results
must report tools, samples, release setup, and uncertainty; they must not be
translated into cryptographic strength.

## 10. Interoperability and deployment

FISE 2.0 currently treats the generated module as the compatibility artifact.
Producer and consumer must import the exact same committed file. Multiple
profiles are allowed for independent application domains, but they are not tied
to data types.

Because the generator intentionally stores no seed or IR artifact, another
language backend cannot be recreated later from a generation recipe. True
multi-language generation would need all target artifacts emitted and validated
in the same invocation. That is a future extension, not an implicit property of
the current TypeScript package.

Package and wire 2.0 intentionally remove 1.x functions, default profiles,
manifests, builders, rotation artifacts, string envelopes, and fallback parsing.
Coordinated upgrades are required.

## 11. Limitations

- Generated code is inspectable and callable.
- Dynamic hooking bypasses static diversity.
- Markers do not authenticate payloads.
- Canonical JSON does not represent arbitrary JavaScript objects.
- FISF range work is frame-granular, not arbitrary-byte transform work.
- Progressive restore starts from a complete in-memory container.
- Worker and WASM availability depends on runtime and policy.
- Source control is responsible for retaining old profile code when required.
- The adaptation-gap hypothesis needs independent empirical measurement.

## 12. Conclusion

FISE 2.0 narrows the project to one coherent idea: a generated, immutable,
profile-governed application representation. A stateless CLI creates different
meaningful reversible pipelines; a profile-bound class applies them uniformly
to structured and binary data; strict envelopes reject ambiguity; frames enable
selective and lazy byte restoration; and JavaScript, WASM, and workers share the
same semantics.

The approach is useful only when its boundary is stated precisely. FISE can add
profile-specific adaptation work. It cannot make frontend plaintext secret.

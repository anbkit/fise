# Security boundary

FISE 2.0 is a generated application-representation protocol. It is not a
cryptographic confidentiality or authentication system.

## Intended property

Conventional frontend JSON and byte payloads are directly intelligible to
generic tooling. FISE replaces that representation with one requiring the
application's generated profile, context convention, and restoration path.

Different profile generations change actual byte semantics, operation order,
constants, fused JavaScript, and WASM code. The intended effect is to reduce
reuse of one static signature or universal application-specific decoder and to
increase profile-specific integration work.

That effect is deployment-dependent and should be measured. It must not be
described as secrecy, impossibility of decoding, or cryptographic strength.

## Public inputs

The following are public and may be obtained by a client-side attacker:

- generated profile source;
- profile fingerprint;
- envelope, context derivation algorithm, and positional context convention;
- runtime package and wire specification;
- marker, length, and framing behavior;
- JavaScript, WASM, and worker execution paths.

The profile is executable code shipped to the consumer, not a secret key.
Context is application-supplied external data, not a FISE-managed secret. A
derived context segment is omitted from the envelope, but an attacker can test
context candidates using the public profile and 32-bit marker.

Runtime output is deterministic. The same profile, payload, and context produce
the same envelope, so observers can detect equality and repeated framed
plaintext. FISE provides no semantic security or nonce-based randomization.

## Attacker capabilities

A determined attacker controlling or instrumenting the client can:

- call `decrypt` with the application's profile and context;
- enumerate or infer low-entropy positional context values;
- hook the generated reverse kernel;
- break after restoration and read application state;
- inspect network, memory, workers, or WASM linear memory;
- modify FISE code or bypass it entirely;
- replay or tamper with envelopes.

FISE cannot prevent these actions. Client-visible plaintext is ultimately
observable where the application uses it.

## Properties not provided

FISE does not provide:

- confidentiality;
- authenticity or sender identity;
- payload integrity;
- authorization;
- expiry or replay protection;
- secret-key management;
- tamper-proof client execution;
- protection from XSS, malicious extensions, compromised devices, or runtime hooks.

The 32-bit marker detects many accidental profile/context mismatches but is not
an authentication tag and does not protect all payload bytes.

## Required companion controls

Use TLS for transport. Enforce authorization on trusted servers. If data must
remain confidential or tamper-evident outside that trust boundary, use a
reviewed authenticated-encryption construction and manage keys outside the
untrusted frontend. Apply CSP, dependency controls, schema validation, size
limits, and ordinary secure-development practices independently of FISE.

## Parser safety

The implementation fails closed on unknown versions, profiles, flags,
metadata types, lengths, ranges, frame indexes, context shapes, proxy/custom
prototype wrappers, and generated profile outputs. It snapshots mutable inputs
before asynchronous worker or progressive execution, validates advertised FISF
plaintext before allocation, and bounds context depth, context size, envelope
size, frame counts, worker count, and WASM memory. Closed parallel runtimes
reject every operation, including empty framed and range work.

These controls reduce parser and resource hazards. They do not elevate FISE to
a cryptographic security boundary.

# FISE 2.0 conformance corpus

This directory freezes the byte-level contract that every FISE 2.0 runtime
must implement. It is intended for maintainers adding another language or
backend, not as an application integration example.

`v2/profile.generated.mjs` is one CLI-generated JavaScript compatibility
fixture. `v2/vectors.json` records its fingerprint and exact canonical JSON,
UTF-8, binary64 numbers, deterministic LZ4 blocks, compression thresholds,
logical payloads, Base64URL, binary wire, context, edge coverage, TTL, range,
and progressive results. It also freezes malformed transport, header, wire,
payload, compression, Unicode, number, and context failures. The Profile is
public test material; applications must generate and own their own Profile.

An implementation conforms only when it can:

1. reproduce every accepted vector byte-for-byte;
2. reject every invalid vector with the stated error category;
3. restore the JavaScript-produced envelopes with the same Profile and context;
4. produce envelopes that the JavaScript runtime restores; and
5. preserve the public data types and half-open expiry behavior described in
   [`docs/SPEC.md`](../docs/SPEC.md).

Do not regenerate these files during install, build, or test. A deliberate
change to canonicalization, payload metadata, compression, context binding,
Profile semantics, or wire bytes requires an explicit protocol review and an
intentional corpus update.

All hexadecimal strings use lowercase byte pairs and all wire offsets are
zero-based. Invalid-envelope mutations are applied to a fresh copy of the named
accepted envelope: `replace` overwrites bytes at `offset`, `xor` changes one
byte, `truncate` keeps the declared prefix length, `truncate-tail` removes the
declared number of bytes, and `append` adds the supplied bytes. A mutation-free
case changes only the supplied context. Freshness cases use exact Unix
milliseconds and the source envelope's context.

## Current language status

The checked-in fixture is currently the JavaScript member and therefore freezes
the language-neutral wire baseline; it does not by itself claim that a Python
runtime exists or conforms. The first Python implementation must extend the CLI
to emit the JavaScript and Python Profile artifacts from the same transient
typed generation IR in one operation. Both artifacts must carry the same
fingerprint, pass their native verifier, and run these vectors in both
directions before a Python compatibility claim is made.

Do not generate the two language artifacts independently and do not add a seed,
stored IR, fingerprint registry, or regeneration history. The exact emitted
files are the compatibility pair. When the Python runtime lands, this corpus
must be deliberately extended with that paired fixture and JavaScript ↔ Python
producer/consumer evidence.

## Distribution

The corpus is included as test data in the npm tarball, but it is intentionally
not a public JavaScript runtime export. Package exports remain limited to the
application API and generated-profile runtime. Maintainers and language
implementers should read the corpus from a repository checkout or an extracted
npm tarball; application code must not depend on a `fise/conformance` import or
on a particular `node_modules` filesystem layout.

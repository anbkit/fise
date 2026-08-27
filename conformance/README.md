# FISE 2.0 conformance corpus

This directory freezes the byte-level contract that every FISE 2.0 runtime
must implement. It is intended for maintainers adding another language or
backend, not as an application integration example.

`v2/profile.generated.mjs` and `v2/profile_generated.py` are one
CLI-generated compatibility pair emitted from the same transient IR.
`v2/vectors.json` records their shared fingerprint and exact canonical JSON,
UTF-8, binary64 numbers, deterministic LZ4 blocks, compression thresholds,
logical payloads, Base64URL, binary wire, context, edge coverage, TTL, range,
and progressive results. It also freezes malformed transport, header, wire,
payload, compression, Unicode, number, and context failures. The Profile pair
is public test material; applications must generate and own their own Profile.

An implementation conforms only when it can:

1. reproduce every accepted vector byte-for-byte;
2. reject every invalid vector with the stated error category;
3. restore JavaScript- and Python-produced envelopes with the same Profile and
   context;
4. produce envelopes restored by both reference runtimes; and
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

JavaScript/TypeScript and Python 3.10+ are the current reference runtimes. Both
run this accepted and malformed corpus. The CLI's Python backend mode also
tests multiple independently generated pairs with text, compressed structured
data, deterministic binary64 samples, context, TTL, binary full/edge coverage,
range/progressive restoration, one shared fingerprint, and exact
JavaScript/Python wire output.

Do not generate the two language artifacts independently and do not add a seed,
stored IR, fingerprint registry, or regeneration history. The exact emitted
files are the compatibility pair. Additional languages must join the same
single-invocation emission and bidirectional verification model before a
compatibility claim is made.

## Distribution

The corpus pair is included as test data in the npm tarball, but it is
intentionally not a public JavaScript runtime export. Package exports remain
limited to the application API and generated-profile runtime. Maintainers and
language implementers should read the corpus from a repository checkout or an
extracted npm tarball; application code must not depend on a
`fise/conformance` import or on a particular `node_modules` filesystem layout.

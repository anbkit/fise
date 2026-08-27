# Contributing to FISE

FISE 2.0 is ESM-only, requires Node 20 or newer, and intentionally has no
compatibility layer for earlier APIs or wire versions.

## Setup

```sh
npm ci
npm test
npm run release:check
```

## Contract changes

Keep the public model small: one generated `Profile`, one profile-bound `Fise`
instance, one `encrypt`/`decrypt` pair for structured values and bytes, and
direct range/progressive methods for binary restoration. Default behavior is
strict; `{ strict: false }` is the only ordinary-operation raw fallback and
must remain an explicit instance-level availability decision. Optional
`ttlSeconds` is an instance-level producer policy; its wire expiry is enforced
before restoration and must not enter generated profile configuration. Optional
binary edge coverage is also an instance-level producer policy; its omitted
`edgeBytes` resolves to 1 MiB per side.

When changing the generator, Profile ABI, FISE wire format, codec, parser,
WASM backend, or worker backend:

- update the relevant normative document;
- add deterministic success and malformed-input tests;
- prove JavaScript, generated WASM, and worker interoperability;
- preserve absolute byte offsets across worker chunks;
- preserve full/edge coverage, range, progressive, and abort behavior;
- preserve `conformance/v2/vectors.json` byte-for-byte unless the change is an
  intentional protocol revision;
- keep parsers bounded and fail closed;
- do not add a legacy decoder or runtime profile builder.

The structured codec uses deterministic adaptive LZ4 before the Profile
transform. Keep its 256-byte consideration threshold, choose compressed form
only when its four-byte original-length field plus block is smaller, bound
decompression and its expansion ratio before allocation, and validate exact
UTF-8/JSON/canonical output.
Changes require malformed-block tests, deterministic vectors, transport-size
benchmarks, and JavaScript/WASM/worker interoperability evidence.

For accepted values, canonical structured output follows RFC 8785: exact
ECMAScript binary64 number text, raw UTF-16 property ordering, no Unicode
normalization, and rejection of unpaired surrogates. FISE additionally rejects
negative zero. Any other-language runtime must first pass the packaged
conformance corpus in both directions with JavaScript. Do not regenerate the
corpus Profile or vectors during ordinary test setup.

The Python backend extends one CLI generation operation to emit both requested
artifacts from the same transient typed IR. Never generate a JavaScript Profile
and then independently generate a Python or other-language Profile. Paired
files share one fingerprint and must be verified before publication; no seed,
stored IR, or fingerprint-to-recipe registry is introduced. Any additional
language must join this same-generation and bidirectional-verification model.

## Documentation ownership

Keep the explanation layered:

- `README.md` owns the small public mental model and first successful example;
- `docs/QUICK_START.md` owns task-oriented usage and realistic context setup;
- `docs/CLI.md` owns public commands, options, output, and exit behavior;
- `docs/AGENT_GUIDE.md` owns coding-agent integration and profile distribution;
- `docs/PROFILES.md` owns the generator and generated-module lifecycle;
- `docs/SPEC.md` owns normative wire and callback behavior;
- `docs/SECURITY.md` owns claims, non-claims, and attacker capabilities.

Describe a Profile first as a generated transformation recipe. Describe context
first as an optional ordered array of temporary application values known at both
ends. Only then introduce the callback ABI, Base64URL segment, lanes, offsets,
and markers. Never describe context as a secret key or put authorization logic
inside profile callbacks.

Generated profile files are source artifacts. Produce them with
`fise generate <output-file>` or the same-IR Python pair form, commit them to
Git, and never hand-edit their opaque pipeline. Generation verifies
forward/reverse text, structured, binary full/edge coverage, range/progressive,
JavaScript, WASM, and worker interoperability before writing; Python mode also
verifies native and exact cross-language wire behavior. Existing paths fail
closed; new paths use atomic no-clobber publication, and `--override` is only
for intentional atomic profile replacement. `fise verify <profile-file>
[python-profile]` repeats the relevant checks without changing files.

Runnable examples are packed public-API checks. They must import published
entry points, assert their result, and be listed in `examples/run-all.mjs`.

Install the pinned Chromium once, then run the automated packed-browser gate:

```sh
npx playwright install chromium
npm run verify:browser
```

To keep the same packed smoke page open for manual inspection, run:

```sh
npm run verify:browser:serve
```

The automated gate launches the printed loopback URL and requires `PASS` with
no console warnings, page errors, or failed requests. It tests both native ESM
and a Vite production build from the installed tarball, including the emitted
module worker and backend-produced JSON/binary HTTP responses, under a
restrictive CSP. A Node-only result is not browser evidence.

Performance claims must identify the command, runtime, payload, iteration
policy, measurement boundary, and limitations. Security language must remain
precise: FISE changes an exposed representation and raises interpretation
effort; it is not cryptographic confidentiality, authenticity, or integrity.
See [docs/SECURITY.md](docs/SECURITY.md).

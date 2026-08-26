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
explicit framed methods for selective binary restoration.

When changing the generator, profile ABI, FISE/FISF wire format, codec, parser,
WASM backend, or worker backend:

- update the relevant normative document;
- add deterministic success and malformed-input tests;
- prove JavaScript, generated WASM, and worker interoperability;
- preserve absolute byte offsets across worker chunks;
- preserve full, range, progressive, and abort behavior for FISF;
- keep parsers bounded and fail closed;
- do not add a legacy decoder or runtime profile builder.

## Documentation ownership

Keep the explanation layered:

- `README.md` owns the small public mental model and first successful example;
- `docs/QUICK_START.md` owns task-oriented usage and realistic context setup;
- `docs/PROFILES.md` owns the generator and generated-module lifecycle;
- `docs/SPEC.md` owns normative wire and callback behavior;
- `docs/SECURITY.md` owns claims, non-claims, and attacker capabilities.

Describe a Profile first as a generated transformation recipe. Describe context
first as an optional ordered array of temporary application values known at both
ends. Only then introduce the callback ABI, Base64URL segment, lanes, offsets,
and markers. Never describe context as a secret key or put authorization logic
inside profile callbacks.

Generated profile files are source artifacts. Produce them with
`fise generate <output-file>`, commit them to Git, and never hand-edit their
opaque pipeline. A new generator invocation intentionally creates a different
profile and overwrites only the requested output file.

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
no console warnings, page errors, or failed requests. Both commands test the
installed tarball under a restrictive CSP; a Node-only result is not browser
evidence.

Performance claims must identify the command, runtime, payload, iteration
policy, measurement boundary, and limitations. Security language must remain
precise: FISE changes an exposed representation and raises interpretation
effort; it is not cryptographic confidentiality, authenticity, or integrity.
See [docs/SECURITY.md](docs/SECURITY.md).

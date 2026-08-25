# Contributing to FISE

Contributions, bug reports, profile ideas, conformance results, and measured
performance evidence are welcome.

## Setup

```sh
npm ci
npm run build
npm test
```

FISE 1.1 requires Node 20 or newer and is ESM-only.

## Before submitting

```sh
npm run release:check
npm run verify:browser:serve
```

The browser command prints a loopback URL backed by an installed tarball. Open
it in each claimed browser and require a PASS result with no console errors.

When changing a profile, manifest, transform, header, or parser:

- update the normative specification and migration notes;
- add deterministic string/binary or manifest vectors;
- test malformed input and resource bounds;
- verify all compatible JavaScript/WASM backends;
- use a new profile or wire identity when decode behavior changes; and
- do not add legacy fallback to the 1.1 decoder.

When making browser or performance claims, record the exact runtime, platform,
revision, method, and limitations. Source inspection or a Node test is not
browser evidence, and a local microbenchmark is not a universal result.

## Security language

The built-in XOR profiles are reversible encoding/obfuscation. Do not describe
them as cryptographic confidentiality, authenticated integrity, DRM, or a
trusted WASM boundary. Keep operational `encrypt`/`decrypt` terminology tied to
the explicit boundary in [docs/SECURITY.md](./docs/SECURITY.md).

## Pull requests

Keep changes focused, explain compatibility impact, list verification commands,
and call out any proposed behavior that is not yet implemented or verified.

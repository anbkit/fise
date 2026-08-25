# FISE 1.1 Platform Support

## Required capabilities

Core string and binary profiles require:

- ECMAScript modules;
- `Uint8Array`, `ArrayBuffer`, and `DataView`;
- `TextEncoder` and fatal `TextDecoder` for HTTP text/JSON helpers;
- `globalThis.crypto.getRandomValues`;
- `crypto.subtle.digest` for profile-manifest compilation; and
- `Buffer` or browser `btoa`/`atob` for the string default transform.

HTTP helpers additionally require standards-based `Response` and `Headers`;
bounded reads require `Response.body.getReader()`.
The optional backend requires WebAssembly compilation, instantiation, and
memory.

## Declared package support

The npm package is ESM-only and declares Node `>=20`. CI is configured for Node
20 and Node 22. A release should not be called verified until tests and package
self-import checks have run on both jobs for that exact revision.

Python is not a package runtime dependency. Python 3.12 is used only by the
independent compiled-binary reference gate in CI.

Browser APIs vary by product version, CSP, embedded webview, and device.
Feature presence alone is not a browser-support claim.

Revision-specific Node, browser, interoperability, benchmark, and package
results live in [RELEASE_EVIDENCE.md](./RELEASE_EVIDENCE.md). Keeping mutable
test counts out of this support contract prevents a later working tree from
silently inheriting stale evidence.

## Browser smoke harness

`tests/browser/wasm-smoke.html` and its external module import the packed ESM
output in a real page under a restrictive CSP and check:

- string 1.1 header and round trip;
- binary 1.1 header and JavaScript round trip;
- WASM compilation and a 256 KiB round trip;
- configured WASM page-cap behavior and registered backend binding;
- JS/WASM transform parity and cross-backend envelope decoding;
- deeply frozen profile-manifest SHA-256 compilation plus bounded JSON/HTTP
  `Response` round trip; and
- browser console errors.

Run `npm run verify:browser:serve`, open the printed URL, and record the browser
product/version, PASS state, console, requests, and response CSP. A source
review or Node test is not browser evidence. The repository CSP is a repeatable
baseline, not proof that a deployment's different CSP will allow compilation.

## CSP

WASM bytes are embedded, so there is no `.wasm` fetch or MIME dependency.
Compilation may still be blocked by CSP or runtime policy. Test the deployed
header. `isWasmXorBinaryCipherSupported()` checks APIs, not policy approval.

## Package verification

```sh
npm run release:check
```

The package gate checks local documentation links; root, `fise/conformance`,
`fise/profiles`, and `fise/http` self-imports; expected artifacts; CLI metadata;
public consumer type compilation; executable bin mode; ESM-only exports;
absence of removed public 0.x symbols; and tarball installation plus JS/WASM
round trips in an empty consumer.

## Promoting a target to supported

Record repeatable evidence for:

1. exact conformance vectors;
2. property and malformed-input tests;
3. configured resource bounds and large input;
4. WASM compilation, memory growth, and JS/WASM parity when advertised;
5. HTTP media parsing when used;
6. production CSP and bundler output;
7. runtime/browser/device versions; and
8. package contents from the release artifact, not only the source tree.

Until that evidence exists, describe the target as compatible by required API
surface, not verified.

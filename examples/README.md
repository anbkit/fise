# FISE Runnable Examples

These dependency-free Node 20+ examples exercise the published FISE public API.
They are executable documentation: every file asserts its result and exits
non-zero when its contract is not satisfied.

FISE keeps `encrypt` and `decrypt` as operational API verbs. The built-in XOR
profiles provide reversible representation and obfuscation, not cryptographic
confidentiality, authenticity, integrity, expiry, or replay prevention.

| Example | Contract demonstrated |
| --- | --- |
| `basic-string.mjs` | String round trip and typed fail-closed error |
| `binary-payload.mjs` | Byte round trip and caller envelope bound |
| `parallel-binary.mjs` | Dedicated workers with unchanged ordinary 1.1 wire |
| `framed-binary.mjs` | Full, range, and progressive byte restoration |
| `json-http.mjs` | JSON `Response`, strict media contract, and application schema check |
| `time-window.mjs` | One request anchor and coordinated public timestamp context |
| `wasm-backend.mjs` | Explicit backend policy and JS/WASM wire interoperability |
| `profile-rotation.mjs` | Canonical manifests, vectors, and no-fallback atomic rotation |

From a repository checkout:

```sh
npm run verify:examples
```

To run one example after building the package:

```sh
npm run build
node examples/time-window.mjs
```

The release gate also executes these files from the generated npm tarball, so
they cannot silently depend on private source imports or checkout-only files.

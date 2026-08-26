# FISE 2.0 examples

The committed `fise.profile.mjs` is one generated, immutable `Profile`
instance. It is ordinary source code tracked by Git; the generator stores no
seed, manifest, revision, or profile history.

Every runnable example uses a positional scalar context shaped from realistic,
short-lived application state such as a session binding, user, tenant,
connection, resource version, and response sequence. The same values and order
are required for restore; context is established separately and is not stored
in the envelope or treated as a secret key.

| Example | Demonstrates |
| --- | --- |
| `basic.mjs` | One `encrypt/decrypt` API for strings, structured values, and bytes |
| `api-session.mjs` | API transport bound to temporary client/server session state |
| `binary-file.mjs` | File-like binary bytes with session, user, tenant, and asset context |
| `framed.mjs` | Context-bound full, selective-range, and pull-driven binary restore |
| `backends.mjs` | Context-preserving JavaScript, WASM, worker, and framed parity |
| `failure-boundaries.mjs` | Wrong sequence/order, invalid context, and unsupported wire rejection |

From a repository checkout:

```sh
npm run verify:examples
```

To run one example after building the package:

```sh
npm run build
node examples/basic.mjs
```

Generate a replacement profile at any time:

```sh
npx fise generate ./examples/fise.profile.mjs
```

Each invocation intentionally creates different executable profile code. Git
is the only history mechanism.

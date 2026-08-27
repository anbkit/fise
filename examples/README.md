# FISE 2.0 examples

The committed `fise.profile.mjs` and `fise_profile.py` are one generated,
immutable JavaScript/Python `Profile` pair. They are ordinary source code
tracked by Git; the generator stores no seed, manifest, revision, or profile
history.

Every runnable example uses a positional scalar context shaped from realistic,
short-lived application state such as a client-visible session ID, user, tenant,
connection, resource version, and response sequence. The same values and order
are required for restore; context is established separately and is not stored
in the envelope or treated as a secret key. A session value in these examples
is not an authentication token, protected cookie, or HttpOnly credential.

| Example | Demonstrates |
| --- | --- |
| `basic.mjs` | One `encrypt/decrypt` API for strings, structured values, and bytes |
| `api-session.mjs` | API transport bound to temporary client/server session state |
| `web-application.mjs` | Actual HTTP JSON and binary responses, synchronized context, schema validation, and Blob creation |
| `agent-stream.mjs` | Actual SSE agent events, per-event envelopes, ordered context, and incremental client restore |
| `python-agent-backend.py` + `python-agent-interop.mjs` | Python agent backend output restored by the paired JavaScript frontend Profile |
| `binary-file.mjs` | File-like binary bytes with session, user, tenant, and asset context |
| `binary-restoration.mjs` | Full/edge coverage, selective-range, and pull-driven binary restore |
| `backends.mjs` | Context-preserving JavaScript, WASM, worker, and coverage parity |
| `failure-boundaries.mjs` | Wrong sequence/order, invalid context, and unsupported wire rejection |
| `raw-fallback.mjs` | Explicit raw pass-through and its strict default boundary |
| `ttl.mjs` | Constructor-level envelope lifetime with no decrypt-time timestamp input |

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
npx fise generate ./examples/fise.profile.mjs --backend python --override
```

The candidate must restore every encrypted input and reproduce each
deterministic envelope after restoration before the existing file is atomically
replaced as a pair. Each successful invocation intentionally creates different
executable profile code. Git is the only history mechanism.

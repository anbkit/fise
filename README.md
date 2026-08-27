# FISE — Fast Interoperable Structured Envelope

![npm version](https://img.shields.io/npm/v/fise.svg)
![license](https://img.shields.io/github/license/anbkit/fise.svg)
![Tests](https://github.com/anbkit/fise/actions/workflows/test.yml/badge.svg)

**Generate one Profile. Share it. Encrypt and decrypt.**

FISE helps frontends and JavaScript or Python backends exchange data without
sending directly readable JSON or text, and by default transforms complete file
contents. Each Profile candidate independently randomizes its transformation
pipeline. The same Profile can handle structured data, text, and binary data
such as images, files, or videos.

FISE returns a JSON-safe string for text and structured data, and binary output
for binary input. Repetitive structured data is compressed automatically when
that makes its internal payload smaller. Large binary data can be restored by
range, one chunk at a time, or processed through WASM and workers. An optional
edge mode transforms only the beginning and end of a binary value when lower
transform cost matters more than covering its middle bytes. Envelopes can also
carry a runtime TTL.

Because a frontend must eventually restore client-visible data, FISE does not
make that data secret. `encrypt` and `decrypt` are API terms: FISE is not a
replacement for TLS, server-side authorization, cryptographic encryption, or
integrity protection.

[Read the engineering whitepaper](./docs/WHITEPAPER.md) for the design,
boundaries, and evaluation method.

## Implement in five steps

### 1. Install FISE

```sh
npm install fise
```

`npx` uses the project-local CLI, so no global installation is needed. FISE is
ESM-only and requires Node.js 20+ or a modern browser.

For a Python backend, also install the dependency-free Python 3.10+ runtime:

```sh
python -m pip install fise
```

### 2. Generate one Profile

```sh
npx fise generate ./src/fise.profile.ts
```

A **Profile** is generated source code that tells FISE how to transform and
restore data. Every generation samples a fresh independently randomized
candidate and verifies it before writing. Commit the generated file to Git; do
not edit it by hand.

If the backend is Python, choose it in the same generation command:

```sh
npx fise generate ./src/fise.profile.ts --backend python
```

This emits `fise.profile.ts` for the frontend and `fise_profile.py` for the
backend from one candidate. The two files carry the same fingerprint and are
verified for exact cross-language wire compatibility before either is written.

See the [CLI reference](./docs/CLI.md) for `verify`, `--override`, CI use, and
the complete command contract.

### 3. Share the exact Profile

> **Frontend and backend must use the exact generated Profile artifact or
> JavaScript/Python pair from one command.** Do not generate either side
> independently.

```text
┌─────────────┐       ┌────────────────┐       ┌─────────────┐
│ Backend     │──────▶│ One Profile    │◀──────│ Frontend    │
└──────┬──────┘       └────────────────┘       └──────▲──────┘
       └────────────── FISE data ─────────────────────┘
```

In a JavaScript monorepo, keep the Profile in a shared package. For a Python
backend, keep the generated `.ts`/`.py` pair under one owner and distribute each
language artifact without regenerating it. Run `fise verify` on every copy and
confirm the fingerprint matches.

**Context** is an optional ordered list of values already known by both sides,
for example a session ID and user ID:

```js
const context = [sessionId, userId, "orders", "v1"];
```

Context makes the result depend on those values. Decrypt with the same values
in the same order. FISE does not store them in the envelope, but they are not a
secret key or an authorization check. `sessionId` here must be a client-visible,
non-credential identifier—not an authentication token or protected cookie. If
context is not useful for your flow, omit the second argument on both sides.

### 4. Encrypt on the backend

```js
import { Fise } from "fise";
import profile from "./fise.profile.js";

const fise = new Fise(profile);
const context = [sessionId, userId, "orders", "v1"];

const encryptedData = fise.encrypt(order, context);
```

The Python backend API is the same small profile-bound model:

```python
from fise import Fise
from fise_profile import profile

fise = Fise(profile)
context = [session_id, user_id, "orders", "v1"]

encrypted_data = fise.encrypt(order, context)
```

For text or structured data, `encryptedData` is a JSON-safe Base64URL string
that can be placed directly in the application's existing API response.

### 5. Decrypt on the frontend

```js
import { Fise } from "fise";
import profile from "./fise.profile.js";

const fise = new Fise(profile);
const context = [sessionId, userId, "orders", "v1"];

const order = fise.decrypt(encryptedData, context);
```

The restored value has the original text, structured, or binary type. The same
Profile can also be used in the opposite direction. Validate restored
structured data with the application's normal response schema before using it.

See the runnable [HTTP web-application example](./examples/web-application.mjs),
the [Python agent-backend interoperability example](./examples/python-agent-interop.mjs),
the [web integration guide](./docs/WEB_APPLICATIONS.md), and the
[examples guide](./examples/README.md).

## Binary data

Binary input returns binary FISE data:

```js
const encryptedFile = fise.encrypt(fileBytes, context);
const restoredFile = fise.decrypt(encryptedFile, context);
```

Restore only a requested byte range without restoring the whole file:

```js
const range = fise.decryptRange(
  encryptedFile,
  { start: 1_000, endExclusive: 2_000 },
  context
);
```

Or restore chunks as the application asks for them:

```js
for await (const chunk of fise.decryptProgressive(encryptedFile, context, {
  chunkSize: 256 * 1024
})) {
  consume(chunk);
}
```

Full transformation is the default. For large videos or files, edge mode can
reduce transform work by processing only the first and last resolved bytes:

```js
const mediaFise = new Fise(profile, {
  binary: { mode: "edges" }
});

const encryptedVideo = mediaFise.encrypt(videoBytes, context);
```

Edge mode uses 1 MiB per side by default. Advanced users can set `edgeBytes` in
the same constructor option. `decrypt`, range, and progressive restoration read
the resolved policy from the envelope; consumers do not repeat it. The middle
bytes remain untransformed and can be inspected, so edge mode is an explicit
performance trade-off—not the same coverage as the default full mode. It still
returns one complete in-memory envelope.

See [binary data](./docs/BINARY_DATA.md) for coverage choices and large-file
limits.

## Optional TTL

Set the lifetime once on the encrypting instance:

```js
const fise = new Fise(profile, { ttlSeconds: 30 });
const encryptedData = fise.encrypt(data, context);
```

Python uses `Fise(profile, ttl_seconds=30)` for the same wire behavior.

The consumer calls `decrypt` normally. At the expiry second, FISE throws
`ENVELOPE_EXPIRED`. This is a normal-runtime freshness rule, not cryptographic
expiration or replay prevention; a controlled client can patch the check or
its clock. Browser-facing flows must also allow for network delay and clock
skew between producer and consumer; avoid very short TTLs when correctness
depends on separate device clocks.

## Optional raw fallback

FISE throws on failure by default. An application that prioritizes availability
can explicitly return the original input when ordinary `encrypt` or `decrypt`
fails:

```js
const fise = new Fise(profile, { strict: false });

const encryptedOrRaw = fise.encrypt(data, context);
const restoredOrRaw = fise.decrypt(received, context);
```

Python uses `Fise(profile, strict=False)` for the equivalent opt-in behavior.

Expiration and clock failures always throw. Range and progressive methods also
remain strict. A failed encryption can expose the original data, so the
application must support and monitor both outcomes. See the
[security boundary](./docs/SECURITY.md) before enabling fallback.

## Documentation

- **Get started:** [Quick start](./docs/QUICK_START.md),
  [web application integration](./docs/WEB_APPLICATIONS.md),
  [runnable examples](./examples/README.md), and
  [CLI reference](./docs/CLI.md).
- **Understand FISE:** [Profiles and context](./docs/PROFILES.md),
  [binary data](./docs/BINARY_DATA.md), and
  [WASM and workers](./docs/WASM.md).
- **Reference:** [FISE 2.0 specification](./docs/SPEC.md),
  [security boundary](./docs/SECURITY.md),
  [engineering whitepaper](./docs/WHITEPAPER.md), and
  [roadmap](./docs/ROADMAP.md).
- **Contribute or automate:** [contributing guide](./CONTRIBUTING.md) and
  [agent integration guide](./docs/AGENT_GUIDE.md).

FISE is available under the [MIT License](./LICENSE).

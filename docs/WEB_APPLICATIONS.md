# Using FISE in a web application

FISE fits a web application when the backend and frontend can import the same
generated Profile semantics and reconstruct the same optional context values.
JavaScript systems share one artifact; Python backends use the paired artifact
emitted beside the frontend Profile. The backend usually encrypts an API value;
the frontend decrypts it before schema validation and use.

```text
Backend                  Generated Profile                  Frontend
new Fise(profile)  <--- exact file or same-IR pair --->  new Fise(profile)

data -> encrypt()  -------- JSON or binary response ------> decrypt() -> validate -> app
             same ordered, client-visible context values
```

The Profile is shipped to the frontend and is not a secret. Context is not an
authorization credential. Keep TLS, authentication, authorization, and input
validation in their normal application layers.

## 1. Install and generate

```sh
npm install fise
npx fise generate ./src/fise.profile.ts
```

Generate once for one compatibility domain. In a JavaScript monorepo, place the
Profile in a shared package. With separate backend and frontend repositories,
choose one owner and distribute the exact generated file or same-IR language
pair. Verify each artifact and compare the printed fingerprint:

```sh
npx fise verify ./src/fise.profile.ts
```

Do not generate one Profile independently on each side.

For a Python backend, install the Python 3.10+ runtime and generate both language
artifacts together:

```sh
python -m pip install fise
npx fise generate ./src/fise.profile.ts --backend python
npx fise verify ./src/fise.profile.ts ./src/fise_profile.py
```

The CLI emits both from one transient IR; there is still no saved seed or recipe
from which a separately generated backend artifact could be recreated.

## 2. Create one instance

```js
import { Fise } from "fise";
import profile from "./fise.profile.js";

const fise = new Fise(profile);
```

Python uses its paired generated instance:

```python
from fise import Fise
from fise_profile import profile

fise = Fise(profile)
```

The same instance handles text, JSON-safe structured data, and binary data.
Structured input is compressed automatically only when doing so makes its
internal payload smaller.

## 3. Agree on context

Context is an optional ordered list of scalar values already available to both
sides:

```js
const context = [sessionId, userId, "orders", "v1", responseSequence];
```

Here `sessionId` must mean a temporary, client-visible, non-credential ID. Never
expose an authentication token, protected cookie, or HttpOnly session value just
to use it as FISE context. Resource names and versions are ordinary strings;
`responseSequence` can be returned beside the encrypted value.

Order is part of the contract. Both sides must use the same value at every
position. If a flow has no useful shared values, omit context on both sides:

```js
const encrypted = fise.encrypt(data);
const restored = fise.decrypt(encrypted);
```

## 4. Exchange structured data

On the backend:

```js
const context = [sessionId, userId, "orders", "v1", responseSequence];
const responseBody = {
  data: fise.encrypt(order, context),
  sequence: responseSequence
};
```

The equivalent Python backend operation is direct:

```python
context = [session_id, user_id, "orders", "v1", response_sequence]
response_body = {
    "data": fise.encrypt(order, context),
    "sequence": response_sequence,
}
```

For text and structured input, `data` is an unpadded Base64URL string and can
be serialized as a normal JSON field.

On the frontend:

```js
const context = [sessionId, userId, "orders", "v1", responseBody.sequence];
const order = fise.decrypt(responseBody.data, context);
```

`decrypt()` validates the FISE envelope, not the business meaning of `order`.
Run the restored value through the same application schema validation you would
use for an ordinary API response before placing it in state or rendering it.

FISE compresses structured input before its Profile transform when the result
is smaller. This preserves much more repetition than transforming raw JSON, but
it does not guarantee a smaller HTTP response. Measure representative payloads
with the compression and caching settings used in production.

## 5. Stream agent events

`decryptProgressive()` restores chunks from a complete binary envelope already
in memory; it is not a network-stream parser. For an agent response sent through
SSE, NDJSON, or WebSocket, encrypt each logical event as an independent ordinary
envelope:

```js
const context = [sessionId, userId, "agent-stream", "v1", streamId, sequence];
const frame = { sequence, data: fise.encrypt(agentEvent, context) };
```

After the transport parses one frame, the client restores its event immediately:

```js
const context = [sessionId, userId, "agent-stream", "v1", streamId, frame.sequence];
const agentEvent = fise.decrypt(frame.data, context);
```

Use a sequence in context, validate every restored event, and send explicit
completion and error events. Batch very small token deltas into logical events
when per-envelope overhead matters. Keep streaming strict: raw fallback can
change a frame from a FISE string into an application value. Sequence binding
does not provide cryptographic stream integrity, anti-replay, or proof that a
truncated stream was complete.

Run [`examples/agent-stream.mjs`](../examples/agent-stream.mjs) for an actual
loopback SSE stream containing text deltas, a tool call, a tool result, and a
completion event. The paired
[`examples/python-agent-interop.mjs`](../examples/python-agent-interop.mjs)
proves a Python-produced agent event restores with the frontend Profile.

## 6. Exchange binary data

Binary input returns binary FISE data. Send it as an ordinary binary response,
not through `JSON.stringify`:

```js
const context = [sessionId, userId, "receipts", "v1", responseSequence];
const encryptedReceipt = fise.encrypt(receiptBytes, context);
```

The frontend restores the response bytes with the same context:

```js
const encryptedReceipt = new Uint8Array(await response.arrayBuffer());
const receiptBytes = fise.decrypt(encryptedReceipt, context);
const receipt = new Blob([receiptBytes], { type: "application/pdf" });
```

Keep media type, filename, sequence, and other application metadata in normal
headers or JSON metadata. FISE does not infer them.

## Profile rollout

A generated Profile is a compatibility artifact. Keep it stable while deployed
producers and consumers must interoperate. When replacing it:

1. generate and verify the replacement once;
2. ship matching backend and frontend code through one coordinated release;
3. for rolling deployments, use an application-owned versioned endpoint or
   versioned frontend asset so old clients continue to reach the old producer;
4. remove the old route only after old clients and caches have drained.

FISE 2.0 does not search Profile history or decode legacy Profiles. Do not
regenerate during install, build, startup, or test setup.

## TTL and browser clocks

`new Fise(profile, { ttlSeconds })` writes one absolute expiry into envelopes
created by that instance. The receiving browser enforces it using its own
clock. Network delay and device clock skew therefore matter. Use a lifetime
wide enough for the real request path, or omit TTL when cross-device freshness
would harm correctness. TTL is not replay prevention or authorization.

## WASM, workers, bundlers, and CSP

The default JavaScript path needs no WASM-specific Content Security Policy.
`withWasm()` and `parallel()` require the deployed policy to allow WebAssembly
compilation, commonly with `script-src 'wasm-unsafe-eval'`. Browser workers also
need a compatible `worker-src`, commonly `worker-src 'self'` when the emitted
worker asset is same-origin.

FISE uses a standard module-worker URL. The release gate production-builds the
packed package with Vite, runs its emitted worker in Chromium, and restores
backend-produced JSON and binary HTTP responses in that bundled frontend. Other
bundlers still need application-level verification. A low-level integration
that does not process worker URLs must bundle and emit
`dist/v2/workers/profileWorker.js` at the relative URL expected by the
application bundle when `parallel()` is used. Test the final production bundle
and CSP; API availability alone is not proof that deployment policy allows
either backend.

## Large files

Full and edge coverage both receive and return one complete in-memory envelope.
Range restoration avoids allocating the complete plaintext, and progressive
restoration returns one plaintext chunk at a time, but neither API fetches an
HTTP range or incrementally parses network input. For very large objects, use
an application-owned segmented storage/transport design and measure browser
memory and responsiveness on target devices.

Run [`examples/web-application.mjs`](../examples/web-application.mjs) for an
actual loopback HTTP JSON and binary flow, and
[`examples/agent-stream.mjs`](../examples/agent-stream.mjs) for agent event
streaming, and
[`examples/python-agent-interop.mjs`](../examples/python-agent-interop.mjs) for
Python-to-JavaScript agent output. See [binary data](./BINARY_DATA.md), [Profiles](./PROFILES.md),
[WASM and workers](./WASM.md), and the [security boundary](./SECURITY.md) for
the detailed contracts.

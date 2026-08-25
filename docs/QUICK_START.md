# FISE 1.1 Quick Start

## Upgrade boundary

FISE 1.1 is a clean wire and API break. It does not decode 0.x envelopes. Plan
an atomic producer/consumer cutover and invalidate or regenerate earlier
stored, queued, and cached values.

## Install

```sh
npm install fise
```

The package is ESM-only and requires Node 20 or equivalent browser APIs.

## Strings

```ts
import {
  defaultStringProfile,
  FiseError,
  fiseDecrypt,
  fiseEncrypt,
  resolveFiseTimeWindow
} from "fise";

const window = resolveFiseTimeWindow(Date.now(), { durationMs: 60_000 });
const context = { timestamp: window.timestamp };
const envelope = fiseEncrypt("Hello FISE", defaultStringProfile, context);

try {
  const plaintext = fiseDecrypt(envelope, defaultStringProfile, {
    ...context,
    maxEnvelopeLength: 1_000_000
  });
  console.log(plaintext);
} catch (error) {
  if (error instanceof FiseError) console.error(error.code);
  else throw error;
}
```

The helper maps an explicit Unix-millisecond instant into one half-open window
`[startMs, endExclusiveMs)`. It does not read the clock itself. Resolve once
from an operation-level request or session anchor and coordinate the returned
`timestamp` exactly; two independent clocks can select different windows at a
boundary. FISE does not serialize context, try adjacent windows, establish
expiry, or prevent replay.

The default profiles use only `timestamp % 11` when choosing the marker
position. Their layout state therefore repeats every 11 window IDs; a time
window is external context, not an envelope validity period.

## Binary and JSON

Prefer the binary path for API payloads:

```ts
import { defaultBinaryProfile } from "fise";
import { fiseJsonDecrypt, fiseJsonEncrypt } from "fise/http";

const envelope = fiseJsonEncrypt(
  { id: 42, title: "Example" },
  defaultBinaryProfile
);

const value = fiseJsonDecrypt(envelope, defaultBinaryProfile, {
  maxEnvelopeLength: 2_000_000
});
```

`fiseJsonDecrypt` checks FISE framing, UTF-8, and JSON syntax. Validate the
result against the application's own schema afterward.

## HTTP response

Producer:

```ts
import { createFiseJsonResponse } from "fise/http";

return createFiseJsonResponse(data, defaultBinaryProfile, {}, {
  status: 200,
  headers: { "cache-control": "private, no-store" }
});
```

Consumer:

```ts
import { readFiseJsonResponse } from "fise/http";

const data = await readFiseJsonResponse(response, defaultBinaryProfile, {
  maxEnvelopeLength: 2_000_000
});
```

The reader requires the exact FISE media type, version parameter, and profile
parameter. With a configured maximum it counts decoded response chunks and
requests cancellation as soon as the limit is crossed. Identity
`Content-Length` is checked before and after reading. For gzip/br responses,
Fetch can retain compressed length metadata while exposing decoded bytes, so the
decoded envelope limit remains authoritative.

## Enable WASM

```ts
import {
  createWasmXorBinaryCipher,
  defaultBinaryProfile,
  isWasmXorBinaryCipherSupported,
  withBinaryBackend
} from "fise";

if (!isWasmXorBinaryCipherSupported()) {
  throw new Error("This deployment requires WebAssembly");
}

const backend = await createWasmXorBinaryCipher({ maxMemoryPages: 1024 });
const profile = withBinaryBackend(defaultBinaryProfile, backend);
```

Create and reuse one profile/backend per application or worker. Initialization
failure is explicit; choose and monitor any fallback in application code. One
page is 64 KiB; the default 1,024-page cap limits retained WASM linear memory to
64 MiB per instance, while total process memory remains higher because of input,
output, and envelope copies.

## Parallel and framed bytes

Use the async API with an explicit retained worker backend when measurements
justify off-main-thread byte transforms:

```ts
import {
  createParallelXorBinaryCipher,
  defaultBinaryProfile,
  fiseBinaryDecryptAsync,
  fiseBinaryEncryptAsync
} from "fise";

const workers = await createParallelXorBinaryCipher({ workerCount: 4 });
try {
  const envelope = await fiseBinaryEncryptAsync(bytes, defaultBinaryProfile, {
    backend: workers
  });
  const restored = await fiseBinaryDecryptAsync(envelope, defaultBinaryProfile, {
    backend: workers
  });
} finally {
  await workers.close();
}
```

This produces an ordinary byte-compatible 1.1 envelope. Browser CSP must allow
the same-origin module worker.

When range or progressive byte restoration matters, opt into the indexed
`FISF` container:

```ts
import {
  fiseFramedBinaryDecryptProgressive,
  fiseFramedBinaryDecryptRange,
  fiseFramedBinaryEncrypt
} from "fise";

const framed = await fiseFramedBinaryEncrypt(bytes, defaultBinaryProfile, {
  frameSize: 256 * 1024
});
const range = await fiseFramedBinaryDecryptRange(
  framed,
  defaultBinaryProfile,
  { start: 500_000, endExclusive: 750_000 }
);
for await (const frame of fiseFramedBinaryDecryptProgressive(
  framed,
  defaultBinaryProfile
)) {
  consumeBytes(frame);
}
```

The progressive API receives a complete in-memory container and yields bytes,
not lazy JSON values. See [Framed Binary](./FRAMED_BINARY.md) for exact index,
bounds, selective-validation, and backpressure semantics.

## Compile a profile

Create `profile.json`:

```json
{
  "schema": "fise.profile/1",
  "name": "com.example.catalog",
  "revision": 1,
  "representation": "binary",
  "transform": "xor-u8-v1",
  "saltRange": { "min": 16, "max": 32 },
  "marker": { "kind": "uint-be", "width": 2 },
  "offset": {
    "kind": "affine",
    "lengthMultiplier": 7,
    "saltMultiplier": 3
  },
  "limits": { "maxEnvelopeLength": 2000000 }
}
```

Then validate and generate rollout evidence:

```sh
fise profile validate profile.json
fise profile build profile.json > profile.artifact.json
fise profile vectors profile.json > profile.vector.json
```

The `>` examples are ordinary shell redirection; the CLI itself writes JSON to
standard output.

## Deployment checklist

- Confirm producer and consumer use the exact same profile ID/artifact.
- Bound request/response size at transport and FISE layers.
- Preserve TLS, authentication, authorization, quotas, and abuse detection.
- Validate restored application data before use.
- Treat profile/context errors as compatibility signals, not proof of attack.
- Run conformance and real-browser tests for the release build.
- Do not retain a hidden 0.x decoder or silent profile fallback.

Continue with [Profiles](./PROFILES.md),
[Profile manifests](./PROFILE_MANIFEST.md), and
[Security](./SECURITY.md), or run the dependency-free
[examples](../examples/README.md).

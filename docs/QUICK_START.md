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
  fiseEncrypt
} from "fise";

const timestamp = Math.floor(Date.now() / 60_000);
const envelope = fiseEncrypt("Hello FISE", defaultStringProfile, { timestamp });

try {
  const plaintext = fiseDecrypt(envelope, defaultStringProfile, {
    timestamp,
    maxEnvelopeLength: 1_000_000
  });
  console.log(plaintext);
} catch (error) {
  if (error instanceof FiseError) console.error(error.code);
  else throw error;
}
```

The same timestamp is required because the default marker position uses it.
FISE does not serialize context or try adjacent time buckets.

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
[Security](./SECURITY.md).

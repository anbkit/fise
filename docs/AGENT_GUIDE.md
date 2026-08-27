# Agent integration guide

This guide is for coding agents that integrate FISE into an application. Its
goal is to create one valid compatibility artifact, place it under clear
ownership, and prevent frontend/backend profile drift.

## Mental model

- The generated `Profile` is executable transformation code.
- Every side that encrypts or decrypts a FISE envelope must use the exact same
  generated Profile semantics: one shared file for JavaScript-only systems, or
  the paired JavaScript/Python artifacts emitted by one generation command.
- Context is a positional application contract. Both sides must agree on the
  meaning and order of its positions and provide matching values for each
  operation.
- Context values must already be client-visible and non-credential. Never
  expose an auth token, protected cookie, or HttpOnly session value for FISE.
- The profile and context do not provide cryptographic secrecy or authorization.

```text
data     + exact Profile + matching context -> envelope
envelope + exact Profile + matching context -> original data
```

## Before generating

1. Locate every producer and consumer that will exchange FISE envelopes.
2. Determine whether they live in one monorepo or separate repositories.
3. Identify the canonical profile owner and the shared context contract.
4. If ownership, destination, or distribution is unclear, ask the user before
   creating copies or changing imports.

Do not generate a frontend profile and a backend profile independently. Every
generation is intentionally different. For a Python backend, one invocation
must emit both language artifacts from the same transient IR.

## Generate and verify once

Generate in the canonical owner:

```sh
npx fise generate ./src/fise.profile.ts
npx fise verify ./src/fise.profile.ts
```

For a Python backend, choose the backend language in that same operation and
verify the complete pair:

```sh
npx fise generate ./src/fise.profile.ts --backend python
npx fise verify ./src/fise.profile.ts ./src/fise_profile.py
```

Commit the generated file or complete pair. Do not hand-edit it and do not
regenerate it during install, build, startup, or test setup.

Use `--override` only for an intentional compatibility change:

```sh
npx fise generate ./src/fise.profile.ts --override
```

Existing envelopes still require the previous committed profile.

## Place the profile

### Monorepo

Prefer one source file in a shared package:

```text
packages/fise-profile/src/fise.profile.ts
        ├── imported by backend
        └── imported by frontend
```

Update both applications to import that owner. Do not copy the generated source
into both application folders unless the repository has an explicit mirroring
contract.

When the backend is Python, the shared owner contains both generated files:

```text
packages/fise-profile/
        ├── fise.profile.ts  -> frontend
        └── fise_profile.py  -> Python backend
```

These are one compatibility pair, not two independently generated Profiles.

### Separate repositories

Generate once in the chosen owner, then distribute that exact file or generated
language pair through a copy, CI artifact, or internal package. If the target
is not already specified, ask the user before copying. A useful question is:

> The FISE Profile was generated and verified at `<source>`. Which frontend and
> backend destinations should receive these exact generated artifacts? I will
> copy/sync them and will not generate another Profile there.

After copying, run `fise verify` in both repositories and compare the reported
Profile fingerprint. For a JavaScript/Python deployment, also run the paired
form wherever both files are available. The values must match. For copies of
the same language artifact, enforce exact file equality in CI when possible.

## Define context together

Keep one documented positional convention shared by frontend and backend:

```ts
// Positions: session, user, tenant, connection epoch, resource, sequence.
const context = [
  sessionId,
  userId,
  tenantId,
  connectionEpoch,
  "orders:v1",
  responseSequence
] as const;
```

The two sides may derive these values from their current request or session, but
they must pass the same values in the same order for one envelope. Do not embed
context values in the generated profile. FISE also does not store them in the
envelope. Here `sessionId` means a deliberately client-visible temporary ID,
not the application's authentication credential.

## Bind and use

```ts
import { Fise } from "fise";
import profile from "./fise.profile.js";

const fise = new Fise(profile);
const envelope = fise.encrypt(data, context);
const restored = fise.decrypt(envelope, context);
```

Python backend code stays equally direct:

```python
from fise import Fise
from fise_profile import profile

fise = Fise(profile)
envelope = fise.encrypt(data, context)
restored = fise.decrypt(envelope, context)
```

One Profile supports strings, JSON-safe structured values, and binary data.
There is no separate JSON Profile or binary Profile. Structured/text encryption
returns a JSON-safe string; binary encryption returns binary output. FISE
compresses structured input only when that makes its internal payload smaller.
After decrypting structured data, apply the application's normal response schema
before using the value.

Use full binary coverage unless the application owner explicitly accepts a
directly inspectable middle region. Edge mode is an instance-level producer
policy:

```ts
const mediaFise = new Fise(profile, {
  binary: { mode: "edges" }
});

const envelope = mediaFise.encrypt(videoBytes, context);
```

Omitting `edgeBytes` uses 1 MiB per side. Set a custom positive byte count only
after measuring representative files. Do not infer this policy from file type
or size. Record the accepted exposure and see
[binary data](./BINARY_DATA.md).

If the producer wants every envelope from one instance to have a fixed
normal-runtime lifetime, configure it once:

```ts
const producer = new Fise(profile, { ttlSeconds: 30 });
const envelope = producer.encrypt(data, context);

// The consumer reads expiry from the envelope; it does not repeat the TTL.
const consumer = new Fise(profile);
const restored = consumer.decrypt(envelope, context);
```

Use TTL only as a freshness policy. It is not trusted authorization,
cryptographic expiry, or replay prevention, and a controlled client can patch
the check or its clock. Backend/browser clock skew and network delay are normal
failure inputs, so avoid very short TTLs for correctness-critical flows.

## Plan Profile replacement

Do not replace a deployed Profile as an isolated backend or frontend change.
For an atomic deployment, ship both sides together. For a rolling deployment,
use an application-owned versioned endpoint or versioned frontend asset so old
clients continue to use the old producer until clients and caches have drained.
FISE does not add a legacy decoder or Profile-history lookup for this rollout.

When the application uses `withWasm()` or `parallel()` in a browser, test the
actual production bundle and CSP. The JavaScript default needs no
WASM-specific policy; WASM commonly needs `script-src 'wasm-unsafe-eval'`, and
same-origin workers commonly need `worker-src 'self'`. See
[web application integration](./WEB_APPLICATIONS.md).

## Choose fallback behavior explicitly

Use the default strict instance unless the application owner explicitly accepts
raw pass-through:

```ts
const strictFise = new Fise(profile);
const availabilityFise = new Fise(profile, { strict: false });
```

With `strict: false`, recoverable ordinary `encrypt` or `decrypt` failures return
their exact input. Expiration and clock failures still throw. Raw fallback can
expose client data or let malformed input reach the application. Before enabling
it, identify the transport boundary that accepts both outcomes, add schema
validation and fallback monitoring there, and record the decision in application
documentation. Do not assume that binary output proves encryption succeeded.
Range and progressive methods remain strict.

## Completion checklist

- One canonical generated Profile or same-IR language pair exists.
- Frontend and backend import the correct generated artifact or verified exact
  copies for their languages.
- No side generated an independent profile.
- The positional context contract is documented and shared.
- Context contains no authentication token, protected cookie, or other
  credential exposed only for FISE.
- `fise verify` passes and reports the same fingerprint everywhere; paired
  JavaScript/Python verification passes when that backend is used.
- Relevant application tests exercise encrypt/decrypt with realistic context.
- Restored structured values pass application-owned schema validation.
- Profile replacement has an atomic or versioned rolling-deployment plan.
- Browser WASM/worker use is verified in the application's production bundle
  and CSP when enabled.
- Binary coverage is full by default; any edge-mode use has an explicit,
  documented performance/exposure decision.
- Any TTL policy is configured on producer instances and documented as
  normal-runtime freshness rather than a security boundary.
- Raw fallback is either disabled or explicitly documented, validated, and
  monitored at the application boundary.
- The generated file or complete language pair and context contract are
  committed together.

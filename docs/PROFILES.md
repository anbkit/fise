# Generated profiles

A FISE 2.0 profile is a generated source artifact that applications treat as
immutable. Importing it creates a frozen `Profile` instance that owns one
deterministic, length-preserving, reversible byte pipeline and the layout
calculations needed to read and write its envelopes.

## Lifecycle

```text
npx fise generate path
        ↓
bidirectional text/adaptive-structured/binary verification
across full/edge coverage, JavaScript, WASM, and workers
        ↓
generated module exports Profile instance
        ↓
Git versions that source file
        ↓
new Fise(profile)
```

There is no separate profile database. Generation is not designed to reproduce
a prior result: every run uses fresh entropy to sample an independently
randomized Profile candidate. The CLI refuses an existing destination unless `--override`
is supplied. If an application needs code for an earlier envelope, it restores
the earlier generated module from Git.

## Generated-module contract

Conceptually, a generated module contains:

```ts
import { Profile } from "fise/profile-runtime";

export default Profile.generated(
  opaqueFingerprint,
  contextSegmentOffset,
  contextSegmentLength,
  contextMixer,
  offsetCalculator,
  markerCalculator,
  specializedForwardKernel,
  specializedReverseKernel,
  generatedWasmModule
);
```

This is a low-level ABI emitted by the CLI, not a builder API. Applications
must import the default instance unchanged. Every callback receives the frozen
positional context snapshot; offset, marker, forward, and reverse also receive
the derived context segment and mixed context lanes. Do not hand-edit these
callbacks, the fingerprint, or the embedded WASM. Run `fise generate` to create
a new verified compatibility artifact instead.

## Generation algorithm

Each invocation uses Node's cryptographically secure random source to choose:

- one random `uint32` context-segment offset and a 12–32 byte segment length;
- four to seven reversible byte-local stages;
- stage order and non-neutral parameters;
- profile-specific context-mixer constants;
- offset and marker calculations.

The primitive set includes XOR masks, addition modulo 256, bit rotation, and
affine byte maps with odd multipliers and computed modular inverses. The
runtime converts the positional context array to canonical JSON and unpadded
Base64URL, then cuts a circular profile-specific segment. Masks depend on that
segment, absolute byte position, and mixed lanes from the complete encoding.
When constructor TTL or binary edge coverage is enabled, core appends
domain-separated wire policy to the internal encoded operation binding before
mixing and segment derivation. It does not add those fields to the generated
Profile or alter the frozen positional array received by callbacks.

Before emission, the generator:

1. builds typed internal IR;
2. derives the inverse by reversing stage order and operation semantics;
3. rejects identity or removable stages on fixed semantic vectors;
4. checks round trips over empty, boundary, all-byte, and larger inputs;
5. checks offset bounds;
6. fuses stages into one forward loop and one reverse loop;
7. compiles the same semantics into a WASM module;
8. hashes the semantic IR into a 128-bit opaque fingerprint;
9. loads the candidate and verifies forward/reverse round trips for text,
   adaptive structured compression, binary full/edge coverage, constructor TTL,
   range/progressive restoration, JavaScript, WASM, and workers with random
   synthetic context, plus empty values with the default context;
10. atomically publishes the module only after all checks pass.

Run `npx fise verify <profile-file>` to repeat the same read-only verification
for a committed file. It verifies restoration and deterministic re-encryption.
For cross-backend checks, JavaScript-produced envelopes are restored by
WASM/workers, and WASM/worker-produced envelopes are restored by JavaScript.
Profile modules are executable code; verify only trusted generated files.

The IR and randomness are not saved. Constants and functions present in the
generated file are the profile itself, not a regeneration record.

Generated modules contain only the runtime import and executable Profile
export. Lifecycle guidance stays in CLI output and documentation instead of
being embedded as banner comments in application bundles.

## Deployment ownership

Choose one canonical owner for every generated profile. Every producer and
consumer of an envelope must deploy that exact generated file and use the same
positional context contract.

- In a monorepo, keep one profile in a shared package and import it from the
  frontend and backend.
- With separate repositories, generate once in the owner repository and
  distribute the exact file by copy, CI artifact, or internal package.
- Never generate independently on each side; separate randomized runs must be
  treated as incompatible rather than assumed to recreate the same artifact.

Context values are not copied with the profile. Both sides establish matching
values from their session or request flow and agree in advance on what each
array position means. Values must already be client-visible; never expose an
authentication token, protected cookie, or HttpOnly session value for context.

Keep the Profile stable while deployed producers and consumers must
interoperate. Replacing it requires a coordinated application rollout. For a
rolling deployment, keep old clients on an old versioned endpoint or frontend
asset until they and intermediate caches have drained. This routing belongs to
the application; FISE 2.0 does not search Profile history or decode envelopes
with another Profile.

Coding agents should follow the [agent integration guide](./AGENT_GUIDE.md),
including its requirement to ask for a destination rather than guessing when a
separate repository or copy location is not explicit.

## Multiple profiles

Applications may generate as many files as needed:

```sh
npx fise generate ./src/api.profile.ts
npx fise generate ./src/media.profile.ts
```

```ts
const api = new Fise(apiProfile);
const media = new Fise(mediaProfile);
```

This separation is an application decision, not a text/binary distinction.
Every profile can process both structured values and bytes. Separate profiles
may be useful for independent deployment owners or workload policies.

## Fingerprint

The CLI derives the profile fingerprint from normalized semantic IR and carries
it in the FISE header. The runtime treats it as an opaque compatibility
identifier for early wrong-profile rejection; it does not recompute the
generator IR or attest the exact source file. The fingerprint is public, is not
a secret, is not a global uniqueness guarantee, and is not an authentication or
integrity tag.

## Security meaning

Generated profiles create execution diversity: different applications or
generation runs contain different constants, operation order, fused code, and
WASM bytes. This can reduce the reuse of one static signature or decoder. It
does not prevent an attacker with client-runtime access from calling or hooking
the generated reverse path. See [Security](./SECURITY.md).

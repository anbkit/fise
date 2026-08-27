# Generated profiles

A FISE 2.0 profile is generated transformation semantics that applications
treat as immutable. A JavaScript-only deployment represents it with one source
artifact. A Python-backend deployment represents the same Profile with the
JavaScript/Python source pair emitted by one command. Importing either artifact
creates an immutable `Profile` instance with the same deterministic,
length-preserving, reversible byte pipeline and layout calculations.

## Lifecycle

```text
npx fise generate path
        ↓
bidirectional text/adaptive-structured/binary verification
across full/edge coverage, JavaScript, WASM, and workers
        ↓ optional --backend python
same-IR Python artifact and exact cross-language wire verification
        ↓
generated module or pair exports matching Profile instance(s)
        ↓
Git versions that source file
        ↓
new Fise(profile)
```

There is no separate profile database. Generation is not designed to reproduce
a prior result: every run uses fresh entropy to sample an independently
randomized Profile candidate. The CLI refuses an existing destination unless `--override`
is supplied. If an application needs code for an earlier envelope, it restores
the earlier generated module or pair from Git.

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

For a Python backend, the same command emits an adjacent importable module:

```python
from fise.profile_runtime import Profile

profile = Profile.generated(
    opaque_fingerprint,
    context_segment_offset,
    context_segment_length,
    context_mixer,
    offset_calculator,
    marker_calculator,
    specialized_forward_kernel,
    specialized_reverse_kernel,
)
```

This is the same private generated ABI expressed in Python. It is not a second
Profile and must not be generated separately or hand-edited. The Python runtime
does not need the generated WASM bytes because WASM and workers are frontend
execution backends, not wire semantics.

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
9. when requested, emits Python callbacks from that same in-memory IR;
10. loads the candidate and verifies forward/reverse round trips for text,
   adaptive structured compression, binary full/edge coverage, constructor TTL,
   range/progressive restoration, JavaScript, WASM, and workers with random
   synthetic context, plus empty values with the default context;
11. for a Python pair, verifies native Python behavior, hundreds of deterministic
    binary64 values, the shared fingerprint, and exact JavaScript/Python envelopes;
12. atomically publishes the module or complete pair only after all checks pass.

Run `npx fise verify <profile-file>` to repeat the same read-only verification
for a committed JavaScript or Python file. Use `npx fise verify <js-file>
<python-file>` to verify a deployed language pair. Verification proves
restoration and deterministic re-encryption.
For cross-backend checks, JavaScript-produced envelopes are restored by
WASM/workers, and WASM/worker-produced envelopes are restored by JavaScript.
Profile modules are executable code; verify only trusted generated files.

The IR and randomness are not saved. Constants and functions present in the
generated file or pair are the Profile itself, not a regeneration record.

Generated modules contain only the runtime import and executable Profile
export. Lifecycle guidance stays in CLI output and documentation instead of
being embedded as banner comments in application bundles.

## Deployment ownership

Choose one canonical owner for every generated Profile. Every producer and
consumer of an envelope must deploy the exact generated artifact for its
language and use the same positional context contract.

- In a JavaScript monorepo, keep one profile in a shared package and import it
  from the frontend and backend.
- With a Python backend, run `fise generate <js-path> --backend python` once,
  then place the JavaScript artifact with the frontend and its paired Python
  artifact with the backend.
- With separate repositories, generate once in the owner repository and
  distribute the exact file or pair by copy, CI artifact, or internal package.
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
npx fise generate ./src/media.profile.ts --backend python
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

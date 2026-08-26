# Generated profiles

A FISE 2.0 profile is immutable executable code. It owns one deterministic,
length-preserving, reversible byte pipeline and the layout calculations needed
to read and write its envelopes.

## Lifecycle

```text
npx fise generate path
        ↓
generated module exports Profile instance
        ↓
Git versions that source file
        ↓
new Fise(profile)
```

There is no separate profile database. A generation run is not reproducible by
design: running the command again creates a different file. If an application
needs code for an earlier envelope, it restores the earlier generated module
from Git.

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
normally import the default instance unchanged. Every callback receives the
frozen positional context snapshot; offset, marker, forward, and reverse also
receive the derived context segment and mixed context lanes. Expert users can
therefore make a JavaScript-only callback context-aware, but changing generated
callbacks invalidates the embedded WASM parity and semantic fingerprint unless
those artifacts are regenerated and verified together.

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

Before emission, the generator:

1. builds typed internal IR;
2. derives the inverse by reversing stage order and operation semantics;
3. rejects identity or removable stages on fixed semantic vectors;
4. checks round trips over empty, boundary, all-byte, and larger inputs;
5. checks offset bounds;
6. fuses stages into one forward loop and one reverse loop;
7. compiles the same semantics into a WASM module;
8. hashes the semantic IR into a 128-bit opaque fingerprint;
9. writes the module atomically.

The IR and randomness are not saved. Constants and functions present in the
generated file are the profile itself, not a regeneration record.

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

The profile fingerprint is derived from normalized semantic IR and carried in
FISE and FISF headers. It detects accidental use of the wrong generated file.
It is public, is not a secret, and is not an authentication tag.

## Security meaning

Generated profiles create execution diversity: different applications or
generation runs contain different constants, operation order, fused code, and
WASM bytes. This can reduce the reuse of one static signature or decoder. It
does not prevent an attacker with client-runtime access from calling or hooking
the generated reverse path. See [Security](./SECURITY.md).

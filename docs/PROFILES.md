# FISE 1.1 Profiles

A `FiseProfile` is the smallest compatibility unit in 1.1. It owns the public
ID, representation, reversible transform, layout, external-context contract,
and resource limit. This prevents producer and consumer code from combining a
layout from one profile with a transform from another by accident.

## Choose a profile path

Use `defaultStringProfile` or `defaultBinaryProfile` when the built-in wire
behavior is sufficient. Use a compiled manifest when multiple services,
deployments, or languages need reproducible behavior. Use `defineStringProfile`
or `defineBinaryProfile` only when the declarative compiler cannot express the
required layout.

These are different interoperability classes, even though they share the same
runtime `FiseProfile` interface:

| Profile path | Behavior source | Identity | Interoperability boundary |
| --- | --- | --- | --- |
| Built-in default | FISE specification and package | Fixed public ID | String is defined as JavaScript UTF-16 code units; binary has independent Python evidence |
| Manifest-compiled | `fise.profile/1` declarative artifact | SHA-256 content-derived ID | Portable only across implementations of the declared compiler surface |
| Application-defined runtime | Trusted callbacks supplied by the application | Developer-assigned ID | Local contract; cross-language behavior is not implied |

“Manifest-compiled” and “application-defined runtime” are documentation terms,
not additional public TypeScript types. A compiled profile still becomes a
normal immutable `FiseProfile` at runtime.

## Runtime interface

```ts
type FiseProfile = FiseStringProfile | FiseBinaryProfile;

interface FiseLayoutInput {
  transformedLength: number;
  saltLength: number;
}

interface FiseLayout<T> {
  markerSize: number;
  saltRange?: { min: number; max: number };
  offset(input: FiseLayoutInput, ctx: FiseContext): number;
  createMarker(input: FiseLayoutInput, ctx: FiseContext): T;
}
```

The decoder already knows salt length from the header. A profile creates the
expected marker; it never decodes the marker to discover length. This removes
the old inverse-codec ambiguity and salt-range candidate scanning.

Required profile, layout, and transform members must be own properties. The
definition helpers clone and freeze those members, including nested salt-range,
context-field, and limit objects. Prefer plain objects and closure state over
class/prototype methods.

Runtime options and metadata are also plain-data contracts. FISE ignores
inherited properties, rejects accessors and symbol keys, and validates one
immutable snapshot so layout callbacks cannot observe a different value later
in the same operation.

## Context

```ts
context: {
  timestamp: "required",
  metadata: {
    tenant: { type: "number", required: true },
    preview: { type: "boolean" }
  },
  allowAdditionalMetadata: false
}
```

Producer and consumer must supply the same relevant context. Context is not in
the envelope. FISE validates presence and primitive type, but it cannot prove
that an application chose the correct business value.

If layout behavior uses a time bucket, define rollover explicitly. Automatic
fallback to earlier buckets is intentionally absent.

## Marker and offset

`createMarker` receives declared transformed and salt lengths plus validated
context. Its result must have exactly `markerSize` units. `offset` receives the
same inputs and returns a finite location, which the runtime truncates and
clamps into the transformed payload boundary.

The marker is not an authentication tag. It can detect a wrong profile/context
only when that mismatch changes the expected marker or its location. An
attacker with the public profile can create a consistent replacement.

The failure boundary is intentionally narrow:

| Condition | Primary check | Marker contribution |
| --- | --- | --- |
| Wrong wire version or profile ID | Header fields | None |
| Truncation or trailing data | Exact total length | None |
| Wrong context or layout under the same ID | Recomputed marker/location | Partial; mappings and observed bytes can collide |
| Same-length payload or salt mutation | Application integrity control | Not generally detected |
| Deliberate rewrite by a party with the profile | Authentication/MAC/AEAD outside FISE | Not prevented |

There is no profile-independent false-acceptance probability. A marker read at
the wrong position is payload-dependent, not necessarily uniformly random.
Marker width trades envelope overhead and representational capacity against the
chance of an accidental match under a deployment-specific data model; it must
not be converted into security bits.

## Handwritten string profile

```ts
import { defineStringProfile, xorCipher } from "fise";

export const catalogProfile = defineStringProfile({
  id: "com.example.catalog.v3",
  representation: "string",
  transform: xorCipher,
  context: {
    metadata: { tenant: { type: "number", required: true } }
  },
  limits: { maxEnvelopeLength: 1_000_000 },
  layout: {
    markerSize: 2,
    saltRange: { min: 16, max: 32 },
    offset(input, ctx) {
      const length = input.transformedLength || 1;
      return (input.transformedLength * 5 + Number(ctx.metadata?.tenant)) % length;
    },
    createMarker(input, ctx) {
      return ((input.saltLength + Number(ctx.metadata?.tenant)) % 1_296)
        .toString(36)
        .padStart(2, "0");
    }
  }
});
```

## Handwritten binary profile

```ts
import { defineBinaryProfile, xorBinaryCipher } from "fise";

export const assetProfile = defineBinaryProfile({
  id: "com.example.assets.v2",
  representation: "binary",
  transform: xorBinaryCipher,
  limits: { maxEnvelopeLength: 16 * 1024 * 1024 },
  layout: {
    markerSize: 2,
    saltRange: { min: 24, max: 48 },
    offset(input) {
      return Math.floor(input.transformedLength / 2);
    },
    createMarker(input) {
      return Uint8Array.from([
        input.saltLength >>> 8,
        input.saltLength & 0xff
      ]);
    }
  }
});
```

## Backend selection

A backend is an implementation detail only when it produces exactly the same
transform bytes. It must carry the same transform ID:

```ts
const backend = await createWasmXorBinaryCipher();
const wasmProfile = withBinaryBackend(assetProfile, backend);
```

`withBinaryBackend` rejects a different ID with `TRANSFORM_MISMATCH`. Both
`fise.xor.utf16.v1` and `fise.xor.u8.v1` are reserved for function identities
registered by FISE, so an arbitrary same-ID callback cannot preserve a built-in
semantic identity. The binary ID covers both the JavaScript and WASM backends.
Binding also
runs deterministic encrypt/decrypt, round-trip, ownership, and mutation checks
using salt lengths from the profile's declared range.

Those finite checks catch implementation drift; they are not a mathematical
proof about arbitrary trusted callback code. Application-owned transforms use
their own ID and remain a trusted-code boundary. Validate them over their full
domain and keep independent golden/property tests.

## Identity and rotation

The ID is public routing metadata, not a secret. Change it whenever any
decode-relevant behavior changes, including transform semantics, layout,
marker, salt range, context interpretation, or resource policy that must roll
out atomically.

`limits.maxEnvelopeLength` is enforced on both creation and restoration. A
profile therefore cannot intentionally emit an envelope that its own default
decode policy refuses.

Handwritten IDs rely on developer discipline. Compiled manifests derive IDs
from canonical content and emit a rotation artifact, so they are preferred for
production governance. A handwritten profile does not become portable merely
because it carries a `manifestDigest`-shaped value or reproduces a finite test
vector.

## Validation checklist

- Exercise every salt length and meaningful context class.
- Run `validateFiseProfileContract`; it exercises transform semantics as well as
  marker and offset behavior within the declared salt range.
- Include empty, Unicode, binary all-byte, and large payloads.
- Verify wrong profiles, wrong context, marker changes, truncation, and limits.
- Generate deterministic vectors for every implementation language/backend.
- Roll producer and consumer atomically for every new profile ID.
- Keep application payload schema validation after FISE decode.

See [PROFILE_MANIFEST.md](./PROFILE_MANIFEST.md) and
[CONFORMANCE.md](./CONFORMANCE.md).

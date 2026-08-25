# FISE 1.1 Profile Manifest and Rotation

The manifest compiler turns a strict JSON description into a frozen runtime
profile, a canonical artifact, a deterministic vector, and a rollout diff. It
is designed to make compatibility identity reviewable and reproducible without
hashing JavaScript function source.

## Manifest example

```json
{
  "schema": "fise.profile/1",
  "name": "com.example.catalog",
  "revision": 3,
  "representation": "binary",
  "transform": "xor-u8-v1",
  "saltRange": { "min": 16, "max": 32 },
  "marker": { "kind": "uint-be", "width": 2 },
  "offset": {
    "kind": "affine",
    "lengthMultiplier": 7,
    "saltMultiplier": 3,
    "timestampModulo": 11,
    "metadataTerms": [
      { "key": "tenant", "multiplier": 5, "modulo": 97 }
    ]
  },
  "context": {
    "timestamp": "required",
    "metadata": {
      "tenant": { "type": "number", "required": true }
    }
  },
  "limits": { "maxEnvelopeLength": 8388608 }
}
```

Unknown fields are rejected at every manifest layer. Numeric fields must be
JSON numbers; numeric strings, booleans, `null`, and objects are not coerced.

## Supported declarative surface

| Field | Values |
| --- | --- |
| `schema` | exactly `fise.profile/1` |
| `representation` | `string` or `binary` |
| `transform` | `xor-utf16-v1` for string, `xor-u8-v1` for binary |
| string marker | printable-ASCII `base-n` alphabet and fixed width |
| binary marker | `uint-be` width 1–4, or ASCII `base-n` |
| offset | affine terms over transformed length, salt length, timestamp, and required numeric metadata |
| context | required/optional/forbidden timestamp and typed primitive metadata |
| limit | optional non-negative safe-integer maximum envelope length |

For compiled offsets, the final position is the positive modulo of the affine
sum by `(transformedLength || 1)`. The compiler performs the arithmetic with
`BigInt`, so large safe-integer context values do not silently lose precision.

Metadata offset terms must reference required numeric fields. A timestamp term
cannot be combined with a forbidden timestamp contract.

## Canonical identity

The compiler normalizes defaults, recursively sorts JSON object keys, sorts
typed metadata and commutative affine metadata terms by key, and computes
SHA-256 over the resulting canonical JSON. The runtime ID is:

```text
{name}.v{revision}.{first 128 bits of SHA-256}
```

The complete 256-bit digest remains in the artifact and on the compiled
profile as `manifestDigest`. The compact prefix is routing identity, not a
signature. If the full generated ID would exceed the 63-character wire limit,
compilation fails and the manifest name must be shortened.

For cross-language identity, the bytes are defined in this order:

1. validate and normalize the manifest into the schema-complete artifact form;
2. order every object member lexicographically by its key;
3. preserve array order, after sorting the compiler-declared commutative
   `metadataTerms` by key;
4. serialize without insignificant whitespace using ECMAScript JSON primitive
   serialization; and
5. UTF-8 encode that string before SHA-256.

The normalized schema contains only safe integers and schema-restricted ASCII
strings/keys. On that restricted surface this is compatible with the JSON
Canonicalization Scheme described by RFC 8785. The exported `canonicalJson`
helper is not advertised as a general-purpose JCS implementation for arbitrary
JSON outside the manifest schema.

The normalized manifest, all nested arrays/objects, compiled result, and emitted
artifacts are frozen snapshots. Mutating the caller's source object after
compilation cannot change runtime semantics, the digest, or the profile ID.
Programmatic manifest objects must expose enumerable data properties; accessors
are rejected rather than read repeatedly. JSON and CLI inputs naturally satisfy
this data-only requirement.

## Validation

```ts
const compiled = await compileFiseProfileManifest(manifest);
const report = validateFiseProfileContract(compiled.profile);
```

The validator checks every salt length in the declared range at transformed
lengths `0`, `1`, `255`, and `65536`, using deterministic fixture context. It
checks marker type/width and offset validity. It also runs four deterministic
transform cases over salt lengths selected from the declared range, including
encrypt/decrypt parity, round trip, output ownership, and input immutability.
Known built-in string and binary IDs require FISE-registered implementations.
This catches many contract errors; it is not a proof over all possible payload
sizes, contexts, or application-owned callback behavior.

The CLI exposes the same path:

```sh
fise profile validate profile.json
fise profile build profile.json
fise profile vectors profile.json
```

Use `-` to read one manifest from standard input.

## Artifact

`fise profile build` emits schema `fise.profile-artifact/1` with:

- wire major/minor version;
- generated profile ID;
- `sha256` and the complete digest; and
- the normalized manifest.

The returned artifact and its manifest are deeply frozen in memory. JSON emitted
by the CLI remains an ordinary serialized value.

Store this artifact with deployment configuration. It is deterministic but
unsigned. Protecting artifact provenance requires ordinary release signing or
a future signed-manifest protocol.

## Rotation diff

```sh
fise profile diff old.json new.json
```

The `fise.profile-rotation/1` artifact contains old/new IDs and digests,
changed JSON paths, representation compatibility, and rollout requirements.
Different IDs set `requiresAtomicRollout: true` and `legacyFallback: false`.

A normal v1.1 rotation is:

1. build and review the new artifact and vector;
2. deploy producers and consumers atomically, or introduce a new endpoint/media
   contract;
3. invalidate or regenerate queued, cached, and stored old envelopes; and
4. monitor `PROFILE_MISMATCH` separately from malformed traffic.

The library does not accept a list of prior profiles and does not auto-fallback.

## Deterministic vectors

`fise profile vectors` uses the minimum salt length, deterministic salt,
deterministic fixture context, and a fixed payload. This is suitable for
cross-language golden tests. Binary vectors use a deterministic non-zero salt
pattern so even a one-byte salt distinguishes XOR from identity. Vectors must
not be copied into production encryption, where fresh salt remains mandatory.

The repository also includes a standard-library-only
[Python binary reference](../reference/python/README.md). It independently
verifies a compiled artifact digest and profile ID, decodes the TypeScript
vector, and reproduces the same envelope bytes. Its evidence is deliberately
limited to the manifest-compiled binary surface.

## Programmatic API

All compiler APIs are available from both `fise` and `fise/profiles`:

```ts
import {
  compileFiseProfileManifest,
  createFiseProfileArtifact,
  createFiseProfileRotationArtifact,
  createManifestConformanceVector,
  validateFiseProfileContract
} from "fise/profiles";
```

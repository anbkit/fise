# FISE 1.1 Security Boundary

## Meaning of `encrypt`

FISE uses `encrypt` and `decrypt` as names for forward and reverse envelope
operations. Those names are API vocabulary, not a blanket cryptographic claim.
Security properties come from the selected transform and deployment.

The built-in XOR profiles carry their salt inside the envelope. They provide a
non-plaintext reversible representation, not confidentiality, authenticity,
integrity, anti-replay, authorization, or DRM.

## Property matrix

| Property | FISE 1.1 framing | Built-in XOR | Required control |
| --- | --- | --- | --- |
| Version/profile compatibility | Yes | N/A | FISE header/profile |
| Truncation/trailing-data detection | Yes | N/A | Exact length checks |
| Context/layout mismatch that changes marker value or location | Partial | N/A | Profile layout |
| Same-length payload or salt mutation | No | No | MAC, AEAD, signature, or application validation |
| Network confidentiality | No | No | TLS |
| Cryptographic payload confidentiality | No | No | Standard encryption at a trusted boundary |
| Origin authentication/tamper integrity | No | No | AEAD/signature/MAC with protected keys |
| Authorization | No | No | Server policy |
| Replay prevention | No | No | Nonce/session/business policy |
| Client-side anti-analysis | No | No | Assume client visibility |

“Partial” matters: marker width is finite, layout mappings can collide, and a
party that knows the profile can rewrite all fields consistently.

The marker depends on declared lengths and configured context, not on every
payload or salt byte. It therefore cannot be assigned a general collision
probability: bytes observed at a wrong marker position may be structured and
non-uniform. Marker width is a layout-capacity and deployment-specific
consistency trade-off, not an authentication strength.

## Threat model

Assume a client-side attacker can:

- obtain envelopes through an authorized or compromised session;
- download shipped JavaScript, profile artifacts, and WASM;
- inspect public header fields and the carried salt;
- hook FISE before encryption or after decryption;
- inspect WASM calls and linear memory;
- run the official client under automation; and
- reproduce public profile behavior outside the client.

Under that model, FISE may impose an adaptation and maintenance step on tools
that expect stable plaintext JSON/bytes. It cannot keep client-visible payloads
secret from the client.

## Improvements delivered by 1.1

The 1.1 changes improve engineering safety without inflating the cryptographic
claim:

- atomic profiles prevent transform/layout mix-and-match;
- exact version, profile, and length fields remove heuristic candidate scans;
- marker recomputation removes the inverse marker decoder;
- context schemas reject missing, forbidden, and mistyped inputs;
- profile/caller bounds reject oversized envelopes before core parsing;
- HTTP readers enforce configured decoded-envelope limits while consuming the
  body and cancel on overflow;
- Web Crypto randomness fails closed without `Math.random`;
- canonical manifests, full digests, vectors, and rotation diffs make rollout
  identity reviewable; and
- typed errors separate compatibility, malformed input, resource, and runtime
  failures.

These are protocol robustness properties, not cryptographic secrecy.

## Randomness

Salt content and salt-length selection use `crypto.getRandomValues`.
Alphanumeric string salts use rejection sampling to avoid alphabet bias;
inclusive integer selection also uses rejection sampling. Binary salts use the
full byte range and large requests are chunked at Web Crypto's 65,536-byte
limit. The standalone random-salt helpers cap one allocation request at 64 MiB;
wire profiles remain limited to salts of at most 65,535 units.

The salt is public. Better randomness varies representations but does not make
repeating XOR secure when the salt travels with the ciphertext.

## Profile artifacts

A compiled profile ID contains a 128-bit SHA-256 prefix, and its artifact
contains the full digest. This detects accidental content drift and supplies a
compact compatibility identity. It does not authenticate who authored or
approved the manifest. Protect artifacts through normal source control,
release signing, and deployment authorization.

## HTTP and payload handling

- Use HTTPS; the FISE media type is not transport security.
- Enforce limits at proxy/server/fetch layers as well as FISE.
- Treat `Content-Length` as untrusted; the actual envelope length is checked.
- Do not compare compressed-representation `Content-Length` with Fetch-decoded
  bytes; keep a separate transport wire-byte limit.
- Validate restored JSON/application schemas.
- Keep CORS, CSRF, cache, cookie/token, and authorization policy unchanged.
- Record error codes without logging sensitive restored payloads.

## Cryptographic composition

If a trusted server-to-server or storage boundary needs confidentiality and
integrity, use an established AEAD scheme with protected keys. Decide explicitly
whether AEAD wraps the complete FISE envelope or whether FISE is unnecessary at
that boundary. Do not invent a key inside a browser profile and call it secret.

If a browser is the authorized plaintext consumer, TLS protects transit but
cannot prevent that browser from observing plaintext after decode.

## Safe deployment checklist

- Use FISE only for payloads the receiving client is allowed to recover.
- Publish one exact profile artifact and vector per deployment contract.
- Rotate profiles atomically; do not auto-fallback.
- Set profile, caller, and transport size bounds.
- Keep standard authentication, authorization, quotas, and anomaly detection.
- Test production CSP and WASM behavior in real target browsers.
- Configure the WASM retained-page cap for the target device; the 64-MiB
  default is finite but is not a total-process memory limit.
- Measure adaptation cost empirically and report its uncertainty.
- Never describe profile counts or layout possibilities as security bits.

## Do not use built-in profiles for

- passwords, private keys, bearer tokens, or payment secrets;
- authorization decisions or trusted flags;
- regulated-data confidentiality;
- executable-code trust;
- tamper-proof audit records; or
- any design whose safety depends on the client not understanding FISE.

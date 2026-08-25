# FISE 1.1 HTTP Integration

`fise/http` keeps API transport binary-first and provides explicit UTF-8, JSON,
and standards-based `Response` helpers.

## Exports

```ts
import {
  FISE_MEDIA_TYPE,
  createFiseJsonResponse,
  createFiseResponse,
  fiseJsonDecrypt,
  fiseJsonEncrypt,
  fiseUtf8Decrypt,
  fiseUtf8Encrypt,
  readFiseJsonResponse,
  readFiseResponse
} from "fise/http";
```

## Media contract

Response writers set:

```text
application/vnd.fise; version=1.1; profile="{profile.id}"
```

Readers require:

- media type exactly `application/vnd.fise`, case-insensitively;
- version exactly `1.1`;
- profile exactly equal to the supplied binary profile ID;
- no duplicate or unsupported media parameters; and
- a valid non-negative integer `Content-Length` when that header is present.

Wrong versions use `UNSUPPORTED_VERSION`, wrong profiles use
`PROFILE_MISMATCH`, and malformed media metadata uses `INVALID_PAYLOAD`.
Each helper captures one immutable profile/context snapshot before processing.
Readers retain that same snapshot across asynchronous body consumption, so the
media profile check and envelope decode cannot diverge through caller mutation.

## Raw bytes

```ts
const response = createFiseResponse(bytes, profile, context, {
  status: 200,
  headers: { "cache-control": "private" }
});

const restored = await readFiseResponse(response, profile, {
  ...context,
  maxEnvelopeLength: 8 * 1024 * 1024
});
```

Caller headers are preserved except `Content-Type`, `Content-Length`, and
`Content-Encoding`, which cannot safely retain values calculated for a
plaintext body. The FISE writer owns the media type, emits an uncompressed body,
and removes caller-supplied representation metadata; the transport may calculate
or apply those fields afterward.

## JSON

```ts
const response = createFiseJsonResponse(value, profile);
const restored = await readFiseJsonResponse(response, profile, {
  maxEnvelopeLength: 1_000_000
});
```

The writer uses `JSON.stringify` followed by UTF-8. The reader validates FISE,
decodes fatal UTF-8, then calls `JSON.parse`. Values without a JSON
representation and cyclic/BigInt serialization failures use `INVALID_INPUT`.
Malformed restored UTF-8 or JSON uses `INVALID_PAYLOAD`.

`readFiseJsonResponse<T>()` is only a TypeScript cast. It does not perform
runtime schema validation.

## Resource behavior

The effective envelope maximum is the stricter profile/caller limit. When one is
configured, the reader consumes `Response.body` incrementally, counts the bytes
exposed by Fetch, and requests cancellation immediately after the maximum is
crossed. It retains only accepted chunks before assembling the complete
envelope. Cancellation is best-effort and is not allowed to delay the typed
`ENVELOPE_LIMIT` result. A standards-based readable body is required for this bounded path;
duck-typed `arrayBuffer()`-only responses fail closed with
`RUNTIME_UNAVAILABLE`.

For an absent or `identity` `Content-Encoding`, a declared `Content-Length`
above the maximum is rejected before reading, and the final decoded body length
must equal the declaration. For a non-identity coding such as `gzip` or `br`,
Fetch exposes decoded body bytes while `Content-Length` can still describe the
compressed representation. The reader therefore validates the header syntax
but does not compare that representation length with decoded envelope length or
use it as the decoded limit. The incremental maximum still applies to decoded
bytes.

Without a configured maximum, the helper may use `arrayBuffer()` and remains a
complete-body API. Even with bounded ingestion, FISE 1.1 does not decrypt or
return partial frames. Enforce separate wire-byte limits in the server, proxy,
CDN, and fetch layer. A framed streaming format requires a different wire
version.

## Security boundary

The media type provides content negotiation and compatibility checking, not
confidentiality or authenticity. Use HTTPS. Keep cookies/tokens, authorization,
CORS/CSRF policy, caching policy, and response schema validation under normal
application controls.

# Quick start

## 1. Install the runtime

```sh
npm install fise
```

FISE is ESM-only. Runtime operations require Node.js 20+ or a modern browser.
Secure randomness is consumed by the Node-based generator only.

For a Python backend, also install the dependency-free Python 3.10+ runtime:

```sh
python -m pip install fise
```

## 2. Generate a profile

```sh
npx fise generate ./src/fise.profile.ts
```

If the backend is Python, emit both language artifacts in this same operation:

```sh
npx fise generate ./src/fise.profile.ts --backend python
```

This creates `fise.profile.ts` and the adjacent importable
`fise_profile.py` from one transient IR, then verifies their shared fingerprint
and exact wire output before publishing either file.

The command requires `decrypt(encrypt(input))` to restore the original value
and requires encrypting that restored value to reproduce the same deterministic
envelope. It checks text, adaptive structured compression, binary full/edge coverage, TTL,
range/progressive restoration, JavaScript, WASM, workers, and empty values under
the default context. It publishes the module, or the same-IR language pair,
only after every check passes. Commit the file—or the complete
JavaScript/Python pair—to Git and deploy the correct exact artifact to every
producer and consumer.

Generation refuses to replace an existing path. To intentionally create a new
profile at that path, opt in explicitly:

```sh
npx fise generate ./src/fise.profile.ts --override
```

To check a committed profile without changing it:

```sh
npx fise verify ./src/fise.profile.ts
```

For a Python backend, verify the complete pair:

```sh
npx fise verify ./src/fise.profile.ts ./src/fise_profile.py
```

Verification uses random synthetic positional context, checks empty/default
context, TTL, binary full/edge and range/progressive behavior, and tests
JavaScript-produced envelopes in WASM/workers as well as WASM/worker-produced
envelopes in JavaScript. It exits `0` only when every check passes. Generated
Profiles are executable source; verify only files you trust.

Generated runtime modules may use `.js`, `.mjs`, `.mts`, or `.ts`. Declaration
suffixes such as `.d.ts` and `.d.mts` are rejected because they are not
executable modules.

The generator does not create or retain a seed, name, revision, manifest,
profile lock, or history database.

## 3. Share one profile

Frontend and backend must use the exact same generated artifact for
JavaScript-only deployments, or the exact same-IR language pair for a Python
backend. They must also agree on the meaning and order of context positions;
each encrypt/decrypt pair must receive matching operation values.

For a monorepo, place the profile in one shared package and import it from both
applications. For separate repositories, choose one profile owner, generate
there once, then copy or publish that exact file to the other repository. Never
run `fise generate` independently on each side because each command samples a
new independent candidate rather than reproducing the owned Profile.

The context contract belongs in shared application documentation or types.
Actual context values come from the current session/request and are not stored
inside the generated profile or envelope. Use only client-visible,
non-credential values; never expose a protected session cookie or token for
FISE context.

## 4. Bind and use it

```ts
import { Fise } from "fise";
import profile from "./fise.profile.js";

const fise = new Fise(profile);
const context = [
  "session_7f4a",
  "user_42",
  "tenant_acme",
  3,
  "orders:v1",
  18
] as const;

const envelope = fise.encrypt({ message: "hello" }, context);
const restored = fise.decrypt(envelope, context);
```

On a Python backend, import the paired generated instance and use the same
ordered context values:

```python
from fise import Fise
from fise_profile import profile

fise = Fise(profile)
context = ["session_7f4a", "user_42", "tenant_acme", 3, "orders:v1", 18]

envelope = fise.encrypt({"message": "hello"}, context)
restored = fise.decrypt(envelope, context)
```

Python structured/text input returns Base64URL `str`; top-level binary input
returns `bytes`. The frontend uses the paired JavaScript Profile and the same
context to restore either output.

With the default strict behavior, text and structured input produce a canonical
unpadded Base64URL string suitable for JSON transport. Top-level binary input
produces binary output. `decrypt` accepts either representation and uses the
transformed metadata to restore the original data type.
Structured values are compressed before transformation only when the resulting
internal payload is smaller. The restored value still needs the application's
ordinary response-schema validation before use.

## Optional envelope TTL

Configure one lifetime for every envelope encrypted by an instance:

```ts
const expiringFise = new Fise(profile, {
  ttlSeconds: 30
});

const envelope = expiringFise.encrypt(data, context);
```

FISE reads the current time when `encrypt` runs and stores an absolute expiry in
the envelope. Consumers use an ordinary instance and do not provide TTL or time:

```ts
const fise = new Fise(profile);
const restored = fise.decrypt(envelope, context);
```

At `now >= expiresAt`, restoration throws `FiseError` with code
`ENVELOPE_EXPIRED`. The TTL configured on a decrypting instance does not replace
the lifetime carried by the envelope; constructor TTL affects only envelopes
created by that instance. Full, edge, range, and progressive operations enforce
the same wire expiry. `withWasm()` and `parallel()` preserve it.

TTL is a normal-runtime freshness policy. It does not revoke plaintext already
restored, prevent replay during the valid interval, or resist a controlled
client that changes its clock or patches FISE. A backend and browser may also
disagree about time; allow for network delay and device clock skew instead of
using a very short TTL for a correctness-critical flow.

## Accepted values

```ts
fise.encrypt("text");
fise.encrypt(null);
fise.encrypt({ list: [1, true, "three"] });
fise.encrypt(Uint8Array.from([0, 1, 255]));
```

Structured values must be plain JSON-safe data. FISE rejects functions,
symbols, accessors, sparse arrays, proxies, custom prototype chains, cycles,
`undefined`, non-finite numbers, negative zero, typed arrays nested inside
JSON, and class instances. Convert application-specific values before calling
FISE.

Named TypeScript interfaces work directly; callers do not need to add a JSON
index signature to domain models. The public type surface rejects known
non-data shapes, and the runtime still validates every actual value.

## Optional raw fallback

`new Fise(profile)` defaults to `strict: true`: rejected input, an invalid
envelope, a wrong Profile, or mismatched context throws a `FiseError`.

An application that intentionally prefers availability can enable raw
pass-through for ordinary `encrypt` and `decrypt` calls:

```ts
const fise = new Fise(profile, { strict: false });

const encryptedOrRaw = fise.encrypt(data, context);
const restoredOrRaw = fise.decrypt(received, context);

if (Object.is(encryptedOrRaw, data)) {
  recordRawFallback();
}
```

If FISE raises an ordinary recoverable `FiseError` while processing either call,
it returns the exact original input without copying it. Successful calls behave
normally. `ENVELOPE_EXPIRED` and `CLOCK_UNAVAILABLE` always throw so fallback
cannot bypass a configured lifetime. In TypeScript, the result is a union of the
normal FISE result and the input type.

This is an availability option, not automatic safe downgrade negotiation:

- failed `encrypt` can let readable text, JSON, or binary data continue;
- failed `decrypt` can let malformed or non-FISE input reach application code;
- raw binary and an envelope are both binary data, so type alone cannot prove
  which path ran;
- unexpected programming errors still throw;
- expiration and clock failures still throw;
- range and progressive methods remain strict;
- WASM and parallel instances preserve the option, while backend startup and
  operations on a closed parallel runtime still throw.

Enable it only when the surrounding transport accepts both outputs. Validate
the restored/raw value against the application's schema and monitor fallback
at that boundary. `Object.is(result, input)` identifies pass-through because a
successful operation returns a newly owned result. FISE itself does not send,
log, or label the raw value.

## Context

Think of the Profile as the generated recipe and context as temporary values
added to that recipe for one application flow. Context is an optional
positional array. It is not stored in the envelope:

```ts
// Optional session context: session, user, resource, version, sequence.
const context = [
	sessionId,
	userId,
	"orders",
	"v1",
	responseSequence
] as const;

const envelope = fise.encrypt(data, context);
const dataAgain = fise.decrypt(envelope, context);
```

Each item must be `null`, a boolean, a finite number other than negative zero,
or a string. The array must be dense and cannot contain nested arrays, objects,
accessors, symbols, or custom properties. Position carries application meaning;
FISE intentionally stores no key names. Producer and consumer must provide the
same values in the same order. `undefined` means `[]`.

Choose values already available to both producer and consumer. Short-lived
session or connection state is usually more useful than fixed public literals.
Context is not a password, secret key, authentication tag, or authorization
decision; the server must still enforce access independently. The example
`sessionId` is a deliberately client-visible non-credential identifier, never
an auth token, protected cookie, or HttpOnly session value.

For each operation, FISE snapshots the array, canonicalizes it as JSON, encodes
those bytes as unpadded Base64URL, mixes the complete encoding into four lanes,
and derives a profile-specific circular segment using the generated offset and
length. The segment and lanes drive the byte pipeline, marker, and layout. The
original array, encoded form, and segment are absent from the envelope. FISE
does not guess context or search adjacent values.

## Binary range, progressive, and edge mode

```ts
const envelope = fise.encrypt(bytes, context);

const range = fise.decryptRange(
	envelope,
	{ start: 1000, endExclusive: 2000 },
	context
);

for await (const chunk of fise.decryptProgressive(envelope, context, {
	chunkSize: 256 * 1024
})) {
	consume(chunk);
}
```

Both APIs validate the complete ordinary envelope but restore only selected
plaintext bytes. The common synchronous range path can avoid copying the whole
encrypted input; progressive and asynchronous paths own a complete snapshot.
Progressive restoration is pull-driven over an envelope that is already in
memory; it is not incremental network fetching. Without context, pass options
directly as the second argument: `fise.decryptProgressive(envelope, { chunkSize })`.

For a large file or video, optional edge mode reduces Profile-kernel work:

```ts
const mediaFise = new Fise(profile, {
	binary: { mode: "edges" }
});

const edgeEnvelope = mediaFise.encrypt(bytes, context);
```

The default is 1 MiB per side; set `edgeBytes` in the constructor only when the
application needs a different size. Only metadata and the first/last resolved
content bytes are transformed. The middle remains directly inspectable.
Decryptors read the policy from the wire and do not repeat the option. If the
two edges meet or overlap, FISE uses full coverage. See
[binary data](./BINARY_DATA.md) before choosing this trade-off.

## WASM and workers

```ts
const wasm = await fise.withWasm();
const wasmEnvelope = wasm.encrypt(data, context);

const parallel = await fise.parallel({ workerCount: 4 });
try {
  const workerEnvelope = await parallel.encrypt(bytes, context);
} finally {
  await parallel.close();
}
```

See the [web application guide](./WEB_APPLICATIONS.md),
[CLI reference](./CLI.md), [agent integration guide](./AGENT_GUIDE.md),
[generated profiles](./PROFILES.md), [the specification](./SPEC.md), and
[the security boundary](./SECURITY.md).

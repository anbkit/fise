# Generated WASM and parallel workers

Every CLI-generated FISE 2.0 profile contains two byte-compatible execution
forms derived from the same reversible IR:

- fused specialized JavaScript forward/reverse loops;
- a generated WebAssembly module with forward/reverse exports.

WASM changes execution, not profile identity, envelope bytes, or the security
boundary.

## WASM

```ts
const javascript = new Fise(profile);
const wasm = await javascript.withWasm();

const envelope = wasm.encrypt(data, context);
const restored = javascript.decrypt(envelope, context);
```

Compilation is explicitly asynchronous. After `withWasm()` resolves,
`encrypt`, `decrypt`, range, and progressive setup remain synchronous. A new isolated
WASM instance is bound to the returned `Fise`; the original instance continues
using specialized JavaScript.

The returned instance preserves the source instance's `strict`, `ttlSeconds`,
and binary coverage options. A source created with
`{ strict: false, ttlSeconds: 30, binary: { mode: "edges" } }` keeps raw fallback
for recoverable ordinary failures, applies the 30-second lifetime, and uses the
resolved edge policy for newly encrypted binary envelopes. Compilation
failures, range/progressive failures, expiration, and clock failures still
throw. Full and edge coverage produce the same bytes as specialized JavaScript.

WASM linear memory grows in 64 KiB pages, is capped at 512 MiB, and is cleared
for the used input/context-segment region after both successful and failed
operations. Retained capacity may remain until the bound instance is discarded.

## Parallel workers

```ts
const parallel = await new Fise(profile).parallel({
  workerCount: 4,
  minimumParallelBytes: 256 * 1024
});

try {
  const envelope = await parallel.encrypt(bytes, context);
  const restored = await parallel.decrypt(envelope, context);
} finally {
  await parallel.close();
}
```

Workers compile the generated profile's WASM module once during startup. Large
transforms are divided into contiguous chunks. Every task receives its absolute
byte position, derived context segment, and mixed context lanes, so its output
is byte-compatible with the single-loop JavaScript and WASM paths. Inputs below
`minimumParallelBytes` use the local generated JavaScript kernel.

Worker-backed encrypt/decrypt and range work are asynchronous; progressive
restoration returns an async iterator. The retained pool must be closed. Calls
after close fail explicitly. Each worker also clears
the used input/context-segment region of its retained WASM memory on success and
failure.

Parallel instances also preserve the source `Fise` strict, `ttlSeconds`, and
binary coverage options. Raw fallback applies only to recoverable `encrypt` and
`decrypt` failures. Worker startup, range/progressive operations, expiration,
clock failures, and calls after `close()` remain strict.

## Availability

`isWasmSupported()` and `isParallelSupported()` report API presence only.
Compilation or worker startup may still fail because of Content Security
Policy, resource policy, unavailable module workers, or platform limits.

The default JavaScript path does not require a WASM-specific CSP allowance.
Deployments using `withWasm()` or `parallel()` commonly need:

```text
script-src 'self' 'wasm-unsafe-eval';
worker-src 'self';
```

The exact policy belongs to the application. `worker-src 'self'` assumes the
bundler emits the module worker on the same origin. Do not broaden CSP only to
make FISE work without reviewing the application's policy.

FISE constructs its browser worker with the standard
`new Worker(new URL(..., import.meta.url), { type: "module" })` pattern. The
release gate production-builds the packed npm artifact with Vite and exercises
that emitted worker in Chromium, including backend-produced JSON and binary HTTP
responses. The gate also verifies the non-worker root bundle with esbuild.
Other bundlers and frameworks must be checked in the final application build;
a low-level bundler that does not process worker URLs must be
configured to bundle and emit `dist/v2/workers/profileWorker.js` at the relative
URL expected by the application bundle.

See [web application integration](./WEB_APPLICATIONS.md) for deployment and
Profile-rollout guidance.

Neither backend hides plaintext from the hosting JavaScript environment or an
attacker capable of runtime instrumentation.

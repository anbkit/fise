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

Compilation is explicitly asynchronous. After `withWasm()` resolves, ordinary
`encrypt`, `decrypt`, and framed operations remain synchronous. A new isolated
WASM instance is bound to the returned `Fise`; the original instance continues
using specialized JavaScript.

WASM linear memory grows in 64 KiB pages, is capped at 512 MiB, and is cleared
for the used input/context-segment region after each operation. Retained capacity may
remain until the bound instance is discarded.

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

Worker-backed ordinary and framed operations are asynchronous. The retained
pool must be closed. Calls after close fail explicitly.

## Availability

`isWasmSupported()` and `isParallelSupported()` report API presence only.
Compilation or worker startup may still fail because of Content Security
Policy, resource policy, unavailable module workers, or platform limits.

Neither backend hides plaintext from the hosting JavaScript environment or an
attacker capable of runtime instrumentation.

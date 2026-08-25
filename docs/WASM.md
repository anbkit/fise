# FISE 1.1 WASM Integration

The optional WebAssembly backend implements exactly the built-in binary
transform `fise.xor.u8.v1`. It does not change the wire profile.

## Initialize and bind

```ts
import {
  createWasmXorBinaryCipher,
  defaultBinaryProfile,
  fiseBinaryDecrypt,
  fiseBinaryEncrypt,
  isWasmXorBinaryCipherSupported,
  withBinaryBackend
} from "fise";

if (!isWasmXorBinaryCipherSupported()) {
  throw new Error("WebAssembly is required by this deployment");
}

const backend = await createWasmXorBinaryCipher({ maxMemoryPages: 1024 });
const profile = withBinaryBackend(defaultBinaryProfile, backend);

const envelope = fiseBinaryEncrypt(input, profile);
const output = fiseBinaryDecrypt(envelope, profile);
```

Compile once during application or worker initialization and reuse the bound
profile. Each factory call creates an isolated WASM instance and memory.
`maxMemoryPages` is an integer from 1 through 65,536. One page is 64 KiB; the
no-argument default is 1,024 pages, or 64 MiB per instance.

## Implemented boundary

The embedded 112-byte module exports one memory and
`xor_in_place(dataPointer, dataLength, saltPointer, saltLength)`. The wrapper:

- caches module compilation per JavaScript realm;
- grows memory in 64 KiB pages;
- checks page-rounded `input.length + salt.length` against `maxMemoryPages`
  before growth;
- copies input and salt into linear memory;
- copies result into an owned `Uint8Array`;
- clears the used memory window on a best-effort basis; and
- reports absence, compile/instantiate/export failure, and memory failure with
  typed codes.

Headers, profile/context validation, salt generation, marker placement,
assembly, and parsing remain TypeScript. The path is not zero-copy.

## Compatibility rule

Both JS and WASM implementations carry transform ID `fise.xor.u8.v1`. That
built-in ID is reserved for function identities registered internally by FISE;
an arbitrary same-ID callback is rejected. `withBinaryBackend` also runs
deterministic cross-backend encrypt/decrypt, round-trip, mutation, and ownership
checks using salt lengths from the profile range.

An implementation that changes even one output byte needs a new transform ID
and profile ID.

## Failure and fallback

`isWasmXorBinaryCipherSupported()` checks API presence only. Compilation may
still fail because of CSP, runtime policy, or resource limits. FISE does not
silently fall back. Applications may select `xorBinaryCipher` explicitly and
must monitor that choice if performance or policy depends on WASM.

## Memory lifecycle and cap

WebAssembly linear memory cannot shrink. An instance retains its highest grown
page count until the instance is discarded, even after a later small transform.
The wrapper clears the used window best-effort but does not release those pages.
The configured cap makes that retained high-water finite; create a fresh backend
instance if an application needs to discard a temporary high-water allocation.

The cap applies to the WASM transform window, not total process memory. Input,
salt, owned output, TypeScript envelope buffers, runtime overhead, and copies
exist outside that window. Set profile/caller/transport limits independently and
choose a lower `maxMemoryPages` when the 64-MiB default is inappropriate for the
target device.

## CSP

The module bytes are embedded, so no `.wasm` fetch or MIME configuration is
needed. CSP can still block WebAssembly compilation. Test the production policy
in every supported browser; the feature probe cannot predict policy approval.

## Security interpretation

WASM is not an enclave. Browser tooling can observe module bytes, calls, memory,
and plaintext boundaries. Memory clearing is hygiene rather than guaranteed
cryptographic zeroization. The backend neither hides the profile nor upgrades
the built-in XOR transform into cryptographic encryption.

## Performance

Compilation, copies, allocation, and memory growth can dominate small buffers.
Measure cold initialization and full round trips on target devices. The local
benchmark is `npm run benchmark:wasm`; interpretation guidance is in
[PERFORMANCE.md](./PERFORMANCE.md).

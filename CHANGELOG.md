# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added optional constructor-level `ttlSeconds` for every FISE envelope.
  Core stores one absolute wire expiry, binds it into the existing profile
  consistency path, and throws `ENVELOPE_EXPIRED` at the exact half-open second
  boundary across JavaScript, WASM, workers, full/range restore, and progressive
  iterator creation. Profiles and decrypt calls require no TTL configuration.
- Added an explicit `new Fise(profile, { strict: false })` availability mode.
  Recoverable ordinary `encrypt`/`decrypt` failures return their exact input,
  while the default remains strict; expiration and clock failures always throw.
  WASM and parallel runtimes preserve the option, while range/progressive methods, backend
  creation, and closed-pool calls remain strict.
- Added `fise verify <profile-file>` and automatic pre-write profile
  verification. Both exercise encrypt/decrypt round trips for text, adaptive structured
  data, binary full/edge coverage, direct range/progressive restoration, JavaScript ↔ WASM,
  and JavaScript ↔ workers with random synthetic positional context, plus empty
  values with the default context.
- Added `fise help`, command-specific `--help`/`-h`, and `fise --version`.
- Added a packaged CLI reference covering verification, atomic publication,
  replacement compatibility, supported files, exit behavior, and CI usage.
- Added post-generation guidance for monorepo/shared-package and separate-repo
  distribution, shared context contracts, and previous-profile compatibility.
- Added repository `AGENTS.md` instructions and a packaged agent integration
  guide covering one-time generation, destination questions, exact copying,
  fingerprint verification, and frontend/backend ownership.
- Added optional constructor-level binary edge coverage with a wire-bound
  symmetric policy. `edgeBytes` is optional and defaults to 1 MiB per side. It
  transforms metadata plus the first and last resolved bytes while leaving the
  middle directly inspectable.
- Added canonical unpadded Base64URL output for text and structured data while
  retaining binary output for top-level binary input.
- Added deterministic adaptive LZ4 for structured payloads. Core uses compressed
  form only when its complete internal representation is smaller, bounds exact
  restoration, and preserves canonical JSON validation.
- Added a structured transport benchmark comparing raw and FISE JSON under
  identity, gzip, and Brotli, and included its machine-readable result in
  release-candidate evidence.
- Added an actual loopback HTTP example for JSON and binary responses, a web
  application integration guide, schema-validation guidance, client-visible
  context rules, Profile rollout guidance, and clock-skew guidance.
- Added an actual SSE agent-stream example that restores independently encrypted
  text deltas, tool events, and completion events with ordered stream context.
- Added a packed Vite production-build gate that exercises the emitted FISE
  module worker, JavaScript, WASM, adaptive structured transport, and
  backend-produced JSON/binary HTTP responses in Chromium.
- Added a packaged FISE 2.0 conformance corpus with one immutable generated
  Profile and golden canonical JSON, IEEE-754 number, UTF-8, deterministic and
  malformed LZ4, compression-threshold, payload, Base64URL, full/edge binary,
  range/progressive, context, TTL-boundary, malformed wire, and invalid-input
  vectors.

### Changed

- Frozen structured canonicalization to the RFC 8785 representation for
  accepted values, including raw UTF-16 property ordering, exact ECMAScript
  binary64 number text, no Unicode normalization, and explicit rejection of
  unpaired surrogates. FISE continues to reject negative zero.
- Renamed the generated layout ABI field from ambiguous
  `encodedContextLength` to `operationBindingLength`; it is normatively the
  wire-policy-bound `B.length`, including TTL and edge bindings when present.
- Hardened public byte, context, options, range, and progressive-signal
  boundaries so hostile proxies, spoofed typed arrays, and detached buffers
  produce stable `FiseError` codes; raw fallback now preserves exact input
  identity for these ordinary-operation failures.
- Replaced the secondary framed container with direct range and progressive
  restoration from one ordinary FISE envelope. Selected reverse work uses
  logical absolute offsets and skips clear middle bytes in edge mode.
- Generated stage shifts now sample only distinct positions in the selected
  context segment, eliminating modulo-equivalent shift parameters.
- WASM execution traps are distinguished from memory-limit failures, and both
  main-thread and worker paths clear used linear memory on failure as well as
  success.
- Clarified that generated source is a versioned artifact applications treat as
  immutable, the imported `Profile` instance is frozen, and its fingerprint is
  an opaque compatibility identifier rather than source attestation.
- Generated Profile modules no longer include banner comments. Verification
  now recognizes the canonical generated import/export shape and rejects
  comments in generated source.
- `fise generate <output-file>` now refuses existing files by default. Use
  `--override` for an explicit, verified atomic replacement. New files are
  also fully written before atomic no-clobber publication.
- Streamlined the README into a plain-language, problem-first introduction and
  a five-step frontend/backend adoption path with realistic API-boundary
  examples, focused navigation, and detailed behavior delegated to dedicated
  documents.
- Documented the raw fallback union, plaintext/pass-through risk, lack of a
  trusted success discriminator, and the application validation and monitoring
  required before opting in.
- Changed TTL capture to round the producer's partial second upward, so a
  configured lifetime is never shortened by almost one second.
- Split browser and Node worker startup so browser bundlers do not resolve the
  Node builtin, and removed top-level await from the worker entry for production
  worker-bundle compatibility.
- Reduced synchronous binary range/full-restore copying for ordinary local byte
  input while retaining owned snapshots for hostile, shared, progressive, and
  asynchronous inputs.
- Allowed progressive options as the second argument when no context is used:
  `decryptProgressive(envelope, { chunkSize })`.

## [2.0.0] - 2026-08-26

FISE 2.0 is a clean package and wire redesign. Producers and consumers must
upgrade together and regenerate stored, queued, or cached envelopes. No 1.x API
or decoder is retained.

### Breaking changes

- Replaced every public function entry point with a profile-bound `Fise` class:
  `new Fise(generatedProfile).encrypt(data, context)` and `decrypt(...)`.
- Removed string/binary profile types, default profiles, `FiseBuilder`, public
  profile definitions, manifests, rotation artifacts, time-window rules,
  conformance subpaths, and HTTP/JSON-specific encryption APIs.
- Replaced separate string and binary wires with one strict binary FISE 2.0
  envelope and one byte-only generated Profile ABI. Text and structured input
  use canonical unpadded Base64URL as an outer JSON-safe representation.
- Added a transformed payload metadata segment that restores either a canonical
  JSON-safe value—including strings—or raw binary bytes through the same API.
- Removed the secondary FISF/framed container; full, range, and progressive
  binary restoration use the same ordinary envelope.
- Replaced semantic context objects and per-envelope salt with an optional
  positional scalar array. The profile derives a circular Base64URL context
  segment, and package 2.0 envelopes without TTL are deterministic for equal
  inputs.
- Removed the independent Python 1.1 reference because generated profile code,
  rather than a reproducible manifest, is now the compatibility artifact.

### Added

- Added `fise generate <output-file>`, a stateless generator that uses CSPRNG
  input once per invocation and emits a new immutable `Profile` instance.
- Added typed reversible generation IR, automatic inverse derivation, semantic
  dead-stage rejection, fused JavaScript kernels, generated WASM compilation,
  opaque semantic fingerprints, and atomic output writes.
- Added one structured/binary codec with strict canonical JSON, plain-data and
  context validation, transformed data-type metadata, and owned byte outputs.
- Added generated context-segment offset/length parameters and passed the frozen
  positional context snapshot through mixer, offset, marker, forward, and
  reverse callbacks.
- Added profile-bound `decryptRange` and `decryptProgressive` methods for direct
  selective and pull-driven restoration from an ordinary binary envelope.
- Added explicit full and edge binary coverage. Edge mode lowers kernel work by
  leaving its declared middle region untransformed and is documented as weaker
  coverage rather than confidentiality.
- Added `withWasm()` and retained `parallel()` runtimes compiled from the same
  generated Profile semantics, including cross-backend coverage/range parity tests.
- Added the FISE 2.0 specification, generated-Profile documentation, a new
  security boundary and whitepaper, and six dependency-free examples covering
  session-bound API, binary restoration, backends, and failure boundaries.
- Added a plain-language Profile/context mental model and realistic short-lived
  session, user, tenant, connection, resource, and sequence examples.
- Added strict TypeScript compatibility for generated `.ts` profile modules
  and JSON-compatibility inference for ordinary named domain interfaces.

### Hardening

- Enforced canonical JSON and Base64URL on restore, early envelope-size checks,
  canonical coverage headers, and bounded selected work for async worker-backed
  operations.
- Bound TTL and edge-coverage policy into the Profile/context consistency path
  before any range or progressive content is returned.
- Restricted generated `Profile` construction, mixer lanes, structured object
  and array prototypes, and proxy wrappers; snapshotted caller-owned bytes
  through typed-array intrinsics before profile callbacks; and made closed
  parallel runtimes reject every operation consistently.
- Made worker adapters retain fatal lifecycle state so current and future work
  rejects instead of hanging after an unexpected worker exit.
- Added a packed real-browser smoke surface for generated profiles, WASM,
  module workers, binary full/edge coverage, and direct restoration under a
  restrictive CSP with a hashed import map.
- Promoted the packed Chromium smoke to an automated CI, release-check, and
  exact-tarball release-evidence gate.

### Security

- Clarified that generated execution diversity targets profile-specific static
  adaptation cost and does not provide cryptographic confidentiality,
  authenticity, integrity, authorization, cryptographic expiry, revocation,
  replay prevention, or resistance to runtime instrumentation.
- Documented deterministic equality leakage and that omitted context-derived
  data is neither a secret key nor an authentication mechanism.

## [1.2.0] - 2026-08-26

Package `1.2.0` keeps the ordinary FISE wire at `1.1` and the framed FISF wire
at `1.0`. No public runtime export is renamed or removed.

### Added

- Added deterministic `benchmark:framed` and `benchmark:worker` suites with
  correctness preflights, mean/median/P95/P99/standard deviation, operation and
  throughput statistics, raw samples on request, scoped process-memory
  observations, and machine-readable non-claims.
- Added framed matrices for full, aligned/unaligned selective range, iterator
  creation, first/fixed pulls, complete drain, frame selection, and wire
  overhead; added worker matrices for local versus one/two/four-worker startup,
  first/warm operations, ordinary round trips, FISF restore, and close.
- Added instrumented FISF tests proving exact selected-frame transform counts,
  no hidden progressive prefetch, early stop, abort-on-next-pull, caller-input
  snapshot ownership, empty behavior, and synchronous outer-index validation.
- Added `release:candidate`, an external `fise.release-evidence/1` bundle,
  `SHA256SUMS`, exact-tarball verification, and a version-tag GitHub Actions
  workflow with no npm publication token or automatic publish step.

### Changed

- Clarified the README, whitepaper, specification, profile guidance, security
  boundary, and evaluation protocol around one consistent positioning: FISE
  targets a measurable client adaptation gap through a public profile-as-code
  contract and keyless built-in profiles, without claiming that client-visible
  data becomes secret or cryptographically protected.
- Named the existing pull-driven `FISF` progressive behavior **lazy frame
  decrypt**, scoped strictly to deferred independent-frame work—not transport
  streaming, ordinary-envelope laziness, or lazy JSON/application values.
- Added concise fit/non-fit guidance, a FISF mental model, and an early-stop
  progressive example without turning the README into a protocol duplicate.
- Aligned npm keywords with the actual application-protocol, framing,
  interoperability, WebAssembly, worker, restoration, and obfuscation scope.

### Fixed

- Package verification now derives the expected package version from metadata
  instead of pinning `1.1.0`, while still asserting package/lock agreement and
  zero runtime dependencies.
- Packed-consumer and packed-browser verification can consume a caller-supplied
  tarball, so release evidence validates the exact artifact whose digest is
  recorded instead of silently packing a second artifact.

## [1.1.0] - 2026-08-26

### Breaking changes

- Replaced the implicit 0.x format with strict versioned string and binary
  envelopes. Version 1.1 rejects every magic-less legacy envelope.
- Replaced `FiseRules`, default rule objects, and `FiseBuilder` with atomic
  `FiseStringProfile` and `FiseBinaryProfile` compatibility units.
- Profiles now own transform, layout, context contract, limits, representation,
  and public identity. Operation-level cipher overrides were removed.
- Removed `decodeLength`, salt-length candidate discovery, and custom salt
  placement/extraction. The header declares length and the tail owns salt.
- Changed the default string XOR serialization to lossless two-byte UTF-16 code
  units plus canonical base64. Existing string envelopes must be regenerated.
- Removed the `Math.random` fallback. Salt generation now requires Web Crypto
  and fails with `RANDOM_UNAVAILABLE` when unavailable.
- Defined ESM-only root, `fise/conformance`, `fise/profiles`, and `fise/http`
  package exports.
- Raised the supported Node runtime floor to Node 20 because 1.1 requires
  default global Web Crypto and does not install a weak randomness fallback.

### Added

- `defineStringProfile()`, `defineBinaryProfile()`, and frozen default profiles.
- `resolveFiseTimeWindow()` for deterministic half-open Unix-millisecond
  windows with explicit duration/origin, safe-integer validation, and no hidden
  clock or adjacent-window fallback.
- Eight dependency-free runnable examples covering strings, binary data,
  worker execution, framed range/progressive restoration, JSON/HTTP, time
  windows, WASM backend policy, and profile rotation; release verification also
  executes them from the installed npm tarball.
- Canonical `fise.profile/1` compiler with normalized JSON, SHA-256, compact
  128-bit digest-prefix profile IDs, full-digest artifacts, exhaustive
  salt-range layout validation, and deterministic vectors.
- `fise.profile-rotation/1` diffs with changed paths, atomic-rollout signal, and
  explicit `legacyFallback: false`.
- `fise profile validate|build|vectors|diff` executable CLI.
- Binary-first UTF-8, JSON, and strict `Response` helpers under `fise/http` with
  exact media version/profile checks and declared-length prechecks.
- Optional `createWasmXorBinaryCipher()` backend with an embedded 112-byte WASM
  module, async initialization, isolated instance memory, configurable retained
  page cap, and explicit failure.
- `isWasmXorBinaryCipherSupported()` runtime API-presence check.
- `fiseBinaryEncryptAsync()` and `fiseBinaryDecryptAsync()` with strict backend
  identity, caller-input snapshots, cancellation, and ordinary 1.1 wire parity.
- `createParallelXorBinaryCipher()` with dedicated Node/browser module workers,
  absolute salt-offset chunking, configurable worker count/local threshold,
  typed startup/runtime failure, and explicit `close()` lifecycle.
- Opt-in `FISF` framed binary 1.0 container with exact profile/count/length
  header, contiguous absolute index, bounded independent inner 1.1 envelopes,
  full restore, half-open range restore, and pull-driven progressive byte
  restore.
- Framed APIs consume a complete in-memory container and produce bytes; they do
  not implement HTTP range fetching, streaming input, or lazy JSON parsing.
  Selective range restore validates the outer container and selected frames,
  not skipped inner envelopes.
- Canonical deterministic `FISF` conformance helper/vector and malformed index,
  selective-frame, range, cancellation, worker, packed-consumer, and real-
  browser tests.
- `withBinaryBackend()` with reserved built-in implementation identity and
  profile-range semantic checks.
- JS/WASM byte parity, memory-growth, and cross-backend envelope tests.
- Deterministic arbitrary UTF-16 and byte-array property sweeps.
- Standard-library Python reference for compiled binary artifact identity,
  byte-identical vector encode/decode, and fail-closed interoperability checks.
- Packed-artifact verification that installs the generated tarball into an
  empty consumer and exercises ESM/subpath imports, JS/WASM round trips, and
  bundled reference artifacts.
- Packed-browser smoke serving under a restrictive CSP, including manifest,
  HTTP, string, JavaScript/WASM parity, cross-backend, and memory-limit checks.
- A pre-publish release gate covering Node tests, Python interoperability,
  documentation/types, package exports, and an empty-consumer tarball check.
- Runtime adaptation benchmark with machine-readable claim exclusions.
- Machine-readable string/WASM benchmarks with median, P95, P99, standard
  deviation, throughput, warmup/iteration metadata, and wire-size reporting.
- Browser smoke harness plus WASM, HTTP, manifest, rotation, adaptation, and
  migration guides.
- Dedicated `npm run benchmark:wasm` command.
- Dedicated `npm run benchmark:adaptation` command.
- Deterministic string and binary golden-envelope helpers in the separate
  `fise/conformance` export.
- `FiseError` and stable error codes for inputs, profiles, context, transforms,
  headers, lengths, markers, payloads, randomness, runtime, and WASM failures.
- `maxEnvelopeLength` pre-parse bounds for string and binary decryption.

### Changed

- Expanded FISE as **Fast Interoperable Structured Envelope**, replacing the
  previous expansion to avoid implying a cryptographic security property while
  preserving the package and API name.
- Every envelope now carries exact wire version, profile ID, salt length, and
  transformed length; decoders reject unsupported versions, wrong profiles,
  truncation, and trailing data.
- The marker is recomputed from declared layout inputs and context; it is no
  longer decoded as a source of length truth.
- Compiled affine offsets use exact `BigInt` arithmetic and positive modulo of
  transformed length, so context terms are not lost to clamping.
- Salt content and unbiased salt-length selection use
  `crypto.getRandomValues` exclusively.
- Binary salt now uses the full byte range instead of UTF-8 alphanumeric bytes.
- The whitepaper, specification, security guidance, platform matrix, and roadmap
  distinguish implemented framing, measured adaptation hypotheses, proposed
  work, and the default XOR profile's cryptographic boundary.
- The whitepaper now separates stable protocol narrative from revision-specific
  release evidence, includes related-work positioning and architecture/wire/
  rollout diagrams, and distinguishes manifest-compiled from application-defined
  runtime profiles.
- Public `encrypt`/`decrypt` JSDoc now warns at autocomplete level that built-in
  profiles do not provide cryptographic confidentiality, authenticity, or
  integrity.
- Package metadata now advertises the actual ESM-only build instead of mapping
  the CommonJS `require` condition to an ESM file.

### Fixed

- Context schemas now reject missing, forbidden, undeclared, and wrongly typed
  values before layout execution.
- Profile definition validates identity, representation, transform identity,
  salt bounds, marker width, context schema, limits, and manifest digest shape.
- String benchmark throughput now converts milliseconds to seconds correctly
  and no longer rewrites performance documentation as a side effect.
- Builds now clean the validated `dist` target before TypeScript compilation so
  npm packages cannot retain obsolete generated entry points.
- Builds now mark the generated CLI executable and the package gate verifies
  its mode before publishing.
- Packed-artifact verification clears an inherited npm dry-run flag for its
  nested local pack, so `npm publish --dry-run` still installs and tests a real
  temporary tarball.
- Packed-consumer and browser-smoke commands build their own `dist` input, so
  each release gate can run independently from a clean checkout.
- Binary XOR backends reject an empty salt for non-empty input instead of
  producing invalid output or trapping.
- The string XOR backend now rejects the same invalid empty-salt case.
- String XOR now round-trips every JavaScript UTF-16 code unit, including lone
  surrogates, without lossy UTF-8 replacement.
- HTTP JSON helpers reject invalid UTF-8, malformed JSON, and values without a
  JSON representation using typed errors.
- Normalized manifests, compiled results, artifacts, and rotation data are now
  deeply immutable, so digest/profile identity cannot drift after compilation.
- Manifest salt bounds and both marker-width forms reject type-coerced values.
- HTTP readers enforce configured decoded-envelope bounds while streaming,
  cancel promptly on overflow, and distinguish compressed representation length
  from Fetch-decoded body length.
- Built-in string and binary transform IDs reject unregistered callback
  implementations, and their canonical exported objects are immutable;
  validation now exercises transform semantics within the profile salt range.
- Runtime operations snapshot plain own options, metadata, and mutable profile
  inputs once; accessors and symbol keys fail closed instead of changing values
  between validation and execution.
- HTTP readers retain one normalized profile/context owner across asynchronous
  body reads, preventing media-profile and envelope-profile drift.
- Cross-realm `Uint8Array` values use one shared validation rule throughout
  binary parsing, HTTP, manifests, and transform conformance.
- Locked response streams, invalid compile/profile arguments, and oversized
  random-salt requests now fail with typed FISE errors.
- WASM growth is page-rounded and capped at 1,024 pages by default, ignores
  inherited option pollution, and normalizes instantiation failures with cause.

## [0.1.5]

### Breaking Changes
- **Function Naming Convention**: Standardized all function names with `fise` prefix for better discoverability
  - `encryptFise()` → `fiseEncrypt()`
  - `decryptFise()` → `fiseDecrypt()`
  - `encryptBinaryFise()` → `fiseBinaryEncrypt()`
  - `decryptBinaryFise()` → `fiseBinaryDecrypt()`
  - **Migration**: Update all function calls in your code:
    ```ts
    // Before
    import { encryptFise, decryptFise, encryptBinaryFise, decryptBinaryFise } from 'fise';
    const encrypted = encryptFise(text, xorCipher, rules);
    const decrypted = decryptFise(encrypted, xorCipher, rules);

    // After
    import { fiseEncrypt, fiseDecrypt, fiseBinaryEncrypt, fiseBinaryDecrypt } from 'fise';
    const encrypted = fiseEncrypt(text, rules);
    const decrypted = fiseDecrypt(encrypted, rules);
    ```
- **Cipher Parameter Moved to Options**: Cipher is now optional and defaults to `xorCipher`/`xorBinaryCipher`
  - More ergonomic API - most users don't need to specify cipher
  - Cipher can still be customized via `options.cipher` or `options.binaryCipher`
  - **Migration**: Remove `cipher` parameter from function calls:
    ```ts
    // Before
    fiseEncrypt(text, xorCipher, rules);
    fiseDecrypt(envelope, xorCipher, rules);
    fiseBinaryEncrypt(data, xorBinaryCipher, rules);

    // After (default cipher)
    fiseEncrypt(text, rules);
    fiseDecrypt(envelope, rules);
    fiseBinaryEncrypt(data, rules);

    // Or with custom cipher
    fiseEncrypt(text, rules, { cipher: myCustomCipher });
    fiseBinaryEncrypt(data, rules, { binaryCipher: myCustomBinaryCipher });
    ```
- **File Naming**: Source files renamed to match function names
  - `src/encryptFise.ts` → `src/fiseEncrypt.ts`
  - `src/encryptBinaryFise.ts` → `src/fiseBinaryEncrypt.ts`
  - Test files also renamed: `encryptFise.test.mjs` → `fiseEncrypt.test.mjs`, etc.

### Changed
- **API Simplification**: Default cipher (`xorCipher`/`xorBinaryCipher`) is now used automatically
  - Reduces boilerplate for common use cases
  - Still allows custom ciphers when needed via options
- **Documentation**: Updated all documentation files to reflect new API:
  - All code examples updated to use new function names
  - All examples updated to use simplified API (cipher in options)
  - Updated `QUICK_START.md`, `PLATFORM_SUPPORT.md`, `BUILDER.md`, `BINARY_ENVELOPE.md`
  - Updated README.md and all other documentation files

### Fixed
- All 188 tests passing with new API
- Comprehensive test coverage for all presets and edge cases

## [0.1.4]

### Breaking Changes
- **Timestamp API**: Changed from `timestampMinutes` to `timestamp` in `EncryptOptions` and `DecryptOptions`
  - More flexible - accepts any numeric timestamp value (not limited to minutes)
  - Rules can interpret timestamp as needed (minutes, seconds, milliseconds, etc.)
  - **Migration**: Replace `timestampMinutes` with `timestamp` in your code:
    ```ts
    // Before
    fiseEncrypt(data, cipher, rules, { timestampMinutes: 12345 });
    fiseDecrypt(envelope, cipher, rules, { timestampMinutes: 12345 });

    // After
    fiseEncrypt(data, cipher, rules, { timestamp: 12345 });
    fiseDecrypt(envelope, cipher, rules, { timestamp: 12345 });
    ```

### Added
- **Binary Encryption Support**: Pure binary encryption/decryption for video, images, and other binary data
  - `fiseBinaryEncrypt()` - Encrypts binary data (Uint8Array) with pure binary envelopes (no base64 conversion)
  - `fiseBinaryDecrypt()` - Decrypts binary envelopes back to original binary data
  - `xorBinaryCipher` - Binary-optimized XOR cipher that operates directly on Uint8Array (no string conversion)
  - `defaultBinaryRules` - Binary-native rules optimized for Uint8Array operations
  - `randomSaltBinary()` - Generates random binary salt as Uint8Array
- **Rules Sharing**: String and binary encryption can now share the same `FiseRules` interface
  - Text-based rules automatically adapt to binary operations via `normalizeFiseRulesBinary()`
  - Binary-native rules (`FiseRules<Uint8Array>`) for optimal performance
  - Seamless interoperability between string and binary encryption modes
- **Metadata Support**: Added `metadata` field to `FiseContext`, `EncryptOptions`, and `DecryptOptions`
  - Pass custom values (e.g., `productId`, `userId`) to rules via `metadata` object
  - Rules can access metadata via `ctx.metadata?.productId`
  - Enables per-item encryption patterns (e.g., different encryption per product ID)
  - Metadata must match between encryption and decryption
- **Comprehensive Binary Test Suite**: Added `fiseEncryptBinary.test.mjs` with 28 tests covering:
  - Basic binary encryption/decryption roundtrips
  - Large binary data (1MB+)
  - Video-like data (random bytes, 50KB+)
  - Edge cases (empty, single byte, all zeros, all 255s)
  - UTF-8 encoded text as binary
  - Image-like data (PNG headers)
  - Error handling (invalid envelopes, mismatched timestamps/metadata)
  - Rules sharing between string and binary modes
- **Performance Optimizations**:
  - Binary envelopes avoid base64 conversion overhead
  - Direct Uint8Array operations for maximum speed
  - Optimized for large file encryption (videos, images)

### Changed
- **File Naming**: All imports updated to use new file name
- **Type System**: Enhanced `FiseRules<T>` to support both `string` and `Uint8Array` generics
  - `FiseRules<string>` for text-based encryption
  - `FiseRules<Uint8Array>` for binary encryption
  - Shared rules can work with both modes

### Fixed
- All 141 tests passing with binary encryption support

## [0.1.3]

### Breaking Changes
- **FiseRules interface simplified**: Now only requires 3 core methods (`offset`, `encodeLength`, `decodeLength`). All other methods are optional and handled internally with secure defaults.
- **Removed interfaces**: `SimpleFiseRules`, `MinimalFiseRules`, `UltraMinimalFiseRules` - use `FiseRules` for all cases.
- **Removed from FiseRules**: `encodedLengthSize`, `saltPosition`, `preExtractLength`, `scanForEncodedLength` - these are now internal.
- **EncryptOptions simplified**: Removed `minSaltLength` and `maxSaltLength` - use `rules.saltRange` instead:
  ```ts
  // Before
  fiseEncrypt(text, cipher, rules, { minSaltLength: 20, maxSaltLength: 50 });

  // After
  const rules = { ...defaultRules, saltRange: { min: 20, max: 50 } };
  fiseEncrypt(text, cipher, rules);
  ```

### Added
- **FiseBuilder**: Fluent API for constructing FiseRules with 12 preset methods:
  - `FiseBuilder.defaults()` - Default configuration
  - `FiseBuilder.simple(multiplier, modulo)` - Simple timestamp-based offset
  - `FiseBuilder.timestamp(multiplier, modulo)` - Timestamp-based with different primes
  - `FiseBuilder.fixed()` - Fixed middle position
  - `FiseBuilder.lengthBased(modulo)` - Length-based modulo
  - `FiseBuilder.prime()` - Large prime numbers
  - `FiseBuilder.multiFactor()` - Multi-factor calculation
  - `FiseBuilder.hex()` - Hex encoding
  - `FiseBuilder.base62()` - Base62 encoding
  - `FiseBuilder.base64()` - Base64 charset encoding
  - `FiseBuilder.xor()` - XOR-based offset
  - `FiseBuilder.customChars(chars)` - Custom character set
- **FiseBuilderInstance**: Fluent builder with methods:
  - `withOffset()`, `withEncodeLength()`, `withDecodeLength()`
  - `withSaltRange()`, `withHeadSalt()`, `withCustomSaltExtraction()`
- **normalizeFiseRules()**: Internal function that fills in optional methods with secure defaults
- **Comprehensive test suite**: Added `builder.test.mjs` with 43 tests covering all builder functionality

### Changed
- **FiseRules interface**: Simplified to only require 3 security points (offset, encodeLength, decodeLength)
- **fiseEncrypt/fiseDecrypt**: Updated to use simplified FiseRules interface with internal normalization
- **defaultRules**: Simplified implementation to match new interface
- **Documentation**: Major updates across all docs:
  - Created comprehensive `QUICK_START.md` with backend/frontend examples
  - Merged `DEVELOPER_EMPOWERMENT.md` into `QUICK_START.md`
  - Removed `ARCHITECTURE.md` (consolidated into `WHITEPAPER.md`)
  - Updated README with clear backend/frontend code separation and sample outputs
  - Added sample encrypted/decrypted text to all documentation examples
  - Added multi-language and multi-platform support details
  - Added WebAssembly for Smart TV support

### Removed
- `builder.example.ts` - Examples now in documentation
- `scanningRules.example.ts` - No longer needed with simplified API
- `ARCHITECTURE.md` - Consolidated into `WHITEPAPER.md`
- `DEVELOPER_EMPOWERMENT.md` - Merged into `QUICK_START.md`

### Fixed
- All tests updated for simplified API
- Internal method tests removed (now handled by normalizeFiseRules)

## [0.1.2]

### Changed
- **Breaking**: Updated import paths for cleaner usage. Users can now import directly from `fise` without specifying the `dist/` directory:
  ```ts
  // Before
  import { fiseEncrypt } from 'fise/dist/fiseEncrypt';
  import { defaultRules } from 'fise/dist/rules/defaultRules';

  // After
  import { fiseEncrypt, fiseDecrypt, defaultRules } from 'fise';
  ```
- Added `exports` field to `package.json` for modern Node.js module resolution
- Created main entry point at `src/index.ts` that exports all public APIs
- Updated README with new import examples

### Added
- Main entry point (`src/index.ts`) exporting all public APIs:
  - `fiseEncrypt`, `fiseDecrypt`
  - `xorCipher`
  - `defaultRules`, `scanningRulesExample`
  - All TypeScript types

## [0.1.1] - Hotfix

### Fixed
- **Unicode support** in `toBase64()` and `fromBase64()` utility functions:
  - **Node.js**: Now uses `Buffer.from(str, 'utf8')` for proper UTF-8 handling
  - **Browser**: Converts strings to UTF-8 bytes before `btoa()`, and properly decodes from `atob()`
  - Fixes issues with Unicode characters (emojis, non-ASCII text) in encrypted payloads

## [0.1.0] - Initial Release

### Added
- Initial TypeScript implementation of FISE core pipeline
- Rule-based, keyless envelope design
- Default rules implementation (`defaultRules`)
- XOR cipher implementation (`xorCipher`)
- Core encryption/decryption functions (`fiseEncrypt`, `fiseDecrypt`)
- Comprehensive test suite covering:
  - Basic functionality and roundtrips
  - Edge cases (empty strings, long strings, JSON, Unicode)
  - Error handling
  - Options and configuration
- Performance benchmark script (`benchmark.ts`)
- Documentation:
  - Whitepaper (`docs/WHITEPAPER.md`)
  - Architecture guide (`docs/ARCHITECTURE.md`)
  - Security model (`docs/SECURITY.md`)
  - Performance metrics (`docs/PERFORMANCE.md`)
  - Rules documentation (`docs/RULES.md`)
  - Use cases (`docs/USE_CASES.md`)
  - Specification (`docs/SPEC.md`)

[Unreleased]: https://github.com/anbkit/fise/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/anbkit/fise/compare/v1.2.0...v2.0.0
[1.2.0]: https://github.com/anbkit/fise/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/anbkit/fise/releases/tag/v1.1.0
[0.1.5]: https://github.com/anbkit/fise/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/anbkit/fise/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/anbkit/fise/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/anbkit/fise/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/anbkit/fise/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/anbkit/fise/releases/tag/v0.1.0

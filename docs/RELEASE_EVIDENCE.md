# FISE 1.1 Release Evidence

This document records revision-specific execution evidence. It is intentionally
separate from the stable specification and whitepaper. A working-tree result is
not a release certification. The exact release commit, tag, and packed-artifact
digest must be recorded outside the packed artifact, for example in the signed
GitHub release or provenance statement.

The digest cannot be embedded in this document and remain the digest of the
same package because this document is itself included in that package. The same
self-reference applies to embedding a commit's own ID in a file in that commit.

## Evidence rules

Every external release record should include:

- commit and clean/dirty state;
- package version and tarball digest;
- runtime, OS, architecture, and browser versions;
- exact commands and pass/fail counts;
- benchmark configuration plus machine-readable output;
- package file count/size and empty-consumer checks; and
- explicit exclusions such as untested browsers, devices, CSP, or hosted CI.

## Working-tree snapshot — 2026-08-26

- Base commit: `e4e58a606d62c6f07ad7349bf2b71cb511ddf777`
- State: dirty, unpublished FISE `1.1.0` working tree
- Host: macOS 26.5.2 arm64

| Gate | Environment | Result | Boundary |
| --- | --- | --- | --- |
| Full release gate | Node `v22.14.0`, npm `10.9.2` | Pass; 189/189 Node tests, 8/8 packed public examples, 4/4 Python tests, 20 linked Markdown documents, public types/package, and empty-consumer tarball | Local dirty tree; Node 20 and hosted CI not rerun for these additions |
| Async worker backend | Node `v22.14.0` worker threads | Pass; absolute salt-offset parity, sync/async ordinary-wire cross-decode, threshold, reserved identity, cancellation, close, packed install | Functional/conformance evidence; no throughput or responsiveness claim |
| Framed binary | Node `v22.14.0` | Pass; canonical `FISF` vector, empty/full/range/progressive, selected-frame failure boundary, malformed index/version/range/bounds, worker composition | Complete in-memory container; no HTTP range, streaming input, or lazy JSON claim |
| Packed consumer | Node `v22.14.0`, npm `10.9.2` | Pass; 99 package entries; root/subpath imports plus JS, WASM, worker, framed, examples, and reference checks | Generated working-tree tarball; final digest belongs in the external release record |
| Packed-browser smoke | Headed Chrome `151.0.0.0` | Pass; exact page status `PASS: packed manifest + time window + CSP + HTTP + string + JS/WASM/worker + framed range/progressive`; 31/31 HTTP 200 including two worker-module loads; 0 console errors/warnings | Installed working-tree tarball under same-origin module/worker plus WASM CSP; not Firefox, WebKit, mobile, or deployed CSP |

The browser run used `worker-src 'self'` and loaded
`dist/workers/xorWorker.js` twice for a two-worker pool. It exercised ordinary
async 1.1 interoperability plus framed full/range/progressive restoration. The
tarball was generated immediately before this evidence text was updated; as
with the digest self-reference described above, final release identity must be
recorded externally after the tracked content stops changing.

No worker startup/transfer crossover, aggregate-throughput comparison,
main-thread responsiveness, remote-range, incremental-input, or lazy-JSON
benchmark was run. The added browser result is one Chromium-family runtime, not
a broader support matrix.

## Working-tree snapshot — 2026-08-25

- Base commit: `38a645eb6a2df5e9bff3c00d3f14dd0003beafb4`
- State: dirty, unpublished FISE `1.1.0` working tree
- Host: macOS 26.5.2 arm64

| Gate | Environment | Result | Boundary |
| --- | --- | --- | --- |
| TypeScript build | Node `v20.20.2` and `v22.14.0` | Pass | Local source build |
| Node tests | Node `v20.20.2` and `v22.14.0` | 169/169 pass on each runtime | Local test suite; hosted CI not run |
| Python binary reference | Python `3.12.13` | 4/4 pass | Manifest-compiled binary subset only |
| Package and packed consumer | Node `v20.20.2` and `v22.14.0`, npm `10.9.2` | Pass; 76 package entries; root/subpath imports, JS/WASM round trips, and bundled reference artifacts checked | Dirty working-tree package; not a release identity |
| Packed-browser smoke | Headless Chrome `151.0.0.0` | Pass; profile `browser.smoke.v1.4b6f89108f357d4b97e4bf46b6f5737c`; 24/24 HTTP 200; 0 console errors/warnings | Installed working-tree tarball under the repository's restrictive CSP; not Firefox/WebKit or a deployed CSP |

The browser snapshot exercised manifest compilation, strict HTTP/JSON, string
framing, JavaScript binary, WASM binary, JS/WASM parity, cross-backend decoding,
and the WASM memory limit. Its CSP permits same-origin modules and
`'wasm-unsafe-eval'` while blocking inline script. It does not certify Firefox,
WebKit, mobile, embedded webviews, or a deployment's independently configured
CSP.

### Scoped performance snapshot

Node `v22.14.0`, macOS arm64, sequential local runs:

- 1 MiB JavaScript full binary round trip: 3.490 ms mean, 3.460 ms
  median, 3.793 ms P95, 0.123 ms standard deviation over 100 iterations after
  20 warmups;
- 1 MiB WASM full binary round trip: 1.378 ms mean, 1.368 ms median,
  1.449 ms P95, 0.045 ms standard deviation under the same sampling policy;
- WASM cold compile plus first instance: one 0.213 ms sample;
- cached WASM instance creation: 0.017 ms mean and 0.026 ms P95 over 50
  iterations after five warmups; and
- 26,958-byte JSON: plaintext parse 0.046 ms mean, minimal versioned binary
  envelope 0.048 ms, and known-profile FISE 0.080–0.082 ms over 500 iterations
  after 20 warmups.

These values are local summary statistics. They do not include a stored raw-
sample artifact, allocation/GC, browser main-thread, worker, mobile/device,
power, network, or human adaptation measurements.

### Regression snapshots to preserve

An earlier Node 22 loopback Fetch check restored a 65,637-byte decoded FISE
envelope whose gzip representation and declared transport length were 17,759
bytes. This is a focused regression scenario, not HTTP-stack certification.

## External final release record — pending

After creating the clean release commit, run these commands without changing
tracked package content afterward:

```sh
npm test
npm run verify:examples
npm run verify:interop
npm run verify:package
npm run verify:packed
npm run verify:browser:serve
```

Open the printed loopback URL in each target browser and require the page to
report `data-status="pass"` with no console errors. The server installs the
actual tarball into an empty consumer and applies a CSP that permits same-origin
modules and WebAssembly compilation but blocks inline script execution.

Copy the final commit, tag, package entry count/size, and SHA-256 emitted by
`verify:packed` into the release notes or signed provenance statement. Required
but not yet established by this working-tree record:

- hosted Node 20/22 CI for the final revision;
- clean-tree commit/tag identity plus repeat of the packed-consumer gate;
- deployed-environment confirmation under its actual CSP;
- broader Chromium/Firefox/WebKit and representative device evidence; and
- controlled human adaptation-study results.

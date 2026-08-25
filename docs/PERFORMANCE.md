# FISE 1.1 Performance

## Complexity

String and binary encode/decode are linear in transformed payload size. Header,
profile, and marker work are bounded and do not scan the salt range. The
ordinary-envelope API allocates complete transformed and envelope buffers.

The string default expands each JavaScript UTF-16 code unit to two bytes, then
base64. The binary default avoids base64 but still allocates an envelope and a
restored output buffer.

The worker backend also performs linear transform work, but copies owned chunks
to dedicated workers and assembles one complete output. `FISF` framing adds one
inner 1.1 envelope per frame plus an 8-byte index entry; range restore performs
work proportional to the intersecting frames, not the requested boundary bytes
alone. Progressive restore holds the complete outer container but limits
transform/output work to one consumer-pulled frame at a time.

## Benchmarks

Run these commands from a repository checkout with development dependencies
installed:

```sh
npm run benchmark -- --json
npm run benchmark:wasm -- --json
npm run benchmark:adaptation -- --json
npm run benchmark:framed -- --json
npm run benchmark:worker -- --json
```

The string suite reports encryption/decryption mean, median, P95, P99, standard
deviation, throughput, warmup/iteration counts, and wire size for 100 B through
50 KB ASCII inputs.

The WASM suite separates:

- cold module compilation plus first instance;
- cached instance creation;
- raw JavaScript/WASM byte-transform cost; and
- full FISE round trips including randomness, profile/layout work, copies,
  parsing, and allocation. Every warm path reports median, P95, P99, standard
  deviation, throughput, warmup, and iteration count.

The adaptation suite measures known-decoder runtime only. It is not a
reverse-engineering benchmark; see [ADAPTATION_EVALUATION.md](./ADAPTATION_EVALUATION.md).

### Framed benchmark boundary

`benchmark:framed` creates deterministic payloads and deterministic `FISF`
containers before timing. Every full, range, and progressive case executes one
untimed byte-for-byte correctness preflight before any result is reported. The
default run uses a practical subset; `--full` expands to 16 KiB, 64 KiB,
256 KiB, and 1 MiB frames over a larger payload.

It reports:

- full restoration;
- aligned and unaligned one-frame, approximately 1%, 10%, 25%, 50%, and 100%
  range cases;
- requested bytes, selected frame count, and complete selected-frame bytes;
- iterator creation separately from first pull, fixed pulls, and complete
  progressive drain;
- wire overhead for each frame size; and
- scoped process RSS, heap, external, and `arrayBuffers` observations.

Iterator creation includes the public full-container snapshot and outer-index
validation contract. Pull timing includes frame restoration but excludes
consumer consolidation of yielded chunks. Range throughput is based on complete
selected-frame bytes; requested-output throughput is reported separately.

### Worker benchmark boundary

`benchmark:worker` compares the local JavaScript path with retained pools of
one, two, and four dedicated workers. It separates pool startup, the first
operation on a fresh pool, warm raw transforms, complete ordinary-envelope
round trips, representative full/range `FISF` restoration, and pool close.
Every backend is closed in `finally` or per-sample cleanup.

The worker public API exposes the aggregate cost of caller snapshots, chunk
copies, transferable ownership, dispatch, worker execution, and output
assembly. The suite therefore does not claim to isolate transfer or copy time.
Its Node measurements are not browser UI responsiveness certification.

Both suites support:

```sh
npm run benchmark:framed
npm run benchmark:framed -- --json
npm run benchmark:framed -- --full
npm run benchmark:framed -- --json --output artifacts/framed.json

npm run benchmark:worker
npm run benchmark:worker -- --json
npm run benchmark:worker -- --full
npm run benchmark:worker -- --json --output artifacts/worker.json
```

Supplying `--output` preserves raw timing samples in the JSON file. JSON written
only to stdout omits raw samples. Each schema records the command, runtime,
platform/architecture, CPU, Git revision/dirty state, warmups, iterations,
explicit setup boundary, process-memory observations, and `notMeasured` claims.

Neither suite measures network download savings, HTTP Range acquisition,
incremental input, lazy JSON, human adaptation effort, cryptographic security,
or universal device performance.

## Scoped reference run

One sequential run on 2026-08-25 used Node `v22.14.0` on macOS arm64. These
values describe that machine and working tree only. They are summary statistics,
not a stored raw-sample release artifact.

String default, 1,000 iterations:

| ASCII payload | Encrypt mean / median / P95 / SD | Decrypt mean / median / P95 / SD | Example wire ratio |
| ---: | ---: | ---: | ---: |
| 100 B | 0.009 / 0.008 / 0.015 / 0.011 ms | 0.006 / 0.004 / 0.010 / 0.006 ms | 3.770x |
| 1,000 B | 0.007 / 0.006 / 0.009 / 0.006 ms | 0.014 / 0.013 / 0.018 / 0.008 ms | 2.742x |
| 9.8 KiB | 0.031 / 0.030 / 0.037 / 0.007 ms | 0.104 / 0.099 / 0.149 / 0.015 ms | 2.678x |
| 48.8 KiB | 0.149 / 0.141 / 0.185 / 0.036 ms | 0.562 / 0.548 / 0.686 / 0.056 ms | 2.669x |

Binary full round trip:

| Payload | JS mean / median / P95 / SD | WASM mean / median / P95 / SD | Example wire overhead |
| ---: | ---: | ---: | ---: |
| 1 KiB | 0.014 / 0.013 / 0.018 / 0.011 ms | 0.014 / 0.012 / 0.019 / 0.012 ms | +105 B |
| 16 KiB | 0.047 / 0.046 / 0.055 / 0.012 ms | 0.033 / 0.031 / 0.040 / 0.013 ms | +114 B |
| 256 KiB | 0.885 / 0.870 / 0.945 / 0.053 ms | 0.373 / 0.362 / 0.418 / 0.028 ms | +128 B |
| 1 MiB | 3.490 / 3.460 / 3.793 / 0.123 ms | 1.378 / 1.368 / 1.449 / 0.045 ms | +126 B |

Cold WASM compile plus first instance was one 0.213 ms sample. Cached instance
creation measured 0.017 ms mean, 0.014 ms median, and 0.026 ms P95 over 50
iterations after five warmups. The full-round-trip result suggests a meaningful
warm benefit for larger tested buffers on this machine; it does not establish a
universal crossover point.

### Framed and worker working-tree run

A separate sequential run on 2026-08-26 used Node `v22.14.0` on macOS arm64
from base commit `b5fc3e6` plus the dirty 1.2 evidence-tooling working tree.
Commands were `npm run benchmark:framed -- --output <path>` and
`npm run benchmark:worker -- --output <path>`. Raw samples were written locally;
these values are not release-tag evidence.

For a deterministic 2 MiB `FISF` payload, 64 KiB frames measured 2.221 ms mean
for full restoration, 0.127 ms for one aligned frame, 0.305 ms for an unaligned
10% request selecting four frames, 0.131 ms for iterator creation, 0.108 ms for
the first pull, and 3.255 ms for a complete progressive drain. With 256 KiB
frames, the same categories measured 3.292, 0.449, 0.897, 0.098, 0.400, and
3.192 ms respectively. The comparison illustrates granularity and fixed-work
tradeoffs on one run; it is not a stable frame-size ranking.

For a deterministic 4 MiB raw XOR transform, local JavaScript measured 4.238 ms
mean. Retained one-, two-, and four-worker pools measured 7.371, 3.954, and
2.182 ms after startup; their startup means were 32.556, 36.527, and 42.032 ms.
The corresponding complete ordinary round trips measured 8.479 ms locally and
15.571, 10.230, and 5.174 ms through those pools. This run supports a warm
larger-buffer benefit for four workers in that exact environment while also
showing startup and small-workload cost; it does not define a universal
crossover.

## Wire size

For `U` JavaScript UTF-16 code units, the default string transformed length is:

```text
N = 4 * ceil((2 * U) / 3)
```

The complete string envelope adds the 22-unit fixed header, profile ID, marker,
and random-length salt. For large ASCII inputs this approaches `8/3`, or about
2.667x, before transport compression. Ratios for non-ASCII text must state the
comparison unit because JavaScript code units and UTF-8 bytes are different.

The binary envelope is additive:

```text
wireBytes = payloadBytes + 13 + profileIdBytes + markerBytes + saltBytes
```

For `fise.default.binary`, that is payload plus 44–133 bytes because salt length
varies from 10 through 99 bytes. The example sizes above are single generated
envelopes; the formula, not one random salt sample, is the stable product
property.

For `F` frames, the outer framed size is:

```text
framedBytes = 24 + profileIdBytes + 8 * F + sum(innerEnvelopeBytes)
```

Each inner envelope pays the ordinary binary header/profile/marker/salt
overhead. Frame size is therefore a range-granularity versus overhead decision,
not a free streaming switch.

## Meaning of “Fast”

“Fast” is a design objective supported only for named measurements. Version 1.1
implements linear-time transforms and bounded header/profile work. The table
above verifies low latency on one Node/macOS machine, with a larger-buffer WASM
benefit in that run. It does not claim universal browser, worker, mobile, device,
or end-to-end application performance.

## How to report a result

Record repository revision, date, runtime, OS/architecture, power mode,
payload distribution, iteration count, warmup, and raw samples when possible.
Keep cold and warm behavior separate. A single local run is scoped evidence,
not a support guarantee or universal WASM threshold.

## Expected tradeoffs

- WASM initialization and copies can dominate small inputs.
- Worker startup, message transfer, per-chunk copies, scheduling, and final
  assembly can dominate small or moderate inputs; the configurable local
  threshold is an execution policy, not a measured universal crossover.
- A worker backend retains dedicated workers until `close()` and can improve
  main-thread responsiveness without improving aggregate throughput.
- Smaller framed chunks improve range granularity but increase random-salt,
  header, marker, index, allocation, and scheduling overhead.
- Backend binding runs four deterministic semantic cases once; do not bind a
  new profile inside a hot request loop.
- Larger byte loops may benefit from WASM on some runtimes.
- Random generation and allocation remain outside the WASM loop.
- WASM linear memory retains its high-water allocation up to the configured
  page cap; recreate the instance only when measurements justify releasing it.
- String base64 costs more bytes and work than binary envelopes.
- Profile complexity can add application-defined callback cost.
- Main-thread latency matters more than aggregate throughput for UI workloads.

## Production checklist

- Benchmark actual browsers/devices and production CSP.
- Use representative binary and string payload distributions.
- Compare against no-FISE and transport-compression baselines.
- Observe allocation, garbage collection, event-loop/main-thread delay, and
  end-to-end request latency.
- Include failure and retry behavior.
- Re-run after profile, transform, runtime, or bundler changes.
- Prefer a worker when measurements show main-thread impact, then measure
  transfer and worker startup costs as well.

Incremental transport input, direct HTTP range acquisition, lazy JSON,
caller-owned output, and zero-copy transferable-buffer ownership remain future
contracts. The existing worker and framed APIs do not silently imply them.

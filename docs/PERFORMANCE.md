# FISE 1.1 Performance

## Complexity

String and binary encode/decode are linear in transformed payload size. Header,
profile, and marker work are bounded and do not scan the salt range. The
non-streaming API allocates complete transformed and envelope buffers.

The string default expands each JavaScript UTF-16 code unit to two bytes, then
base64. The binary default avoids base64 but still allocates an envelope and a
restored output buffer.

## Benchmarks

```sh
npm run benchmark -- --json
npm run benchmark:wasm -- --json
npm run benchmark:adaptation -- --json
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

Streaming, caller-owned output, and transferable-buffer APIs are future wire or
ownership contracts; they are not silently implied by 1.1.

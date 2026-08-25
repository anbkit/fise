# Evaluating FISE Adaptation Cost

FISE's defensible product hypothesis is narrower than cryptographic security:
a versioned, application-owned representation can require additional adaptation
and maintenance from integrations built around stable plaintext payloads.
Whether that cost is useful is empirical.

## Included benchmark

Run:

```sh
npm run benchmark:adaptation
npm run benchmark:adaptation -- --json
```

The benchmark compares runtime decode and JSON-parse cost for:

- plain JSON;
- base64-wrapped JSON;
- a minimal versioned binary JSON envelope with explicit framing;
- FISE with known profile A; and
- FISE with known profile B after a profile rotation.

It also verifies that profile A rejects a profile-B envelope with
`PROFILE_MISMATCH`.

This benchmark measures machine runtime with an already implemented decoder.
It explicitly does not measure human reverse-engineering time, time to locate
or hook the official decoder, or deployment coordination cost. Runtime overhead
must not be presented as attacker work factor.

### Scoped reference run

One run on 2026-08-25 used Node `v22.14.0` on macOS arm64, a 26,958-byte JSON
payload, 20 warmups, and 500 iterations. Every path also emits median, P99, and
standard deviation in the machine-readable result:

| Path | Mean | Median | P95 | Operations/s | Wire bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Plain JSON | 0.046 ms | 0.044 ms | 0.053 ms | 21,781 | 26,958 |
| Base64 JSON | 0.050 ms | 0.049 ms | 0.058 ms | 19,899 | 35,944 |
| Versioned binary JSON | 0.048 ms | 0.046 ms | 0.056 ms | 20,980 | 26,967 |
| FISE, known profile A | 0.082 ms | 0.078 ms | 0.095 ms | 12,223 | 27,008 |
| FISE, known profile B | 0.080 ms | 0.078 ms | 0.096 ms | 12,493 | 27,008 |

The stale profile was rejected. These numbers quantify known-decoder runtime
overhead on one machine; they provide no estimate of human adaptation effort.

## Controlled study for the real hypothesis

A meaningful evaluation should use independent participants or teams,
pre-register its task and analysis, and separate three questions that a single
runtime benchmark cannot answer.

### Study A: initial integration

Randomly assign comparable participants to recover the same validated dataset
from one of these surfaces:

1. plaintext JSON;
2. base64-wrapped JSON;
3. a versioned custom binary/media envelope with a public format description;
4. FISE with the compiled artifact and vectors public; or
5. FISE with only the shipped browser client available for observation.

The custom versioned-envelope arm is the closest architectural baseline. It is
needed to separate the effect of FISE's profile lifecycle from the generic cost
of using any non-JSON representation.

### Study B: rotation maintenance

After a correct initial integration, disclose a profile-B deployment and ask
participants to restore the same dataset again. Randomize whether the rotation
artifact is available. Measure code changes, regressions, and time to correct
output rather than treating a rejected stale profile as adaptation evidence.

### Study C: official-client instrumentation

Allow browser automation and decoder hooking as explicit strategies. Record
whether a participant reimplements the protocol or reuses the authorized
client's working decoder. This study tests the paper's own threat-model limit:
profile rotation may add little cost when the official decoder is easy to hook.

Across the studies, measure:

- time to first correct record;
- time to a complete and validated dataset;
- steady-state records per second;
- code size and maintenance time after rotation;
- failure rate and correctness;
- bandwidth, legitimate-client latency, and operational incidents; and
- whether the participant reimplemented FISE or hooked the official client.

Hold authentication, rate limits, dataset, network, and server behavior
constant. Use the same correctness oracle, payload semantics, and deployment
instructions across arms. Compare distributions, not only averages. Report
participant skill, randomization, sample size, confidence intervals, failed
attempts, exclusions, and all deviations from the preregistered protocol.

## Interpretation

A result can support claims such as “this deployment increased median
integration time under these conditions.” It cannot establish general secrecy,
cryptographic hardness, or resistance to a client-controlled browser.

Profile rotation only creates maintenance cost when it changes deployed
behavior and is rolled out correctly. The profile ID and manifest are public,
so obscurity of those artifacts must not be counted as a control.

## Paper claim policy

Until a controlled human study exists, the paper should describe adaptation
cost as a hypothesis and the bundled runtime benchmark as instrumentation. The
benchmark's `notMeasured` field is part of its machine-readable output to make
that boundary hard to omit accidentally.

No synthetic completion times should be substituted for participant evidence.
Publishing a null or small measured effect remains a valid result and should
narrow the product claim accordingly.

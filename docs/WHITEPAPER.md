# FISE Whitepaper (v1.0)

**Fast Internet Secure Extensible — a rule-based, keyless, high-performance _semantic envelope_ for Web/API data**

> **Positioning (TL;DR)**  
> FISE is **not cryptography** and does not replace TLS/AuthZ. It is a **semantic obfuscation layer** that raises the _cost and time_ of scraping and reverse-engineering client-visible data, while keeping runtime overhead extremely low.

---

## Abstract

Modern web apps must render meaningful JSON on the client. HTTPS protects transport, but **data meaning** remains exposed in the browser, making large-scale scraping and cloning cheap. Traditional client-side encryption requires keys in the frontend, which attackers can read; heavy crypto also adds latency.

**Design principle:** Rather than distributing static client keys, FISE injects **shared, ephemeral rules** ("rules-as-code") that are bound to context and rotate quickly; any decoder inferred from one session does **not** generalize to others or future windows.

**FISE** proposes a **rule-based, keyless transformation pipeline** that "wraps" responses in a polymorphic **semantic envelope**. Each application (and optionally each session/request) uses a unique, rotating rule-set to assemble salt, offsets, and metadata into a structure with **no protocol-level universal decoder**—attackers must tailor a decoder per pipeline. FISE focuses on _raising attacker cost_ (not secrecy), with **microsecond-level** encode/decode on commodity devices.

FISE complements, not replaces: TLS, authentication/authorization, backend rate-limits, or cryptography for secrets. It is best suited where **data itself is the asset** (e.g., curated POI, pricing, recommendations, AI metadata).

FISE supports **chunked, block-local pipelines** that enable **parallel encode/decode and streaming**, allowing clients to begin rendering **before** the full payload arrives. It generalizes to **media** (images/video) via framed, chunked pipelines that preserve codec/container compatibility while enabling parallel unwrap on the client. FISE further supports **per-session, server-injected rules**, avoiding static bundles and reducing reuse value of a captured decoder.

---

## 1. Introduction

REST/GraphQL APIs commonly return plaintext JSON. Despite TLS, the browser must see readable data, enabling:

-   automated scraping
-   competitive data harvesting / dataset cloning
-   inference of business logic from response shapes
-   unauthorized third-party reuse

**Goal**: protect **semantic meaning** without frontend keys or heavy crypto, by **diversifying and rotating** a lightweight envelope that is cheap to run but expensive to reverse for each target.

---

## 2. Problem Statement

### 2.1 Client visibility is inherent

Even with HTTPS:

-   DevTools exposes plaintext JSON.
-   Headless browsers can fetch like any user.
-   Response schemas leak domain logic.

### 2.2 Why traditional crypto under-delivers on the client

-   **Keys must reside in the frontend** → discoverable.
-   **Operational cost** per request (key derivation/expansion, AEAD) is non-trivial on low-end clients.
-   Resulting ciphertext still needs **client-side decryption** → plaintext inevitably appears in memory/DOM.

### 2.3 Scraping today is cheap

A few fetch calls and pagination often suffice to replicate valuable datasets at scale, creating **business risk** wherever data is the moat.

---

## 3. Design Philosophy

**Core principle:** Rather than distributing static client keys, FISE injects **shared, ephemeral rules** ("rules-as-code") that are bound to context and rotate quickly. Any decoder inferred from one session does **not** generalize to others or future windows, creating economic impossibility for automated attacks at scale.

This yields the following properties:

1. **Keyless by design** — no static client key to steal.
2. **Security through diversity** — each app/session/request may use a different rule-set.
3. **Infinite customization** — salts, offsets, metadata channels, ciphers (optional), assembly strategies.
4. **Semantic obfuscation** — protect _meaning_, not transport.
5. **Cheap to run, costly to reverse** — microsecond-level ops; no protocol-level universal decoder.
6. **Streaming & Parallel-ready** — rules can be designed block-local, enabling **per-chunk** encode/decode and multi-core execution.
7. **Polymorphic-by-session** — rules can be **server-injected per session**, signed and short-lived, minimizing the reuse value of static reverse-engineering artifacts.

---

## 4. The FISE Transformation Pipeline

A concrete deployment chooses and **rotates** among multiple rule-sets. A typical encode flow:

### 4.1 Salt & Entropy

-   Variable-length salt (10–99 chars or app-defined).
-   Entropy sources: CSPRNG (preferred), timestamp mixes, rolling checksums.
-   **Recommendation**: use server-side CSPRNG to avoid predictability.

### 4.2 Metadata Encoding

Encode salt length, offsets, rule-set id, optional request/session binding tags via one or more channels:

-   base36/base62/hex
-   emoji lanes
-   zero-width characters
-   XOR signatures / parity bits

### 4.3 Optional Cipher Layer

-   XOR or AES/WASM stage is **optional** to balance performance vs. resilience.
-   If used, it **does not rely on a client secret** for security claims; it only raises effort.

### 4.4 Offset Calculation

Offsets decide where to place metadata, salt, and decoy. They may derive from:

-   rule-set id
-   timestamp buckets
-   prime sequences / rolling checksums
-   request/session bindings

### 4.5 Envelope Assembly

Interleave (data + salt + metadata [+ decoy]) into a **non-deterministic**, non-fixed format.

### 4.6 Final Output

A string/byte stream with **no fixed structure** shared across deployments. There is **no protocol-level universal decoder**; decoding requires the **matching rule-set**.

### 4.7 Streaming/Framed Mode (optional)

-   Payload is split into **chunks**; each chunk carries **local metadata** (rule id, offsets) and optional **HMAC bindings** (server-side verify).
-   Interleave/drift parameters derive from **(ruleset, chunkIndex, bindings)** → **no global dependency**, so chunks can be **encoded/decoded in parallel**.
-   A **super-header** specifies framing (`version`, `nChunks`, `flags`).

### 4.8 Heterogeneous Per‑Chunk Rules (optional)

-   Each chunk MAY select a **different rule** from a bounded pool (e.g., 3–8) to increase diversity.
-   Selection is **deterministic** from bindings/seed: `rule_idx = PRNG(seed, chunkIndex) mod K`.
-   A **super‑header** carries a compact `rule_map`; each chunk stores `rule_idx` instead of full ids.
-   Preserve **block‑local semantics** so chunks decode independently; carry only **tiny deterministic state** if required.

### 4.9 Server‑Injected Bootstrap (optional)

**Goal:** deliver a **fresh rule** per session/request without changing the long‑cached runtime.

-   **Bootstrap snippet (HTML/SSR)**: server renders a tiny `<script type="module" nonce=...>` containing a compact **rule manifest** (e.g., DSL bytecode + metadata) and calls the stable **FISE runtime** to activate it.
-   **Signature**: include `sig = HMAC(serverKey, bytecode || manifest || bindings)`; the runtime verifies **before** enabling the rule.
-   **Bindings**: `(method|pathHash|sessionId|tsBucket)` may be embedded to tie the rule to its context.
-   **Caching**: mark bootstrap **no‑store**; keep `fise-runtime.min.js` immutable and SRI‑pinned.
-   **Deterministic selection**: the per‑session rule can still define **heterogeneous per‑chunk** logic (see §4.8) using a small bounded pool.

---

## 5. Decoding

Given a matching rule-set:

1. Extract/locate metadata via channel heuristics.
2. Recover salt length & offsets; validate request/session bindings.
3. Remove salt/decoy; unwind transformations.
4. Reverse optional cipher stage.
5. Restore plaintext JSON for rendering.

> **Framed mode.** The client may **decode chunk-by-chunk** (possibly in parallel workers) and **incrementally render** while the stream is arriving. If a rule needs cross-chunk state, carry a **small deterministic state** between chunks.

---

## 6. Security Model

### 6.1 What FISE mitigates

-   Commodity scrapers relying on stable, predictable JSON.
-   Universal or reusable decoders across many targets.
-   Blind replay/tamper (when **server verification** is enabled).
-   Rapid cloning of curated datasets (cost ↑).

### 6.2 What FISE does **not** replace

-   TLS (transport), authentication/authorization, access control.
-   Backend bot controls (rate limit, behavior scoring).
-   Cryptography for secrets/PII.
-   DRM-like guarantees.

### 6.3 Attacker-in-the-browser (AitB)

Attackers can run your app, hook decode functions, or dump plaintext **after** decode. FISE **cannot prevent** post-decode access; it **raises the effort** to reach and sustain that point, especially under rotation and validation.

### 6.4 Replay & Tamper (recommended hardening)

-   **Request/Session binding**: include a hash of `(method|path|query|sessionId|tsBucket)` in metadata.
-   **Server-side verification**: HMAC (server key only) covering metadata & bindings to reject altered or stale envelopes.
-   **Short-lived validity**: timestamp buckets + skew windows.

### 6.5 Normalization resistance

-   Design channels that survive gzip, Unicode normalization, and CDN transformations.
-   Multi-channel redundancy to tolerate lossy intermediaries.

### 6.6 Rotation

-   **Per-session** or **per-request** rule-set rotation drastically increases reverse-engineering cost and decoder maintenance.

### 6.7 Framed-mode Integrity

-   **Anti-reorder/tamper**: per-chunk **HMAC(meta \|\| chunkIndex \|\| bindings)** (server key only).
-   **Anti-replay**: include request/session bindings and **timestamp buckets** in each chunk’s meta.
-   **Boundary hiding**: optional decoy/padding and variable chunk sizes.

### 6.8 Heterogeneous Rule Pools

-   Limit pool size (e.g., 3–8) to bound code/metadata overhead and improve worker/WASM cache locality.
-   Include `rule_idx` and `chunkIndex` under **server HMAC** to prevent splice/reorder attacks.
-   Track field reliability per `rule_idx`; rotate out rules with poor normalization fitness.

### 6.9 Server‑Injected Rules: Signature & Localized Fallout

-   **Trust on first use**: the runtime **rejects** unsigned/invalid manifests; use CSP nonces to restrict inline code.
-   **Localized leak**: compromise of one session’s rule has **limited reuse**; subsequent sessions rotate.
-   **Replay/tamper**: include `(sessionId|tsBucket|pathHash)` in the signed fields; per‑chunk HMAC continues to guard payload integrity.

> **Claim wording**: We do **not** claim “impossible to decode.” We claim **no protocol-level universal decoder**, and **significant per-target cost** under rotation, validation, and normalization-resistant channels.

### 6.10 Practical Hardness of Rule Inference _(Under Session/Time Rotation)_

**Claim (practical):** With a sufficiently diverse **custom rules pipeline**, **per-session bindings**, **heterogeneous per-chunk rules**, and **temporal rotation**, inferring the exact rule in use for a specific envelope becomes **very hard within the rule's validity window**. Any decoder that is inferred tends to be **non-reusable** beyond its original session/time-bucket.

#### 6.10.1 Complexity (Search-Space Upper Bound)

Let **R** = total rule space size, **S** = number of active sessions, **T** = time buckets per hour, **C** = chunks per response, **H** = rule-pool size per chunk. A conservative upper bound for attacker search space per decoded response is:

**O(R × S × T × H^C)** _(illustrative; parameters may not be fully independent in practice)_

Example: R=1000, S=10,000, T=120, C=10, H=5  
→ 1.16 × 10^16 combinations  
→ At 1 ms/attempt: ~368 million years

Defender cost: **O(1)** per request (hash-table/manifest lookup)  
Attacker cost: **O(R × S × T × H^C)** per response

**Asymmetry:** small, constant defender cost vs. exploding attacker maintenance cost.

#### 6.10.2 Why This Is Hard in Practice

1. **Non-stationarity (temporal):** Rule distribution rotates (e.g., every 30s). Attacker samples stale quickly; inferred decoders degrade to near random for new buckets/sessions.
2. **Low sample budget:** Under i.i.d. assumption, Hoeffding suggests  
   \(N = O\big(\frac{1}{\varepsilon^2}\log\frac{1}{\delta}\big)\) samples for ε-accurate inference. With ε=0.01, δ=0.01 → ~26,500. Rotation 30s @ 10 req/s gives ~300 samples → **~88× shortfall**.
3. **Context binding + integrity:** Each envelope/chunk bound to `method | pathHash | sessionIdHash | tsBucket [| tokenHash(trunc)]` and signed server-side (`HMAC` with tag length **t** → forgery ≈ 2^-t). Decoders are **non-portable** across routes/sessions/buckets.
4. **Heterogeneity across chunks:** Pool of 3–8 rules per chunk forces **H^C** combinations (e.g., 5^10 ≈ 9.7M). One chunk error breaks the whole response → automation **fragile**.
5. **Attacker economics:** Defender ~0.1 ms CPU (O(1)); attacker hours per variant + constant re-work after rotation → **maintenance does not scale**.

#### 6.10.3 Attack Models Considered

Practical hardness against: **passive observation**, **active probing (per-session)**, **model extraction (staleness)**, **replay (bootstrap expiry/bindings)**, **collaborative sharing (non-transferable decoders)**.

#### 6.10.4 Threat-Model Boundaries

**In scope:** automated scrapers, mass extraction, API harvesting at scale.  
**Out of scope:** nation-state adversaries, insider threats, full client compromise, formal cryptographic secrecy, quantum-model guarantees.

**Positioning:** FISE sits between plaintext (no protection) and strong cryptography/DRM. It **complements** TLS/JWT/DPoP/DRM rather than replacing them.

#### 6.10.5 Quantitative Metrics

**Suggested measurements/targets:**

1. Decoder Breakage Rate (DBR) **>95%** post-rotation
2. Scraper Throughput Reduction (STR) **>90%**
3. Mandatory Lag (ML) **> rule lifetime** (live profiles)
4. Client TTFR overhead **P99 <100 ms**
5. Legitimate Decode Success Rate (DSR) **>99.9%**
6. Attacker Cost Multiplier (ACM) **>100×**

_Note:_ Move empirical numbers to `docs/PERFORMANCE.md` once measured via A/B.

#### 6.10.6 Disclaimers

Not claiming **information-theoretic secrecy**, not a **replacement** for TLS/JWT/DRM, and **no cryptographic quantum guarantees**. FISE focuses on **reducing value** and **shortening useful lifetime** of unauthorized decoding via **economic asymmetry** and **temporal dynamics**.

## 6.11 The Key-Management-Light Security Property

**Central idea.** FISE targets _practical, time-bounded hardness_ without requiring any **client-side** secret keys. Server-side integrity remains anchored by a server secret (e.g., HMAC), but no reusable key is shipped to the client.

### 6.11.1 The Paradigm Shift

Traditional systems emphasize:

-   Secret keys in clients, strict key management, and long-lived guarantees.

FISE emphasizes:

-   **No client-side keys** (nothing reusable to steal on the client),
-   **Time asymmetry** (**rotation > inference/automation**),
-   **Bounded protection** (value decays within a rotation window).

### 6.11.2 Informal Security Rationale

Let \(T*i\) be attacker time-to-infer a working decoder for a given session/bucket, and \(T_r\) the rotation period.
FISE is \_practically* safe when **\(T_i \gg T_r\)**, so any decoder becomes stale before it scales.

Let \(C\) be attacker maintenance cost per session/bucket and \(V\) the exploitable value per unit data in that window.
Economic safety improves as **\(C \gg V\)** (deterrence by cost).

_Illustrative targets (to be validated):_ \(T_i = \text{hours}\), \(T_r = \text{tens of seconds}\) → strong time asymmetry; \(C/V \gg 1\) under rotation.

### 6.11.3 Why Keys on the Client Aren’t Needed

-   FISE binds envelopes to context (`method|pathHash|sessionIdHash|tsBucket[|tokenHash(trunc)]`) and verifies integrity with a **server-only HMAC**.
-   The **client never holds a reusable decrypt key**. Rules are per-session/pool-per-chunk and rotate, so any recovered logic is short-lived and non-portable.

> **Key insight:** Security is achieved via **temporal and distribution polymorphism** and **server-anchored integrity**, not via long-lived client keys.

### 6.11.4 Exposure & Bootstrap Considerations

-   If bootstrap/manifest is observed: it is **meant to be consumable** by that session and doesn’t expose server secrets.
-   Rule families rotate (per session/time-bucket), so reverse-engineered decoders **expire quickly** and don’t generalize.

### 6.11.5 Position vs. Cryptographic Systems

| Dimension          | AES/TLS/JWT (classic)             | FISE (this work)                              |
| ------------------ | --------------------------------- | --------------------------------------------- |
| Client-side keys   | Often present (must be protected) | **None** (no reusable decrypt key on client)  |
| Server secret      | Yes (KMS/HSM, etc.)               | **Yes** (HMAC/manifest integrity only)        |
| Protection horizon | Long-lived while secrets hold     | **Rotation window** (tens of seconds/minutes) |
| Break reuse        | Often reusable once broken        | **Non-transferable; expires with rotation**   |
| Security basis     | Math hardness + secrecy           | **Time & maintenance asymmetry + integrity**  |
| Role               | Transport/auth/strong secrecy     | **Semantic protection; defense-in-depth**     |

**Scope.** FISE complements TLS/JWT/DPoP/DRM. It is not a replacement for cryptographic secrecy where that is required.

### 6.11.6 Measurement Plan

Publish and track:

-   \(T_i/T_r\) ratio (observed),
-   Decoder breakage rate after rotation,
-   Scraper throughput reduction,
-   P95/P99 client overhead under legitimate use.

_Note:_ Report concrete numbers in `docs/PERFORMANCE.md` after A/B experiments.

### 6.12 Bidirectional (Two‑Way) Semantic Envelope

**Goal.** Use the same per‑session rule family to protect **both directions**: server → client (response) **and** client → server (request), while keeping the hot path lightweight and parallelizable.

**What it is.** A **two‑way semantic envelope**: the server injects a signed manifest at bootstrap; responses are wrapped (encode) and requests may optionally be wrapped (encode) by the client and **unwrapped** (decode) by the other side. The rule is **keyless** and rotates per session / time bucket; integrity of envelopes is enforced by a **server‑only HMAC** over metadata/bindings (not by a client secret).

**Security properties (adjunct).**

-   **Confidentiality (semantic)**: hides _meaning_ from naive scraping or middleboxes; not a replacement for TLS.
-   **Context binding**: envelopes are valid only under `(method|pathHash|sessionIdHash|tsBucket[|tokenHash*])`.
-   **Asymmetry**: attacker time‑to‑understand >> defender time‑to‑rotate.
-   **No client secret**: avoids key exposure in the browser; HMAC secrets live only on the server.

**Performance envelope.**

-   Linear byte ops (O(n)), block‑local chunks, parallel decode via Workers/JSI/WASM.
-   Deterministic rule selection from `(seed, chunkIndex[, tsBucket])` within a **small warmed pool (3–8)**.

**Recommended usage.**

-   **Responses (default)**: wrap JSON/media segments.
-   **Requests (optional)**: wrap **non‑secret** payloads (e.g., proprietary query/filters) to raise scraping cost; keep auth/CSRF unchanged.

---

## 7. Comparison

| Feature                         | AES/WebCrypto    | Obfuscation libs (generic) | **FISE (this work)**                    |
| ------------------------------- | ---------------- | -------------------------- | --------------------------------------- |
| Requires client key             | **Yes**          | No                         | **No**                                  |
| Universal decoder               | N/A (standard)   | Often                      | **No protocol-level universal decoder** |
| Performance (client)            | Medium–High cost | Fast                       | **Very fast (microseconds)**            |
| Predictability                  | Fixed format     | Medium                     | **Non-fixed, rotating**                 |
| Semantic protection             | Not the goal     | Partial                    | **Strong focus**                        |
| Per-app uniqueness              | No               | Limited                    | **Yes**; per-session/request capable    |
| Server validation (anti-replay) | Optional (MAC)   | Rare                       | **First-class option (HMAC)**           |

---

## 8. Performance

### 8.1 Microbenchmarks (illustrative)

-   **Encode**: ~0.02–0.04 ms
-   **Decode**: ~0.01–0.02 ms
-   Optional AES/WASM stage: add 0.1–0.3 ms typical

### 8.2 Methodology (to report in evaluations)

-   Payload sizes: 1 KB, 10 KB, 50 KB.
-   Environments: Desktop (M-series), Android mid-range, iOS mid-range.
-   Report **mean, stdev, P95/P99**.
-   Measure **end-to-end** impact (server encode → client decode → render).

### 8.3 Parallel & Streaming Benchmarks

Report **TTFR** (time-to-first-render) and **throughput** with N workers (server Node workers; client Web Workers/WASM). Typical chunk sizes: **8–32 KB** for JSON; **128–512 KB** for media segments. Compare streaming vs. non-streaming P95/P99.

---

## 9. Deployment Guidance

### 9.1 Minimal (Lean) Profile

-   Server: encode + HMAC verify endpoints.
-   Client: JS/RN decode runtime.
-   Rotation: 2–4 rule-sets, per-session selector.
-   Bindings: method/path/query + sessionId + timestamp bucket.
-   Bot controls: rate limits, light CAPTCHA/Turnstile where appropriate.

### 9.2 Normalization & CDN

-   Validate channels across gzip/brotli, Unicode NFC/NFKC, proxies/CDN.
-   Provide fallback multi-channel metadata if a lane is stripped.

### 9.3 Observability

-   Log P50/P95 encode/decode, failure reasons, suspected tamper, rotation distribution.
-   A/B toggles to quantify real-world scraping reduction.

### 9.4 When to Use Framed Mode

-   Enable for payloads **≥ 100–200 KB** or when using optional WASM/cipher stages.
-   Keep rules **block-local** (or carry **tiny state**) to preserve parallel decode.
-   Validate against **Normalization Gauntlet** (gzip/brotli, Unicode NFC/NFKC, CDN).

### 9.5 Media‑Specific Guidance

-   **Video (HLS/DASH/CMAF)**: wrap **segments**, not manifests. Bindings include variant id and timestamp buckets. Client unwraps in workers then appends raw bytes to MSE.
-   **Images**: whole‑file wrap (Blob URL) or **tile‑based** wrap for deep‑zoom; avoid CDN recompression on enveloped assets.
-   **CDN/Optimizer**: disable transforms (recompress/minify) on enveloped media; validate via Gauntlet.
-   **Chunk sizes**: 128–512 KB per segment chunk on web; schedule workers to group identical `rule_idx` for cache locality.

### 9.6 Bootstrap Patterns (Web & RN)

-   **Web (SSR/SPA)**: render a per‑session **bootstrap** with CSP nonce; load `fise-runtime.min.js` (immutable). Verify signature, then initialize workers and start framed decoding.
-   **React Native**: fetch `GET /fise/rule?sid=...` for the manifest; verify signature; pass to native/JSI runtime.
-   **CDN**: do **not** cache the bootstrap; cache the runtime and enveloped payloads normally.

---

## 10. Use Cases

-   Web/API response protection where **data is the product**: POI/travel, pricing, recommendations, AI metadata.
-   Admin dashboards/mobile apps exposing sensitive analytics (non-secret).
-   Aggregation portals (news/content) reducing bulk harvesting.
-   Media delivery: **per‑segment video** (HLS/DASH/CMAF) and **image tiles/files** wrapped in FISE for anti‑bulk scraping while preserving player/decoder compatibility.

**Not recommended** for secrets/PII/keys—use standard cryptography and access control.

---

## 11. Evaluation & KPIs

-   **Scraping reduction** (A/B): drop in effective scraper throughput (target ≥ 50–70%).
-   **Time-to-decoder** for red-team per rule-set (target ≥ 5× vs. baseline).
-   Decoder breakage rate under **rotation** (maintenance cost for attacker).
-   Client overhead P95 < 1 ms on mid-range devices for ≤10 KB payloads.

---

## 12. Future Work

-   Multi-block interleaving & decoy noise segments.
-   Per-request **rule-set rotation** with server seed.
-   Browser-optimized **WASM fast path**.
-   DSL & **codegen** for polymorphic-by-build pipelines.
-   Watermarking/attribution bits for leak tracing.
-   Tamper detectors and heuristic anti-hook signals.

---

## 13. Conclusion

FISE reframes client-side protection as a **semantic, rule-based envelope**: keyless, rotating, and cheap to run. It **does not prevent** post-decode access, but it **raises attacker cost** substantially by eliminating a protocol-level universal decoder and coupling data to diversified, validated rule-sets. Used alongside TLS/AuthZ, rate-limits, and behavior defenses, FISE provides **practical defense-in-depth** for teams—especially small teams—whose competitive edge lies in the data they deliver to clients.

---

## 14. FISE Ecosystem: DSL, Rule VM, Registry & Builder

This section defines a path to unlock **community-driven rule diversity** and safe, deterministic execution.

### 14.1 Goals

-   **Rule Diversity at Scale**: countless pipelines from community & vendors without breaking safety or DX.
-   **Deterministic Runtime**: same input + same bindings → same output; budgeted CPU/memory/time.
-   **Programmability**: a **DSL** that compiles to **JS/WASM** for speed and polymorphic-by-build distribution.
-   **Trust & Quality**: **Registry** with CI, property tests, normalization gauntlet, and reputation scoring.
-   **No Secrets in Client**: binding and rotation **do not expose** server keys; HMAC verification remains server-only.

### 14.2 FISE DSL — v0.1 (Minimum Spec)

-   Declarative operators; no arbitrary IO/network/DOM access.
-   Deterministic evaluation; pseudo-randomness only via allowed bindings/seed.
-   Budgeted execution: `max_ops`, `max_ms`, `max_bytes`.
-   Symmetry: every encode op has a decode inverse.

### 14.3 Rule VM (Sandbox Runtime)

-   Isolation: no DOM, no network/FS; limited memory; timeouts; op-count quotas.
-   Determinism: frozen builtins; seeded PRNG derived from bindings/seed only.
-   Backends: JS interpreter first; optional **WASM** fast path.
-   Instrumentation: metrics (ops, ms, bytes), decode failures, normalization outcomes.

### 14.4 Registry (Open, with CI)

-   Metadata: name, author, semver, ops used, budget, **Gauntlet score**, P95 decode, payload delta.
-   CI: linter, schema validate, property tests, fuzz, budget/time.
-   Signatures: rule packages signed (supply-chain).
-   Reputation: anonymized usage telemetry (opt‑in), field failure rates, attacker breakage reports.
-   Tags: `mobile-fast`, `normalization-hard`, `emoji-free`, `zero-width-lite`, `wasm-fast`, `framed`.

### 14.5 Normalization Gauntlet

-   Compression: gzip/brotli; Unicode: NFC/NFKC; Proxy/CDN quirks.
-   Score: survival metrics + integrity; published in Registry.

### 14.6 Rule Builder (UI + AI)

-   Block editor; live preview; budget sliders; Gauntlet-in-the-loop.
-   AI copilot for mutation (“+10% gauntlet score, P95 < 1 ms”).
-   **Bootstrap generator**: export per‑session rule manifest (bytecode + signature fields).

### 14.7 Distribution & Rotation

-   Polymorphic-by-build codegen variants; per-session/per-request rotation.
-   Fallback: multi-channel metadata; decode can attempt multiple lanes.

### 14.8 Governance

-   Claims policy; disclosure of limits (AitB).
-   Reviewer roles (security/perf).
-   Bounties/hall‑of‑fame.

### 14.9 Roadmap (Ecosystem)

-   v0.2: JS VM + Registry alpha; Gauntlet CLI; 10 curated rules.
-   v0.3: WASM fast path; AI mutation loop; telemetry-backed fitness.
-   v1.0: Rule Builder stable; signed packages; enterprise rotation policies.

---

## 15. FISE‑Media Profile (images & video)

**Goal:** container/codec‑preserving envelopes with **parallel, chunked unwrap** on the client.

### 15.1 Segment‑Envelope (recommended)

-   **Video**: apply FISE per **segment** (`.ts`, `.mp4`, CMAF). Super‑header announces `version`, `nChunks`, `rule_map`. Each chunk carries `rule_idx`, `chunkIndex`, `len`, bindings, and **HMAC(server)**.
-   **Client flow**: `fetch(segment) → WebWorker.decodeFise(chunked) → appendBuffer(bytes)` (MSE). Start render as soon as first chunk is decoded.
-   **Images**: wrap **entire file**; decode to `Blob` then `img.src=URL.createObjectURL(blob)`. For deep‑zoom, wrap **per‑tile** for higher parallelism and per‑tile rotation.

### 15.2 Heterogeneous per‑chunk rules

-   Deterministic selection from seed/bindings; keep pool small (3–8). Optimize scheduler to batch by `rule_idx` to reduce JIT/WASM thrash.

### 15.3 Integrity & Anti‑replay

-   Include `(rule_idx || chunkIndex || len || bindings)` in **HMAC** (server key only). Bindings cover `method|path|variant|tsBucket`.
-   Optional decoy/padding and variable chunk sizes to hide internal boundaries.

### 15.4 Compatibility & Gauntlet

-   Validate against gzip/brotli, Unicode normalization, proxy/CDN mutations, and platform image/video pipelines.
-   Disallow CDN recompression on enveloped assets; publish Gauntlet score in Registry metadata.

### 15.5 Metrics

-   **TTFR** improvement vs. baseline, **throughput** with N workers, **P95/P99** decode, **decoder breakage rate** under rotation.

### 15.6 Critical‑Fragment Obfuscation (Selective Partial Protection)

**Idea:** obfuscate a **very small portion** (≈0.5–3% bytes) that is **structurally critical** to decoding/visual quality, then restore it client‑side in the framed pipeline. This preserves **throughput** and **parallelism** while making CDN‑level restreaming impossible without the rule.

**Video (MP4/CMAF/HLS/DASH):**

-   **Init segment**: lightly obfuscate parts of **parameter sets** (e.g., SPS/PPS for AVC/HEVC, sequence headers/OBUs for AV1).
-   **Key frames (IDR)**: obfuscate a few **tiles/macroblocks** at the start of each IDR or selected **slice header** fields.
-   **Sample description / `stsd`**: minimal perturbation that invalidates naive decoders until client restores.

**Images (JPEG/WebP/AVIF):**

-   **JPEG**: obfuscate a handful of **MCU** at scan start, or perturb **Huffman/Quant tables** with a deterministic, invertible delta.
-   **WebP/AVIF**: target a small set of **OBU/Chunk headers** or the first **tile** in each region.

**Client restoration:** performed **per‑chunk** in Web Workers/JSI/WASM (block‑local), then fed to MSE (video) or `Blob URL` (image).

**When to use:** environments you control end‑to‑end (no CDN recompression) or alongside **15.1 Segment‑Envelope** as an inner layer for high‑value routes.

**Caveats:** ensure compatibility with players; validate via **Normalization Gauntlet** and device lab before rollout.

### 15.7 Live Event Anti‑Restream Profile (optional)

**Goal:** make near‑realtime restreaming economically unviable by coupling **time‑bucket rotation** with **heterogeneous per‑chunk rules** and (optionally) **critical‑fragment obfuscation**.

**Profile:**

1. **Per‑session bootstrap** (signed, no‑store).
2. **Per‑segment envelope** (2–4 s segments) with `super‑header`, `rule_map`, and **HMAC(meta‖chunkIndex‖bindings)**.
3. **Heterogeneous‑by‑chunk**: pool of 3–8 rules, selection deterministic from `(seed, chunkIndex, tsBucket)`.
4. **Rotation by time‑bucket** (e.g., every 15–30 s).
5. **Optional critical fragments**: touch init + IDR boundaries (≤3% bytes) to break naive playback.
6. **Bindings**: include `(method|pathHash|variant|sessionIdHash|tsBucket)` in meta/HMAC.
7. **Watermark (optional)**: per‑session tracers in metadata/offset layout for leak attribution.

**Outcome:** legitimate clients decode **in parallel** with low **TTFR**, while attackers accumulate **latency debt** (find bootstrap → build N decoders → track rotations), causing restreams to lag or fail.

---

## 16. Temporal Polymorphism & Rule Injection Diversity

Modern large‑scale scrapers rely on two assumptions: (1) the protection mechanism is **stable over time**, and (2) it is **uniform across clients**. FISE invalidates both by introducing **temporal polymorphism** and **distribution‑level variability**: the effective rule‑set for each client (and potentially each request) is **inlined at bootstrap time** and can be **mutated/rotated** with negligible operational cost. This unpredictability raises both **attack construction** and **attack maintenance** costs.

### 16.1 Client‑Side Rule Injection (Per‑Client Distribution)

On each initial HTML load, the app may embed the **effective decode rule‑set** for that session. The rule need not be static, global, or shared.

**Injection vectors (non‑exhaustive):**

-   Inline `<script type="module">` with CSP nonce (short‑lived)
-   External bundles (per‑build polymorphism)
-   Dynamic `import()` loaders
-   Service Worker bootstrap responses
-   Inlined bootstrap JSON (`window.__FISE__`)
-   CSS‑encoded lanes (zero‑width / emoji / base62)
-   WASM modules with partial decode logic
-   `<meta>`‑embedded metadata
-   `Link: rel=prefetch` headers
-   First‑call bootstrap API responses

Apps may **select/rotate injection paths** at runtime. Thus, even within the same ruleset family, each client can receive a **structurally different** decode pipeline.

**Implication.** There is no single reliable “place” to locate the decoder; reverse‑engineering must begin **from scratch** for each injection variant.

### 16.2 Distribution Polymorphism (Diversity Across Clients)

Since rules are injected at bootstrap, delivery can vary **per‑build**, **per‑client**, **per‑session**, and even **per‑request** (for sensitive endpoints). The rule itself may be:

-   injected as a concrete pipeline,
-   generated via DSL at build‑time,
-   mutated by polymorphic codegen, or
-   selected from a pool of community salt packs.

This yields a many‑to‑many mapping:

```
Client 1 → A₁
Client 2 → A₂
Client 3 → B₁
Client 4 → C₃
...
```

Even within the same family (A, B, C), **materialization differs** per client.

**Implication.** Attackers cannot prepare a universal, reusable decoder. At best they reverse one session, which becomes invalid after rotation.

### 16.3 Temporal Rule Rotation (Maintenance Asymmetry)

Breaking a pipeline requires:

1. locating the injected rule, 2) understanding the pipeline, 3) reconstructing a decoder, 4) validating, 5) automating. This can take hours per pipeline.

Defenders can rotate **per deployment / per session / per time bucket / per request** with near‑zero cost.

**Asymmetry.**

```
Attacker time‑to‑understand  >>  Defender time‑to‑rotate
```

Thus, even successful decoding is **short‑lived** and **non‑transferable**.

> **Claim wording:** FISE does **not** prevent decoding; it aims to ensure any successful decoding is **short‑lived and non‑reusable**.

### 16.4 Zero‑Reuse Reverse Engineering

Traditional anti‑scrape fails because one break scales: same signatures, payload formats, and schemas. FISE breaks that model:

-   Decoding logic is **session‑local**.
-   Pipeline structure is **instance‑specific**.
-   Injection vectors are **variable**.
-   Offsets/metadata lanes can differ **per request**.
-   Each instance **decays quickly** under rotation.

**Result.** Reverse‑engineering may be feasible but **economically useless** beyond the original session.

**Principle:** _No protocol‑level universal decoder, no reusable exploit._

### 16.5 Security Implications

Temporal & distribution polymorphism increase:

-   attacker cost (initial & ongoing),
-   attacker uncertainty,
-   scraping maintenance overhead,
-   difficulty of automation,
-   resistance to pattern matching (including AI‑assisted).

…while maintaining:

-   microsecond‑level overhead,
-   no client‑side secrets,
-   straightforward integration for small/medium teams.

We call this **Semantic Protection with Temporal & Distribution Polymorphism (SP‑TDP)**—a defense model where attack cost scales roughly **per client / per session**, while defense cost remains **near‑constant**.

---

## 17. Portability & Platform Profiles

FISE’s core is dependency‑free, linear byte/string transforms with optional WASM fast paths. This makes it portable across Web, Mobile, TV/IoT, Edge, and Native stacks. Below are **reference profiles** and packaging targets.

### 17.1 API Surface (minimal)

-   `encode(input: Uint8Array, manifest: Manifest): Uint8Array`
-   `decode(input: Uint8Array, manifest: Manifest): Uint8Array`
-   `encodeFramed(stream, manifest): AsyncIterable<Chunk>`
-   `decodeFramed(stream, manifest, { maxWorkers? }): AsyncIterable<Uint8Array>`

**Manifest (self‑contained).** `rulesetId`, `rule_map`, `seedHint`, `bindings`, `sig`, `version`.

### 17.2 Web (Browser)

-   **Profiles:** `web-core` (JS), `web-wasm` (auto WASM), `media-segment-envelope`, `media-critical-fragment` (opt‑in).
-   **Parallelism:** Web Workers; transferable buffers.
-   **Media:** MSE append after unwrap; Image via Blob URL.
-   **Notes:** CSP nonce on bootstrap; Gauntlet (gzip/brotli/NFC/NFKC/CDN).

### 17.3 Mobile (React Native)

-   **Profile:** `rn-jsi` (C++/Rust core via JSI) + JS shim.
-   **Parallelism:** thread pool inside JSI; avoid GC churn; preallocate buffers.
-   **Media:** decode per‑chunk then pass to native players or custom renderers.

### 17.4 TV & IoT

-   **Webview targets (Tizen/webOS/Android TV/kiosk):** prefer `media-segment-envelope`; Workers if available; WASM optional; fallback scalar.
-   **Native set‑top/embedded:** static lib (C/C++/Rust); expose `encode/decode/decodeFramed`; 2–4 worker threads are sufficient for 2–4s segments.
-   **Metadata lanes:** prefer hex/base36 over zero‑width/emoji on firmware that normalizes content.

### 17.5 Edge Runtimes (Cloudflare/Deno/Bun/Vercel Edge)

-   **Profile:** ESM build, no Node APIs required; Worker pool polyfill for concurrency or single‑thread fallback.
-   **Streaming:** handle `ReadableStream` with framed decode for low latency.

### 17.6 Native (iOS/Android/Desktop)

-   **iOS:** Swift Package + static C/C++/Rust core.
-   **Android:** AAR (Kotlin) with JNI to C/C++ core if needed.
-   **Desktop:** Rust/C++ lib, Node addons for Electron.
-   **Endianness:** operate on byte arrays (endian‑agnostic).

### 17.7 Rule Budget & Compatibility

-   **Budget:** ≤ 2k ops/KB; P95 JSON ≤10 KB < 1 ms on mid‑range mobile; minimal allocations.
-   **Forbidden in hot path:** PBKDF, SHA‑heavy, big‑int crypto.
-   **Gauntlet:** test against gzip/brotli, Unicode normalization, proxy/CDN rewrites, and media pipelines.

### 17.8 Packaging

-   **Web/Node:** ESM + CJS with d.ts; optional WASM.
-   **RN:** JSI module; pods/gradle config.
-   **Edge:** ESM only.
-   **Native:** static libs + thin adapters.

**Claim wording.** By keeping cores simple and dependency‑free, FISE can be implemented consistently across platforms while preserving performance (parallel, block‑local) and robustness (Gauntlet‑tested lanes).

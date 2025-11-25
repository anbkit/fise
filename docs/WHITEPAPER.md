# FISE Whitepaper (v1.0)

**Fast Internet Secure Extensible — a rule‑based, keyless, high‑performance _semantic envelope_ for Web/API data**

> **Positioning (TL;DR)**  
> FISE is **not cryptography** and does not replace TLS/AuthZ. It is a **semantic obfuscation layer** that raises the *cost and time* of scraping and reverse‑engineering client‑visible data, while keeping runtime overhead extremely low.

---

## Abstract

Modern web apps must render meaningful JSON on the client. HTTPS protects transport, but **data meaning** remains exposed in the browser, making large‑scale scraping and cloning cheap. Traditional client‑side encryption requires keys in the frontend, which attackers can read; heavy crypto also adds latency.

**FISE** proposes a **rule‑based, keyless transformation pipeline** that “wraps” responses in a polymorphic **semantic envelope**. Each application (and optionally each session/request) uses a unique, rotating rule‑set to assemble salt, offsets, and metadata into a structure with **no protocol‑level universal decoder**—attackers must tailor a decoder per pipeline. FISE focuses on *raising attacker cost* (not secrecy), with **microsecond‑level** encode/decode on commodity devices.

FISE complements, not replaces: TLS, authentication/authorization, backend rate‑limits, or cryptography for secrets. It is best suited where **data itself is the asset** (e.g., curated POI, pricing, recommendations, AI metadata).

---

## 1. Introduction

REST/GraphQL APIs commonly return plaintext JSON. Despite TLS, the browser must see readable data, enabling:

- automated scraping
- competitive data harvesting / dataset cloning
- inference of business logic from response shapes
- unauthorized third‑party reuse

**Goal**: protect **semantic meaning** without frontend keys or heavy crypto, by **diversifying and rotating** a lightweight envelope that is cheap to run but expensive to reverse for each target.

---

## 2. Problem Statement

### 2.1 Client visibility is inherent
Even with HTTPS:
- DevTools exposes plaintext JSON.
- Headless browsers can fetch like any user.
- Response schemas leak domain logic.

### 2.2 Why traditional crypto under‑delivers on the client
- **Keys must reside in the frontend** → discoverable.
- **Operational cost** per request (key derivation/expansion, AEAD) is non‑trivial on low‑end clients.
- Resulting ciphertext still needs **client‑side decryption** → plaintext inevitably appears in memory/DOM.

### 2.3 Scraping today is cheap
A few fetch calls and pagination often suffice to replicate valuable datasets at scale, creating **business risk** wherever data is the moat.

---

## 3. Design Philosophy

1. **Keyless by design** — no static client key to steal.  
2. **Security through diversity** — each app/session/request may use a different rule‑set.  
3. **Infinite customization** — salts, offsets, metadata channels, ciphers (optional), assembly strategies.  
4. **Semantic obfuscation** — protect *meaning*, not transport.  
5. **Cheap to run, costly to reverse** — microsecond‑level ops; no universal, protocol‑level decoder.

---

## 4. The FISE Transformation Pipeline

A concrete deployment chooses and **rotates** among multiple rule‑sets. A typical encode flow:

### 4.1 Salt & Entropy
- Variable‑length salt (10–99 chars or app‑defined).  
- Entropy sources: CSPRNG (preferred), timestamp mixes, rolling checksums.  
- **Recommendation**: use server‑side CSPRNG to avoid predictability.

### 4.2 Metadata Encoding
Encode salt length, offsets, rule‑set id, optional request/session binding tags via one or more channels:
- base36/base62/hex
- emoji lanes
- zero‑width characters
- XOR signatures / parity bits

### 4.3 Optional Cipher Layer
- XOR or AES/WASM stage is **optional** to balance performance vs. resilience.  
- If used, it **does not rely on a client secret** for security claims; it only raises effort.

### 4.4 Offset Calculation
Offsets decide where to place metadata, salt, and decoy. They may derive from:
- rule‑set id
- timestamp buckets
- prime sequences / rolling checksums
- request/session bindings

### 4.5 Envelope Assembly
Interleave (data + salt + metadata [+ decoy]) into a **non‑deterministic**, non‑fixed format.

### 4.6 Final Output
A string/byte stream with **no fixed structure** shared across deployments. There is **no protocol‑level universal decoder**; decoding requires the **matching rule‑set**.

---

## 5. Decoding

Given a matching rule‑set:
1. Extract/locate metadata via channel heuristics.  
2. Recover salt length & offsets; validate request/session bindings.  
3. Remove salt/decoy; unwind transformations.  
4. Reverse optional cipher stage.  
5. Restore plaintext JSON for rendering.

---

## 6. Security Model

### 6.1 What FISE mitigates
- Commodity scrapers relying on stable, predictable JSON.  
- Universal or reusable decoders across many targets.  
- Blind replay/tamper (when **server verification** is enabled).  
- Rapid cloning of curated datasets (cost ↑).

### 6.2 What FISE does **not** replace
- TLS (transport), authentication/authorization, access control.  
- Backend bot controls (rate limit, behavior scoring).  
- Cryptography for secrets/PII.  
- DRM‑like guarantees.

### 6.3 Attacker‑in‑the‑browser (AitB)
Attackers can run your app, hook decode functions, or dump plaintext **after** decode. FISE **cannot prevent** post‑decode access; it **raises the effort** to reach and sustain that point, especially under rotation and validation.

### 6.4 Replay & Tamper (recommended hardening)
- **Request/Session binding**: include a hash of `(method|path|query|sessionId|tsBucket)` in metadata.  
- **Server‑side verification**: HMAC (server key only) covering metadata & bindings to reject altered or stale envelopes.  
- **Short‑lived validity**: timestamp buckets + skew windows.

### 6.5 Normalization resistance
- Design channels that survive gzip, Unicode normalization, and CDN transformations.  
- Multi‑channel redundancy to tolerate lossy intermediaries.

### 6.6 Rotation
- **Per‑session** or **per‑request** rule‑set rotation drastically increases reverse‑engineering cost and decoder maintenance.

> **Claim wording**: We do **not** claim “impossible to decode.” We claim **no protocol‑level universal decoder**, and **significant per‑target cost** under rotation, validation, and normalization‑resistant channels.

---

## 7. Comparison

| Feature                         | AES/WebCrypto    | Obfuscation libs (generic) | **FISE (this work)**                    |
| ------------------------------- | ---------------- | -------------------------- | --------------------------------------- |
| Requires client key             | **Yes**          | No                         | **No**                                  |
| Universal decoder               | N/A (standard)   | Often                      | **No protocol‑level universal decoder** |
| Performance (client)            | Medium–High cost | Fast                       | **Very fast (microseconds)**            |
| Predictability                  | Fixed format     | Medium                     | **Non‑fixed, rotating**                 |
| Semantic protection             | Not the goal     | Partial                    | **Strong focus**                        |
| Per‑app uniqueness              | No               | Limited                    | **Yes**; per‑session/request capable    |
| Server validation (anti‑replay) | Optional (MAC)   | Rare                       | **First‑class option (HMAC)**           |

---

## 8. Performance

### 8.1 Microbenchmarks (illustrative)
- **Encode**: ~0.02–0.04 ms  
- **Decode**: ~0.01–0.02 ms  
- Optional AES/WASM stage: add 0.1–0.3 ms typical

### 8.2 Methodology (to report in evaluations)
- Payload sizes: 1 KB, 10 KB, 50 KB.  
- Environments: Desktop (M‑series), Android mid‑range, iOS mid‑range.  
- Report **mean, stdev, P95/P99**.  
- Measure **end‑to‑end** impact (server encode → client decode → render).

---

## 9. Deployment Guidance

### 9.1 Minimal (Lean) Profile
- Server: encode + HMAC verify endpoints.  
- Client: JS/RN decode runtime.  
- Rotation: 2–4 rule‑sets, per‑session selector.  
- Bindings: method/path/query + sessionId + timestamp bucket.  
- Bot controls: rate limits, light CAPTCHA/Turnstile where appropriate.

### 9.2 Normalization & CDN
- Validate channels across gzip/brotli, Unicode NFC/NFKC, proxies/CDN.  
- Provide fallback multi‑channel metadata if a lane is stripped.

### 9.3 Observability
- Log P50/P95 encode/decode, failure reasons, suspected tamper, rotation distribution.  
- A/B toggles to quantify real‑world scraping reduction.

---

## 10. Use Cases

- Web/API response protection where **data is the product**: POI/travel, pricing, recommendations, AI metadata.  
- Admin dashboards/mobile apps exposing sensitive analytics (non‑secret).  
- Aggregation portals (news/content) reducing bulk harvesting.

**Not recommended** for secrets/PII/keys—use standard cryptography and access control.

---

## 11. Evaluation & KPIs

- **Scraping reduction** (A/B): drop in effective scraper throughput (target ≥ 50–70%).  
- **Time‑to‑decoder** for red‑team per rule‑set (target ≥ 5× vs. baseline).  
- Decoder breakage rate under **rotation** (maintenance cost for attacker).  
- Client overhead P95 < 1 ms on mid‑range devices for ≤10 KB payloads.

---

## 12. Future Work

- Multi‑block interleaving & decoy noise segments.  
- Per‑request **rule‑set rotation** with server seed.  
- Browser‑optimized **WASM fast path**.  
- DSL & **codegen** for polymorphic‑by‑build pipelines.  
- Watermarking/attribution bits for leak tracing.  
- Tamper detectors and heuristic anti‑hook signals.

---

## 13. Conclusion

FISE reframes client‑side protection as a **semantic, rule‑based envelope**: keyless, rotating, and cheap to run. It **does not prevent** post‑decode access, but it **raises attacker cost** substantially by eliminating a protocol‑level universal decoder and coupling data to diversified, validated rule‑sets. Used alongside TLS/AuthZ, rate‑limits, and behavior defenses, FISE provides **practical defense‑in‑depth** for teams—especially small teams—whose competitive edge lies in the data they deliver to clients.

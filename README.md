# FISE — Fast Internet Secure Extensible

[![npm version](https://img.shields.io/npm/v/fise.svg)](https://www.npmjs.com/package/fise)
[![npm downloads](https://img.shields.io/npm/dm/fise.svg)](https://www.npmjs.com/package/fise)
[![license](https://img.shields.io/github/license/anbkit/fise)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-3178C6)](https://www.typescriptlang.org/)

---

## 🔥 What is FISE?

**FISE is a keyless, rule-based, high-performance _semantic envelope_ for protecting the _meaning_ of API responses and frontend data.**

-   **Not a replacement** for AES, TLS, or authentication/authorization.
-   Built for **web response protection**, where traditional crypto is heavy _or_ requires exposing static keys in the frontend.
-   Focused on:
    -   ⚡ high-speed transformations
    -   🧩 rule-based semantic obfuscation
    -   ♾️ unbounded customization & rotation
    -   🔀 zero shared format across apps

> **Calibrated claim:** there is **no protocol-level universal decoder** across FISE deployments. Attackers must tailor a decoder **per pipeline / session window**, and rotation increases their maintenance cost.

---

### 🧭 Design Principle — Shared Ephemeral Rule (Not a Client Key)

FISE does **not** ship reusable decrypt keys to the client. Instead, the server injects a
**per-session, time-rotated rule** (“rules-as-code”) that the client uses only within that
session/window. Rules are **heterogeneous per chunk**, **bound to context**
(`method | pathHash | sessionIdHash | tsBucket`), and **expire quickly** under rotation.
Optionally, the server applies a **server-only HMAC over bindings** to add integrity and
non-transferability across routes/sessions.

> **Rules as Code, Not Keys.**  
> **Rotate Rules, Not Secrets.**

## ⚡ Performance

See detailed benchmarks and methodology in [`docs/PERFORMANCE.md`](./docs/PERFORMANCE.md).

---

## 🔐 The True Strength of FISE: Infinite Customization, Zero Standard Format

FISE does **not** rely on a single encryption scheme. Its strength comes from **unpredictability** and **per‑application uniqueness**.

Each implementation can be entirely different:

-   no fixed envelope format
-   no universal salt position
-   no predictable metadata
-   no shared offset rule
-   no constant cipher
-   no standard scanning method
-   no global structure

**Every website/app becomes its own _encryption dialect_.**

You can customize:

-   salt generation
-   salt placement (front, end, interleave, fragmented)
-   timestamp‑based entropy
-   metadata encoding (base36, base62, emoji, hex, XOR, zero‑width)
-   metadata size
-   offset rules
-   scanning patterns (charCodeAt, primes, XOR signature)
-   optional ciphers (AES, XOR, hybrid/WASM)
-   envelope assembly strategy
-   decoy/noise injection

The customization space is **effectively infinite** → two apps almost never share the same pipeline.

**This yields practical security properties:**

-   ❌ **No protocol‑level universal decoder**
-   🔒 Reverse‑engineering one FISE target does **not** help decode another
-   🧩 No fixed patterns
-   🔄 Rules can rotate or regenerate instantly
-   🎭 Security comes from **diversity**, not secrecy

> FISE turns every app into a **unique encryption language**.

---

## 🏎️ Streaming & Parallel Pipelines (v1.0)

FISE supports **chunked, block‑local pipelines** that **encode/decode in parallel** and let clients start rendering **before** the full payload arrives.

-   **Framed mode**: super‑header + per‑chunk metadata (bindings, offsets).
-   **Per‑chunk rotation/binding** + optional **server‑side HMAC** → higher attacker maintenance cost.
-   Works with HTTP chunked/fetch streaming/Web Workers/JSI/WASM threads.

See whitepaper §4.7, §6.7, §8.3, §9.4.

---

## 🔁 Two‑Way Semantic Envelope

FISE can protect **both directions** with the _same per‑session rule family_:

-   **Responses (default):** wrap JSON/media segments; client unwraps in parallel (Workers/JSI/WASM).
-   **Requests (optional):** wrap **non‑secret** payloads to obfuscate request semantics. Server verifies bindings (`method|pathHash|sessionIdHash|tsBucket[|tokenHash]`) and decodes.
    > Not a replacement for HTTPS/JWT/DPoP/CSRF — it’s an adjunct to raise attacker cost.

---

## 🎬 Media Profiles

### 1) Segment‑Envelope (container‑preserving)

Wrap **video segments** (HLS/DASH/CMAF) and **image files/tiles** with FISE; client unwraps in workers and feeds raw bytes to MSE (video) or `Blob` (image).

-   **Pros**: CDN‑friendly, highly robust, easy to deploy.
-   **Use for**: baseline protection and anti‑hotlink/anti‑bulk fetch.

### 2) Critical‑Fragment Obfuscation (selective partial protection)

Obfuscate **0.5–3%** bytes that are **structurally critical**, then restore client‑side:

-   **Video**: touch **init** (SPS/PPS, seq hdr/OBU) + selective **IDR tiles/slice header**.
-   **Images**: **JPEG MCU** start, **Huffman/Quant** deltas; **WebP/AVIF** small header/tile perturbations.
-   **Client**: restore per‑chunk via workers/JSI/WASM → MSE/Blob.
-   **Notes**: validate against recompression; pair with Segment‑Envelope when CDN may mutate assets.

### 3) Live Event Anti‑Restream Profile

-   Per‑session bootstrap (signed, no‑store)
-   Per‑segment envelope (2–4s) + **HMAC(meta‖chunkIndex‖bindings)**
-   Pool of 3–8 rules, **deterministic selection** per chunk
-   **Time‑bucket rotation** (e.g., every 15–30s)
-   Optional **critical fragments** on init + IDR
-   Optional **watermark** per session

**Effect**: legit clients play immediately; restreamers accumulate latency debt (find bootstrap → craft decoders → chase rotations).

---

## 📦 Installation

```bash
npm install fise
# or
pnpm add fise
# or
yarn add fise
```

---

## 🚀 Quick Start

**New to FISE?** Start here: **[Quick Start Guide](./docs/QUICK_START.md)** ⚡

**Any developer can write their unique rules** - this is FISE's superpower! The Quick Start guide shows how easy it is - just copy `defaultRules` and modify the offset function!

FISE is incredibly simple - you only need **3 security points**. Here's a complete example:

**Rules definition (shared between backend and frontend):**

```typescript
// rules.ts - Shared between backend and frontend
import { defaultRules } from "fise";

// Just copy defaultRules and modify the offset!
export const myRules = {
  ...defaultRules,
  offset(c, ctx) {
    // Your unique offset - just change the multiplier/modulo!
    const t = ctx.timestamp ?? 0;
    return (c.length * 13 + (t % 17)) % c.length; // Different primes!
  }
};
```

**Backend (encrypt):**

```typescript
// backend/api/data.ts
import { encryptFise, xorCipher } from "fise";
import { myRules } from "../rules.js";

app.get('/api/data', (req, res) => {
  const plaintext = "Hello, World!";
  const encrypted = encryptFise(plaintext, xorCipher, myRules);
  // encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
  // (sample base64-encoded output - actual encrypted text will vary due to random salt)
  
  res.json({ data: encrypted });
});
```

**Frontend (decrypt):**

```typescript
// frontend/services/data.ts
import { decryptFise, xorCipher } from "fise";
import { myRules } from "../rules.js";

const { data: encrypted } = await fetch('/api/data').then(r => r.json());
// encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
const decrypted = decryptFise(encrypted, xorCipher, myRules);
// decrypted: "Hello, World!" (decrypted plaintext)
console.log(decrypted); // "Hello, World!"
```

That's it! Everything else is automated. 

**Want more options?** Use `FiseBuilder` presets for quick rule generation:
```typescript
import { FiseBuilder } from "fise";
export const rules = FiseBuilder.defaults().build();
// or FiseBuilder.hex(), FiseBuilder.base62(), etc.
```

See [Quick Start Guide](./docs/QUICK_START.md) for more examples and patterns.

## 🚀 Basic Usage

### Simple Example

**Backend (encrypt):**

```typescript
// backend/api/simple.ts
import { encryptFise, xorCipher, defaultRules } from "fise";

app.get('/api/simple', (req, res) => {
  const plaintext = "Hello, world!";
  const encrypted = encryptFise(plaintext, xorCipher, defaultRules);
  // encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
  // (sample base64-encoded output - actual encrypted text will vary due to random salt)
  
  res.json({ data: encrypted });
});
```

**Frontend (decrypt):**

```typescript
// frontend/services/simple.ts
import { decryptFise, xorCipher, defaultRules } from "fise";

const { data: encrypted } = await fetch('/api/simple').then(r => r.json());
// encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
const decrypted = decryptFise(encrypted, xorCipher, defaultRules);
// decrypted: "Hello, world!" (decrypted plaintext)
console.log(decrypted); // "Hello, world!"
```

### With Timestamp Options

**Backend (encrypt with timestamp):**

```typescript
// backend/api/timestamp.ts
import { encryptFise, xorCipher, defaultRules } from "fise";

app.get('/api/data', (req, res) => {
  const data = { hello: "world", timestamp: Date.now() };
  const timestamp = Math.floor(Date.now() / 60000);
  
  const encrypted = encryptFise(
    JSON.stringify(data),
    xorCipher,
    defaultRules,
    {
      timestamp
    }
  );
  // encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
  // (sample base64-encoded output - actual encrypted text will vary due to random salt)
  
  res.json({ data: encrypted });
});
```

**Frontend (decrypt with matching timestamp):**

```typescript
// frontend/services/data.ts
import { decryptFise, xorCipher, defaultRules } from "fise";

const { data: encrypted } = await fetch('/api/data').then(r => r.json());
// encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
const timestamp = Math.floor(Date.now() / 60000);

const decrypted = decryptFise(encrypted, xorCipher, defaultRules, {
  timestamp
});
// decrypted: '{"hello":"world","timestamp":1234567890}' (decrypted JSON string)
const data = JSON.parse(decrypted);
console.log(data); // { hello: "world", timestamp: 1234567890 }
```

> Server‑side may add **HMAC verification** on metadata (key stays on server) to reject tamper/replay. See `docs/SECURITY.md`.

---

## 🧩 Architecture Overview

A FISE transformation pipeline includes:

1. Salt generation (CSPRNG recommended)
2. Metadata encoding (base36/62, emoji, zero‑width, etc.)
3. Optional cipher layer (e.g., XOR/AES/WASM)
4. Offset calculation (timestamp, primes, checksums, bindings)
5. Envelope assembly & decoy insertion
6. Final packed string

Every stage is customizable; **rotation** is strongly recommended.

> 📖 For complete technical details, see the [**FISE Whitepaper**](./docs/WHITEPAPER.md) (v1.0)

---

## 📚 Documentation

-   `docs/RULES.md` — rule customization & rotation policies
-   `docs/SPEC.md` — transformation spec (encode/decode symmetry)
-   `docs/PERFORMANCE.md` — benchmarks & methodology
-   `docs/SECURITY.md` — threat model & hardening guide
-   `docs/WHITEPAPER.md` — full whitepaper (**v1.0**)

---

## 🛡 Security Philosophy

FISE is _not_ AES.  
FISE is _not_ a replacement for secret‑grade encryption.

It is a **semantic protection layer** built for:

-   anti‑scraping
-   data obfuscation
-   protecting curated datasets
-   raising attacker cost
-   avoiding universal decoders
-   preventing naive dataset cloning

---

## 🌱 The Future Direction of FISE

FISE is not just a library — it is evolving into a **platform** for creating, sharing, and generating rule‑based pipelines.

### 🌐 Multi-Language & Multi-Platform Support

Core FISE is dependency‑free, linear byte/byte‑string ops (O(n)), making it portable across platforms and languages. Since FISE only requires **3 simple methods** (`offset`, `encodeLength`, `decodeLength`), it can be easily implemented in:

**Backend Languages:**
-   **JavaScript/TypeScript** ✅ (reference implementation)
-   **Python** 🛠 (for Django, Flask, FastAPI)
-   **Go** 🛠 (for high-performance APIs)
-   **Rust** 🛠 (for maximum performance, WASM bindings)
-   **Java/Kotlin** 🛠 (for Spring Boot, Android)
-   **PHP** 🛠 (for Laravel, Symfony)
-   **Ruby** 🛠 (for Rails)
-   **C#/.NET** 🛠 (for ASP.NET)
-   **C/C++** 🛠 (static library for embedded/desktop)

**Client Platforms:**
-   **Web** ✅ (JavaScript/TypeScript)
-   **WebAssembly** 🛠 (for Smart TV, embedded devices, high-performance web)
-   **React Native** 🛠 (via JSI or JS bridge)
-   **iOS (Swift)** 🛠 (native implementation)
-   **Android (Kotlin/Java)** 🛠 (native implementation)
-   **Flutter (Dart)** 🛠
-   **Desktop** 🛠 (Electron, Tauri)
-   **Smart TV** 🛠 (Tizen, webOS, Android TV via WebAssembly or native)
-   **Edge Runtimes** 🛠 (CF Workers/Deno/Bun/Vercel Edge)

**Key Benefits:**
-   Same rules work across all implementations
-   Simple to port — just implement 3 methods
-   No complex dependencies
-   Fast and lightweight

All implementations must maintain **byte-for-byte compatibility** with the reference implementation to ensure rules work across all platforms. See the [**Golden Test Suite**](./docs/WHITEPAPER.md) requirements.

### 🧩 Community Rule Ecosystem (Planned)

Developers will be able to publish:

-   lightweight rule‑sets
-   high‑entropy rule‑sets
-   emoji‑channel metadata rules
-   zero‑width metadata encoders
-   timestamp‑derived offset models
-   AES/XOR hybrid pipelines
-   WASM‑optimized rules

Each application can choose or combine multiple rule packs → accelerating diversity.  
This **reduces cross‑target reuse**, making universal attacks across apps impractical.

### 🎨 Rule Builder (Upcoming)

A **visual rule builder** will allow developers to design custom pipelines without security expertise:

-   choose salt generator
-   build metadata channels
-   define offsets
-   optionally add cipher stages
-   add rotation sets
-   preview final envelope shape

The builder will generate:

-   `encode()` server function
-   `decode()` client function
-   TypeScript typings
-   tests
-   performance hints
-   HMAC validation helpers

Anyone can build a full FISE pipeline — **no crypto expertise required**.

### 🤖 AI‑Generated Custom Rules

Because FISE pipelines have vast variability, rule‑sets can be **generated by AI** safely:

-   describe your requirements (speed, entropy, CDN safety, rotation frequency)
-   AI outputs a **unique** rule‑set
-   no two AI‑generated pipelines need to be alike

FISE becomes stronger as the ecosystem grows.

### 🌐 Community Rule Index (Future)

We plan to maintain a public rule index:

-   curated, well‑tested rules
-   experimental research rules
-   normalization‑resistant channels
-   multi‑layer offset packs
-   WASM fast‑path pipelines

Each rule pack will include:

-   encode/decode implementation
-   documentation
-   performance metrics
-   CDN/Unicode normalization safety
-   tests
-   security considerations

---

## 🤝 Contributing

We welcome:

-   rule designs
-   offset strategies
-   scanner patterns
-   cipher extensions
-   performance optimizations
-   ecosystem proposals

See `CONTRIBUTING.md`.

---

## 📄 License

MIT © An Nguyen

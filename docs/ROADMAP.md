# FISE Roadmap

This document outlines the planned features and future direction of FISE.

---

## 🚧 In Progress

### PHP Laravel Support
- **Status**: 🚧 In Progress
- **Description**: Native PHP implementation for Laravel, Symfony, CodeIgniter, and Slim frameworks
- **Target**: Full compatibility with JavaScript/TypeScript reference implementation

---

## 🛠 Planned Features

### 🌐 Multi-Language & Multi-Platform Support

FISE is designed to be portable across platforms and languages. Since FISE only requires **3 simple methods** (`offset`, `encodeLength`, `decodeLength`), it can be easily implemented in:

**Backend Languages:**
- **Python** 🛠 (for Django, Flask, FastAPI)
- **Go** 🛠 (for high-performance APIs)
- **Rust** 🛠 (for maximum performance, WASM bindings)
- **Java/Kotlin** 🛠 (for Spring Boot, Android)
- **Ruby** 🛠 (for Rails)
- **C#/.NET** 🛠 (for ASP.NET)
- **C/C++** 🛠 (static library for embedded/desktop)

**Client Platforms:**
- **WebAssembly** 🛠 (for Smart TV, embedded devices, high-performance web)
- **React Native** 🛠 (via JSI or JS bridge)
- **iOS (Swift)** 🛠 (native implementation)
- **Android (Kotlin/Java)** 🛠 (native implementation)
- **Flutter (Dart)** 🛠
- **Desktop** 🛠 (Electron, Tauri)
- **Smart TV** 🛠 (Tizen, webOS, Android TV via WebAssembly or native)

#### Implementation Complexity

Each language implementation requires approximately **200-250 lines of code** using only standard library functions:

| Language        | Lines of Code | Dependencies | Estimated Time |
| --------------- | ------------- | ------------ | -------------- |
| **Python**      | ~200          | stdlib only  | 1 day          |
| **PHP Laravel** | ~200          | none         | 1 day          |
| **Go**          | ~200          | stdlib only  | 1 day          |
| **Rust**        | ~250          | minimal      | 1-2 days       |
| **Java/Kotlin** | ~250          | stdlib only  | 1 day          |
| **Ruby**        | ~200          | stdlib only  | 1 day          |
| **C#/.NET**     | ~250          | stdlib only  | 1 day          |
| **C/C++**       | ~300          | stdlib only  | 2 days         |

#### What Needs to be Implemented

Only **3 core methods** are required:

```typescript
interface FiseRules {
  offset(cipherText, ctx) → number      // Where to place metadata
  encodeLength(len, ctx) → string       // How to encode length
  decodeLength(encoded, ctx) → number   // How to decode length
}
```

Plus:
- `fiseEncrypt()` / `fiseDecrypt()` functions
- XOR cipher (or custom cipher)
- Base64 encode/decode helpers
- Random salt generator

**Key Requirements:**
- All implementations must maintain **byte-for-byte compatibility** with the reference implementation
- See the [**Golden Test Suite**](./WHITEPAPER.md) requirements
- See [**Platform Support Guide**](./PLATFORM_SUPPORT.md) for detailed information, examples, and current status

#### Platform Status Summary

| Platform        | Status        | Package            | Documentation                   |
| --------------- | ------------- | ------------------ | ------------------------------- |
| **Node.js**     | ✅ Stable      | `npm install fise` | [Quick Start](./QUICK_START.md) |
| **Browser**     | ✅ Stable      | `npm install fise` | [Quick Start](./QUICK_START.md) |
| **Deno**        | ✅ Stable      | `npm install fise` | [Quick Start](./QUICK_START.md) |
| **Bun**         | ✅ Stable      | `npm install fise` | [Quick Start](./QUICK_START.md) |
| **PHP Laravel** | 🚧 In Progress | TBD                | TBD                             |
| **Python**      | 🛠 Planned     | TBD                | TBD                             |
| **Go**          | 🛠 Planned     | TBD                | TBD                             |
| **Rust**        | 🛠 Planned     | TBD                | TBD                             |
| **Java/Kotlin** | 🛠 Planned     | TBD                | TBD                             |
| **Ruby**        | 🛠 Planned     | TBD                | TBD                             |
| **C#/.NET**     | 🛠 Planned     | TBD                | TBD                             |
| **Swift**       | 🛠 Planned     | TBD                | TBD                             |
| **Dart**        | 🛠 Planned     | TBD                | TBD                             |

> For the most up-to-date platform status, see [**Platform Support Guide**](./PLATFORM_SUPPORT.md)

---

### 🔧 (Optional) Build a frontend build-time plugin to obfuscate FISE callsites and harden client-side decoding

**Status**: 🛠 Planned

**Description**: A frontend build-time plugin that obfuscates FISE callsites and hardens client-side decoding through deep minification and code transformation.

> **Note**: This plugin is optional. FISE works perfectly without it, but the plugin provides additional security through code obfuscation for applications that need maximum protection. Recommended for production builds requiring enhanced security.

**Benefits:**
- 🔒 **Enhanced Security**: Obfuscates the FISE code itself, adding another layer of protection
- 🎭 **Build-Time Uniqueness**: Each build can produce different minified code, further diversifying deployments
- ⚡ **Performance**: Smaller bundle sizes and better tree-shaking
- 🚀 **Production-Ready**: Optimized builds specifically for deployment

**Implementation Approaches:**
- Plugin for popular bundlers (Webpack, Vite, Rollup, esbuild)
- Build-time code transformation and obfuscation
- Rule inlining and dead code elimination
- Per-build code variations for uniqueness

**Use Cases:**
- Production builds that need maximum obfuscation
- Applications requiring minimal bundle size
- Enhanced security through code diversity

**Technical Considerations:**
- Must maintain functionality while obfuscating
- Should work with existing FISE rules
- Compatible with tree-shaking and code splitting
- Support for different obfuscation levels

---

### 🧩 Community Rule Ecosystem

**Status**: 🛠 Planned

Developers will be able to publish and share:

- Lightweight rule‑sets
- High‑entropy rule‑sets
- Emoji‑channel metadata rules
- Zero‑width metadata encoders
- Timestamp‑derived offset models
- AES/XOR hybrid pipelines
- WASM‑optimized rules

Each application can choose or combine multiple rule packs → accelerating diversity.  
This **reduces cross‑target reuse**, making universal attacks across apps impractical.

---

### 🎨 Visual Rule Builder

**Status**: 🛠 Planned

A **visual rule builder** that allows developers to design custom pipelines without security expertise:

**Features:**
- Choose salt generator
- Build metadata channels
- Define offsets
- Optionally add cipher stages
- Add rotation sets
- Preview final envelope shape

**Output:**
- `encode()` server function
- `decode()` client function
- TypeScript typings
- Tests
- Performance hints
- HMAC validation helpers

Anyone can build a full FISE pipeline — **no crypto expertise required**.

---

### 🌐 Community Rule Index

**Status**: 🛠 Planned

A public rule index featuring:

- Curated, well‑tested rules
- Experimental research rules
- Normalization‑resistant channels
- Multi‑layer offset packs
- WASM fast‑path pipelines

Each rule pack will include:

- Encode/decode implementation
- Documentation
- Performance metrics
- CDN/Unicode normalization safety
- Tests
- Security considerations

---

## 💡 Ideas & Considerations

### Potential Future Enhancements

- **CLI Tool**: Command-line interface for rule generation and testing
- **VS Code Extension**: IDE support for FISE development
- **Performance Profiler**: Built-in performance analysis tools
- **Rule Validator**: Automated testing and validation of custom rules
- **Migration Tools**: Help migrate between different rule versions
- **CDN Integration**: Direct integration with popular CDNs
- **Monitoring & Analytics**: Track encryption/decryption performance in production

---

## 📝 Notes

- This roadmap is subject to change based on community feedback and priorities
- Features are not guaranteed to be implemented in the order listed
- Community contributions are welcome for any planned features
- See [CONTRIBUTING.md](../CONTRIBUTING.md) for how to contribute

---

## 🔗 Related Documentation

- [Platform Support Guide](./PLATFORM_SUPPORT.md) — Current platform support status
- [Quick Start Guide](./QUICK_START.md) — Get started with FISE
- [Rules Guide](./RULES.md) — Customize your rules
- [Security Guide](./SECURITY.md) — Security best practices
- [Whitepaper](./WHITEPAPER.md) — Technical deep dive


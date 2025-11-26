# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - Latest

### Changed
- **Breaking**: Updated import paths for cleaner usage. Users can now import directly from `fise` without specifying the `dist/` directory:
  ```ts
  // Before
  import { encryptFise } from 'fise/dist/encryptFise';
  import { defaultRules } from 'fise/dist/rules/defaultRules';
  
  // After
  import { encryptFise, decryptFise, xorCipher, defaultRules } from 'fise';
  ```
- Added `exports` field to `package.json` for modern Node.js module resolution
- Created main entry point at `src/index.ts` that exports all public APIs
- Updated README with new import examples

### Added
- Main entry point (`src/index.ts`) exporting all public APIs:
  - `encryptFise`, `decryptFise`
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
- Core encryption/decryption functions (`encryptFise`, `decryptFise`)
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

[0.1.2]: https://github.com/anbkit/fise/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/anbkit/fise/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/anbkit/fise/releases/tag/v0.1.0

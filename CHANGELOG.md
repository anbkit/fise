# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3] - Latest

### Breaking Changes
- **FiseRules interface simplified**: Now only requires 3 core methods (`offset`, `encodeLength`, `decodeLength`). All other methods are optional and handled internally with secure defaults.
- **Removed interfaces**: `SimpleFiseRules`, `MinimalFiseRules`, `UltraMinimalFiseRules` - use `FiseRules` for all cases.
- **Removed from FiseRules**: `encodedLengthSize`, `saltPosition`, `preExtractLength`, `scanForEncodedLength` - these are now internal.
- **EncryptOptions simplified**: Removed `minSaltLength` and `maxSaltLength` - use `rules.saltRange` instead:
  ```ts
  // Before
  encryptFise(text, cipher, rules, { minSaltLength: 20, maxSaltLength: 50 });
  
  // After
  const rules = { ...defaultRules, saltRange: { min: 20, max: 50 } };
  encryptFise(text, cipher, rules);
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
- **encryptFise/decryptFise**: Updated to use simplified FiseRules interface with internal normalization
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

[0.1.3]: https://github.com/anbkit/fise/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/anbkit/fise/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/anbkit/fise/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/anbkit/fise/releases/tag/v0.1.0

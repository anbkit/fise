# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.4] - Latest

### Breaking Changes
- **Timestamp API**: Changed from `timestampMinutes` to `timestamp` in `EncryptOptions` and `DecryptOptions`
  - More flexible - accepts any numeric timestamp value (not limited to minutes)
  - Rules can interpret timestamp as needed (minutes, seconds, milliseconds, etc.)
  - **Migration**: Replace `timestampMinutes` with `timestamp` in your code:
    ```ts
    // Before
    encryptFise(data, cipher, rules, { timestampMinutes: 12345 });
    decryptFise(envelope, cipher, rules, { timestampMinutes: 12345 });
    
    // After
    encryptFise(data, cipher, rules, { timestamp: 12345 });
    decryptFise(envelope, cipher, rules, { timestamp: 12345 });
    ```

### Added
- **Binary Encryption Support**: Pure binary encryption/decryption for video, images, and other binary data
  - `encryptBinaryFise()` - Encrypts binary data (Uint8Array) with pure binary envelopes (no base64 conversion)
  - `decryptBinaryFise()` - Decrypts binary envelopes back to original binary data
  - `xorBinaryCipher` - Binary-optimized XOR cipher that operates directly on Uint8Array (no string conversion)
  - `defaultBinaryRules` - Binary-native rules optimized for Uint8Array operations
  - `randomSaltBinary()` - Generates random binary salt as Uint8Array
- **Rules Sharing**: String and binary encryption can now share the same `FiseRules` interface
  - Text-based rules automatically adapt to binary operations via `normalizeFiseRulesBinary()`
  - Binary-native rules (`FiseRules<Uint8Array>`) for optimal performance
  - Seamless interoperability between string and binary encryption modes
- **Metadata Support**: Added `metadata` field to `FiseContext`, `EncryptOptions`, and `DecryptOptions`
  - Pass custom values (e.g., `productId`, `userId`) to rules via `metadata` object
  - Rules can access metadata via `ctx.metadata?.productId`
  - Enables per-item encryption patterns (e.g., different encryption per product ID)
  - Metadata must match between encryption and decryption
- **Comprehensive Binary Test Suite**: Added `encryptFiseBinary.test.mjs` with 28 tests covering:
  - Basic binary encryption/decryption roundtrips
  - Large binary data (1MB+)
  - Video-like data (random bytes, 50KB+)
  - Edge cases (empty, single byte, all zeros, all 255s)
  - UTF-8 encoded text as binary
  - Image-like data (PNG headers)
  - Error handling (invalid envelopes, mismatched timestamps/metadata)
  - Rules sharing between string and binary modes
- **Performance Optimizations**: 
  - Binary envelopes avoid base64 conversion overhead
  - Direct Uint8Array operations for maximum speed
  - Optimized for large file encryption (videos, images)

### Changed
- **File Naming**: All imports updated to use new file name
- **Type System**: Enhanced `FiseRules<T>` to support both `string` and `Uint8Array` generics
  - `FiseRules<string>` for text-based encryption
  - `FiseRules<Uint8Array>` for binary encryption
  - Shared rules can work with both modes

### Fixed
- All 141 tests passing with binary encryption support

## [0.1.3]

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

[0.1.4]: https://github.com/anbkit/fise/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/anbkit/fise/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/anbkit/fise/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/anbkit/fise/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/anbkit/fise/releases/tag/v0.1.0

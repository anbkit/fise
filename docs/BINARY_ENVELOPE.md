# Binary Envelope Implementation

## Overview

FISE supports binary envelopes to avoid base64 conversions and work directly with `Uint8Array` throughout the encryption/decryption pipeline. This is ideal for video, images, files, and other binary data where base64 conversion would add unnecessary overhead.

## Architecture Comparison

### String-based (Traditional)
```
plaintext (string) 
  → cipher.encrypt() → cipherText (string)
  → rules.offset(cipherText) → offset (number)
  → rules.encodeLength() → encodedLen (string)
  → envelope = cipherText[0:offset] + encodedLen + cipherText[offset:] + salt (string)
```

### Binary-based (Implemented)
```
binaryData (Uint8Array)
  → cipher.encrypt() → cipherText (Uint8Array)
  → rules.offset(cipherText) → offset (number)
  → rules.encodeLength() → encodedLen (Uint8Array)
  → envelope = [cipherText[0:offset], encodedLen, cipherText[offset:], salt] (Uint8Array)
```

## Interfaces

### FiseBinaryCipher

```typescript
interface FiseBinaryCipher {
  encrypt(plaintext: Uint8Array, salt: Uint8Array): Uint8Array;
  decrypt(cipherText: Uint8Array, salt: Uint8Array): Uint8Array;
}
```

**Implementation**: `xorBinaryCipher` - XOR-based cipher that operates directly on binary data without base64 conversion.

### FiseRules (Generic)

The `FiseRules<T>` interface supports both string and binary operations:

```typescript
interface FiseRules<T extends string | Uint8Array = string> {
  // REQUIRED - Security Point #1
  offset(cipherText: T, ctx: FiseContext): number;
  
  // REQUIRED - Security Point #2
  encodeLength(len: number, ctx: FiseContext): T;
  
  // REQUIRED - Security Point #3
  decodeLength(encoded: T, ctx: FiseContext): number;
  
  // OPTIONAL
  saltRange?: { min: number; max: number };
  extractSalt?(envelope: T, saltLen: number, ctx: FiseContext): T;
  stripSalt?(envelope: T, saltLen: number, ctx: FiseContext): T;
}
```

**Key Feature**: Rules can be shared between string and binary encryption! Text-based rules automatically adapt to binary operations via `normalizeFiseRulesBinary()`.

## Functions

### fiseBinaryEncrypt

```typescript
function fiseBinaryEncrypt(
  binaryData: Uint8Array,
  rules: FiseRules<string | Uint8Array>, // Rules can be shared!
  options: EncryptOptions = {}
): Uint8Array
```

Encrypts binary data with a pure binary envelope (no base64 conversion).

**Example**:
```typescript
import { fiseBinaryEncrypt, defaultBinaryRules } from 'fise';

const videoData = new Uint8Array([...]); // Your binary data
const encrypted = fiseBinaryEncrypt(videoData, defaultBinaryRules);
// Returns: Uint8Array (pure binary envelope)
```

### fiseBinaryDecrypt

```typescript
function fiseBinaryDecrypt(
  envelope: Uint8Array,
  rules: FiseRules<string | Uint8Array>, // Rules can be shared!
  options: DecryptOptions = {}
): Uint8Array
```

Decrypts a binary envelope back to original binary data.

**Example**:
```typescript
import { fiseBinaryDecrypt, defaultBinaryRules } from 'fise';

const decrypted = fiseBinaryDecrypt(encrypted, defaultBinaryRules);
// Returns: Uint8Array (original binary data)
```

## Binary Envelope Structure

The binary envelope is assembled as:

```
[ ciphertext_prefix_bytes ] [ encoded_length_bytes ] [ ciphertext_suffix_bytes ] [ salt_bytes ]
```

**Example**:
- ciphertext: `[0x01, 0x02, 0x03, 0x04, 0x05, 0x06]` (6 bytes)
- offset: 2
- salt length: 15 → encoded as `[0x00, 0x0F]` (2 bytes, big-endian)
- salt: `[0x41, 0x42, ..., 0x4F]` (15 bytes)

**Envelope**: `[0x01, 0x02, 0x00, 0x0F, 0x03, 0x04, 0x05, 0x06, 0x41, 0x42, ..., 0x4F]`
```
└─┬──┘└─┬──┘└────┬────┘└──────────┬──────────┘└──────────┬──────────┘
  │      │        │                │                      │
  │      │        │                │                      └─ salt (15 bytes)
  │      │        │                └─ ciphertext_suffix
  │      │        └─ encoded_length (2 bytes)
  │      └─ ciphertext_prefix
```

## Benefits

1. **No base64 conversion overhead** - Work directly with binary data
2. **Smaller envelope size** - Binary encoding is more compact than base64 (~33% smaller)
3. **Better performance** - No string operations, direct byte manipulation
4. **Native binary support** - Perfect for video, images, files, and other binary formats
5. **Rules sharing** - Same rules can be used for both string and binary encryption

## Rules Sharing

One of the key features is that **rules can be shared** between string and binary encryption:

```typescript
// Define rules once
const rules = FiseBuilder.defaults().build();

// Use for string encryption
const encryptedString = fiseEncrypt("Hello", rules);

// Use for binary encryption (rules automatically adapt!)
const encryptedBinary = fiseBinaryEncrypt(binaryData, rules);
```

The `normalizeFiseRulesBinary()` function automatically adapts text-based rules to binary operations:
- Text-based `encodeLength` returning strings → converted to Uint8Array
- Offset calculations work on byte length
- All operations remain type-safe

## Implementation Details

### encodeLength
- Typically 1-4 bytes (e.g., 2 bytes for lengths up to 65535)
- `defaultBinaryRules` uses 2 bytes (big-endian) for salt lengths up to 65535
- Can be customized per application

### offset calculation
- Works on byte length, not character length
- Same timestamp-based calculation as string mode
- Offset is calculated from `cipherText.length` (bytes)

### salt
- Binary salt (Uint8Array) instead of string
- Generated via `randomSaltBinary(length)`
- Random bytes (0-255) for maximum entropy

### Backward compatibility
- String-based API (`fiseEncrypt`/`fiseDecrypt`) remains unchanged
- Binary API is additive - no breaking changes
- Both can coexist in the same application

## Example Binary Rules

### defaultBinaryRules

```typescript
import { defaultBinaryRules } from 'fise';

// Pre-configured binary rules optimized for Uint8Array
const encrypted = fiseBinaryEncrypt(data, defaultBinaryRules);
```

### Custom Binary Rules

```typescript
const customBinaryRules: FiseRules<Uint8Array> = {
  offset(cipherText: Uint8Array, ctx) {
    const t = ctx.timestamp ?? 0;
    const len = cipherText.length || 1;
    return (len * 7 + (t % 11)) % len;
  },
  
  encodeLength(len: number, ctx: FiseContext): Uint8Array {
    // Encode as 2 bytes (big-endian)
    const buf = new ArrayBuffer(2);
    new DataView(buf).setUint16(0, len, false);
    return new Uint8Array(buf);
  },
  
  decodeLength(encoded: Uint8Array, ctx: FiseContext): number {
    // Decode from 2 bytes (big-endian)
    return new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength)
      .getUint16(0, false);
  }
};
```

### Using FiseBuilder for Binary Rules

```typescript
import { FiseBuilder } from 'fise';

// Builder presets work with binary too!
const rules = FiseBuilder.defaults().build();

// Can be used for both string and binary
const strEncrypted = fiseEncrypt("text", rules);
const binEncrypted = fiseBinaryEncrypt(binaryData, rules);
```

## Performance Considerations

1. **Direct binary operations** - No string conversions means faster processing
2. **Memory efficient** - Uint8Array operations are optimized by JavaScript engines
3. **Large file support** - Can handle files of any size (tested with 1MB+)
4. **Parallel processing** - Binary operations can be easily parallelized with Web Workers

## Use Cases

- **Video encryption** - Encrypt video files without base64 overhead
- **Image protection** - Protect image data in transit
- **File encryption** - Encrypt any binary file format
- **Large payloads** - Better performance for large binary data
- **Streaming** - Binary format is ideal for streaming scenarios

## Migration from String-based

If you're currently using string-based encryption and want to switch to binary:

```typescript
// Before (string-based)
const text = "Hello World";
const encrypted = fiseEncrypt(text, rules);
const decrypted = fiseDecrypt(encrypted, rules);

// After (binary-based)
const binary = new TextEncoder().encode("Hello World");
const encrypted = fiseBinaryEncrypt(binary, rules);
const decrypted = fiseBinaryDecrypt(encrypted, rules);
const text = new TextDecoder().decode(decrypted);
```

**Note**: You can use the same rules for both! The normalization function handles the adaptation automatically.


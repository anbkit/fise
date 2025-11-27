# FISE Specification

## Version

This specification describes FISE v0.1.2+ (simplified rules architecture).

## Core Interfaces

### `FiseRules`

The core interface for FISE rules. Requires only 3 methods:

```typescript
interface FiseRules {
  // REQUIRED - Security Point #1
  offset(cipherText: string, ctx: FiseContext): number;
  
  // REQUIRED - Security Point #2
  encodeLength(len: number, ctx: FiseContext): string;
  
  // REQUIRED - Security Point #3
  decodeLength(encoded: string, ctx: FiseContext): number;
  
  // OPTIONAL
  saltRange?: { min: number; max: number };
  extractSalt?(envelope: string, saltLen: number, ctx: FiseContext): string;
  stripSalt?(envelope: string, saltLen: number, ctx: FiseContext): string;
  meta?: { name?: string; description?: string; source?: string; ... };
}
```

### `FiseContext`

Context information passed to rule methods:

```typescript
interface FiseContext {
  timestampMinutes?: number;  // Timestamp in minutes (for rotation)
  saltLength?: number;        // Current salt length (during decryption)
  randomSeed?: number;        // Optional random seed
}
```

### `FiseCipher`

Cipher interface for encryption/decryption:

```typescript
interface FiseCipher {
  encrypt(plaintext: string, salt: string): string;
  decrypt(cipherText: string, salt: string): string;
}
```

## Envelope Format

### Structure

```
[ ciphertext_prefix ] [ encoded_length ] [ ciphertext_suffix ] [ salt ]
```

Where:
- `ciphertext_prefix` + `ciphertext_suffix` = full ciphertext (split at offset)
- `encoded_length` = metadata (encoded salt length)
- `salt` = random salt string

### Example

For a ciphertext "abc123" with offset 2 and salt length 15:

```
offset = 2
encoded_length = "0f" (15 in base36)
salt = "randomSalt12345"

Envelope: "ab0fc123randomSalt12345"
          └─┬─┘└┬┘└─┬──┘└──────┬──────┘
            │   │   │          │
            │   │   │          └─ salt (15 chars)
            │   │   └─ ciphertext_suffix
            │   └─ encoded_length ("0f")
            └─ ciphertext_prefix
```

## Encryption Algorithm

### Inputs

- `plaintext: string` - The data to encrypt
- `cipher: FiseCipher` - The cipher implementation
- `rules: FiseRules` - The rules to use
- `options: EncryptOptions` - Optional encryption options

### Steps

1. **Normalize Rules**
   - Call `normalizeFiseRules(rules)` to fill in optional methods
   - Result: `NormalizedFiseRules` with all methods

2. **Generate Salt**
   - Get `saltRange` from rules (default: { min: 10, max: 99 })
   - Generate random salt length: `min + floor(random() * (max - min + 1))`
   - Generate random salt string of that length

3. **Encrypt Plaintext**
   - Call `cipher.encrypt(plaintext, salt)`
   - Result: `cipherText`

4. **Encode Salt Length**
   - Call `rules.encodeLength(saltLen, ctx)`
   - Result: `encodedLen` (e.g., "0a" for base36)

5. **Calculate Offset**
   - Call `rules.offset(cipherText, ctx)`
   - Clamp to valid range: `max(0, min(offset, cipherText.length))`
   - Result: `offset`

6. **Insert Metadata**
   - `cipherText.slice(0, offset) + encodedLen + cipherText.slice(offset)`
   - Result: `withLen`

7. **Append Salt**
   - `withLen + salt`
   - Result: `envelope` (final output)

## Decryption Algorithm

### Inputs

- `envelope: string` - The encrypted envelope
- `cipher: FiseCipher` - The cipher implementation (must match encryption)
- `rules: FiseRules` - The rules to use (must match encryption)
- `options: DecryptOptions` - Optional decryption options

### Steps

1. **Normalize Rules**
   - Call `normalizeFiseRules(rules)` to fill in optional methods
   - Result: `NormalizedFiseRules` with all methods

2. **Pre-Extract Length** (Brute-Force Search)
   - For each `saltLen` in `saltRange`:
     - Strip salt: `stripSalt(envelope, saltLen)`
     - For each position `i` in stripped string:
       - Extract candidate: `slice(i, i + encodedLengthSize)`
       - Decode: `decodeLength(candidate)`
       - If decoded length matches `saltLen`:
         - Remove metadata: `slice(0, i) + slice(i + encodedLengthSize)`
         - Calculate expected offset: `offset(candidate, ctx)`
         - If expected offset matches position `i`:
           - **Found!** Return `{ saltLength, encodedLength, withoutLen }`
   - If not found, throw error

3. **Extract Salt**
   - Call `extractSalt(envelope, saltLength, ctx)`
   - Result: `salt`

4. **Calculate Expected Offset**
   - Calculate ciphertext length: `withoutLen.length - encodedLengthSize`
   - Call `offset(dummyCipherText, ctx)` to get expected position
   - Result: `expectedOffset`

5. **Validate and Remove Metadata**
   - Check if metadata at `expectedOffset` matches `encodedLength`
   - If not, throw error
   - Remove metadata: `withoutLen.slice(0, expectedOffset) + withoutLen.slice(expectedOffset + encodedLengthSize)`
   - Result: `cipherText`

6. **Decrypt**
   - Call `cipher.decrypt(cipherText, salt)`
   - Result: `plaintext` (final output)

## Default Behaviors

### Salt Range

- **Default**: `{ min: 10, max: 99 }`
- **Override**: Set `rules.saltRange`

### Salt Extraction

- **Default**: Tail-based (salt at end)
  ```typescript
  extractSalt(envelope, saltLen) {
    return envelope.slice(-saltLen);
  }
  stripSalt(envelope, saltLen) {
    return envelope.slice(0, envelope.length - saltLen);
  }
  ```
- **Override**: Provide custom `extractSalt()` and `stripSalt()`

### Encoding

- **Default**: Base36, 2 characters
  ```typescript
  encodeLength(len) {
    return len.toString(36).padStart(2, "0");
  }
  decodeLength(encoded) {
    return parseInt(encoded, 36);
  }
  ```
- **Override**: Provide custom `encodeLength()` and `decodeLength()`

## Error Conditions

### Encryption Errors

- None (always succeeds if inputs are valid)

### Decryption Errors

1. **"FISE: cannot infer salt length from envelope."**
   - Cause: Brute-force search failed to find valid salt length
   - Possible reasons:
     - Wrong rules (offset/encoding mismatch)
     - Corrupted envelope
     - Wrong timestamp (if timestamp-dependent)

2. **"FISE: cannot find encoded length at expected offset."**
   - Cause: Metadata not found at expected position
   - Possible reasons:
     - Wrong rules
     - Wrong timestamp
     - Offset depends on content (not just length)

## Compliance

### Rule Requirements

1. **`offset()` must be deterministic**
   - Same inputs → same output
   - Must return valid index: `0 <= offset < cipherText.length`

2. **`encodeLength()` and `decodeLength()` must be inverse**
   - `decodeLength(encodeLength(len)) === len` for all valid lengths
   - Must handle edge cases (NaN, out of range)

3. **`extractSalt()` and `stripSalt()` must be consistent**
   - `stripSalt(envelope, saltLen) + extractSalt(envelope, saltLen) === envelope`
   - Must work for all valid salt lengths

### Cipher Requirements

1. **Must be deterministic**
   - `decrypt(encrypt(plaintext, salt), salt) === plaintext`
   - Same inputs → same output

2. **Must handle all string inputs**
   - Empty strings
   - Unicode characters
   - Special characters

## Implementation Notes

### Performance Optimizations

1. **Decryption uses direct offset calculation**
   - Instead of searching for metadata, calculates expected position
   - Only validates that metadata is at expected position
   - Reduces complexity from O(n²) to O(n)

2. **Brute-force is optimized**
   - Early termination when valid solution found
   - Skips invalid candidates quickly
   - Uses offset validation to reduce search space

### Security Considerations

1. **Salt length range affects security**
   - Wider range → larger search space
   - But range doesn't create diversity (not a security point)

2. **Offset calculation is the primary security point**
   - Must vary per app
   - Should use timestamp for rotation

3. **Encoding doesn't add security**
   - But creates format diversity
   - Makes metadata less obvious

## See Also

- [Whitepaper](./WHITEPAPER.md) - Complete technical specification and architecture
- [Rules Guide](./RULES.md) - How to create rules
- [Quick Start](./QUICK_START.md) - Quick examples


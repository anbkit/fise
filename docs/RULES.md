# FISE Rules Guide

## Overview

FISE rules define how data is transformed and protected. The beauty of FISE is its simplicity - you only need to define **3 security points** to create unique, secure rules.

## The Three Security Points

### 1. `offset()` - Spatial Diversity (PRIMARY)

**Purpose:** Calculates where to insert the encoded salt length metadata into the ciphertext.

**Why it matters:** This is the **primary security point**. Different apps use different offset calculations, creating unique "encryption dialects."

**Example:**
```typescript
offset(cipherText: string, ctx: FiseContext): number {
  const t = ctx.timestamp ?? 0;
  const len = cipherText.length || 1;
  return (len * 7 + (t % 11)) % len;
}
```

**Key Points:**
- ✅ **Must vary per app** - This is what makes each deployment unique
- ✅ Can use timestamp for temporal rotation
- ✅ Can use ciphertext length, salt length, or any combination
- ✅ Simple math is enough - no complex cryptography needed

### 2. `encodeLength()` - Format Diversity

**Purpose:** Encodes the salt length as a string representation.

**Why it matters:** Different encodings create format diversity - the metadata looks different across apps.

**Example:**
```typescript
encodeLength(len: number, ctx: FiseContext): string {
  return len.toString(36).padStart(2, "0"); // Base36 encoding
}
```

**Common Encodings:**
- Base36 (default): `len.toString(36).padStart(2, "0")`
- Hex: `len.toString(16).padStart(2, "0")`
- Base62: Custom implementation
- Custom: Any character set you want

### 3. `decodeLength()` - Extraction Diversity

**Purpose:** Decodes the encoded salt length back to a number.

**Why it matters:** Must match `encodeLength` - `decode(encode(len)) === len`.

**Example:**
```typescript
decodeLength(encoded: string, ctx: FiseContext): number {
  return parseInt(encoded, 36); // Base36 decoding
}
```

## Optional Overrides

### `saltRange`

**Purpose:** Define the search range for salt length (default: 10-99).

**When to use:** If you want a different range for your salt lengths.

```typescript
saltRange: { min: 20, max: 150 }
```

**Note:** This is NOT a security point - the range doesn't create diversity, but a wider range increases brute-force search space.

### `extractSalt()` and `stripSalt()`

**Purpose:** Custom salt extraction logic (default: tail-based).

**When to use:** If you want head-based or custom salt placement.

```typescript
// Head-based salt
extractSalt(envelope, saltLen) {
  return envelope.slice(0, saltLen);
}
stripSalt(envelope, saltLen) {
  return envelope.slice(saltLen);
}
```

## Creating Rules

### Method 1: Copy and Modify `defaultRules` (Recommended)

The simplest approach - just copy `defaultRules` and modify what you need:

```typescript
import { defaultRules } from "fise";

const myRules = {
  ...defaultRules,
  offset(c, ctx) {
    // Your unique offset - just change the multiplier/modulo!
    const t = ctx.timestamp ?? 0;
    return (c.length * 13 + (t % 17)) % c.length;
  }
};
```

### Method 2: Use FiseBuilder Presets

Quick presets for common patterns:

```typescript
import { FiseBuilder } from "fise";

// Use a preset
const rules = FiseBuilder.defaults().build();
const rules = FiseBuilder.hex().build();
const rules = FiseBuilder.timestamp(13, 17).build();
```

### Method 3: Manual Building with FiseBuilder

Fluent API for building rules:

```typescript
import { FiseBuilder } from "fise";

const rules = FiseBuilder.create()
  .withOffset((c, ctx) => {
    const t = ctx.timestamp ?? 0;
    return (c.length * 7 + (t % 11)) % c.length;
  })
  .withEncodeLength((len) => len.toString(36).padStart(2, "0"))
  .withDecodeLength((encoded) => parseInt(encoded, 36))
  .withSaltRange(10, 99)
  .build();
```

### Method 4: Direct Object Definition

Define rules directly as an object:

```typescript
const rules: FiseRules = {
  offset(cipherText, ctx) {
    const t = ctx.timestamp ?? 0;
    return (cipherText.length * 7 + (t % 11)) % cipherText.length;
  },
  encodeLength(len) {
    return len.toString(36).padStart(2, "0");
  },
  decodeLength(encoded) {
    return parseInt(encoded, 36);
  }
};
```

## Best Practices

1. **Always customize `offset()`** - This is your primary security point
   - Use different multipliers/modulos per app
   - Consider using app-specific constants

2. **Use timestamp for rotation** - Pass `timestamp` in options (backend only):
   ```typescript
   // backend.ts
   fiseEncrypt(text, cipher, rules, { 
     timestamp: Math.floor(Date.now() / 60000) 
   });
   ```

3. **Keep it simple** - The 3 security points are enough for most use cases
   - Don't overcomplicate - simple math is powerful
   - Focus on making `offset()` unique per app

4. **Rotate rules periodically** - Change your offset function over time
   - This makes reverse-engineered decoders obsolete quickly

5. **Test your rules** - Ensure `decodeLength(encodeLength(len)) === len`

## Common Patterns

### Pattern 1: Timestamp-Based Offset (Most Common)

```typescript
offset(c, ctx) {
  const t = ctx.timestamp ?? 0;
  return (c.length * 7 + (t % 11)) % c.length;
}
```

### Pattern 2: Fixed Position

```typescript
offset(c) {
  return Math.floor(c.length / 2);
}
```

### Pattern 3: Length-Based

```typescript
offset(c) {
  return c.length % 7;
}
```

### Pattern 4: Multi-Factor

```typescript
offset(c, ctx) {
  const t = ctx.timestamp ?? 0;
  const saltLen = ctx.saltLength ?? 10;
  return (c.length * 7 + (t % 11) + (saltLen * 3)) % c.length;
}
```

## Everything Else is Automated

FISE automatically handles:
- ✅ Salt extraction (default: tail-based)
- ✅ Brute-force search for salt length
- ✅ Metadata size inference
- ✅ All internal validation logic

You only need to focus on the 3 security points!

## See Also

- [Quick Start Guide](./QUICK_START.md) - Get started in 30 seconds
- [Quick Start](./QUICK_START.md) - Examples of unique rules and developer variations
- [Whitepaper](./WHITEPAPER.md) - Complete technical specification and architecture


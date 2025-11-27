# FISE Quick Start Guide

## 🎯 Core Philosophy

**Any developer can write their unique rules. This is FISE's superpower.**

FISE doesn't require cryptography expertise. It doesn't need complex algorithms. It just needs **you** to write **your** unique offset function.

### Why This Matters

**Traditional Encryption Libraries:**
- ❌ Require cryptographic knowledge
- ❌ Fixed algorithms (AES, RSA, etc.)
- ❌ Same for everyone → universal decoders exist
- ❌ Complex key management

**FISE Approach:**
- ✅ **Any developer** can write rules
- ✅ **Unique per app** → no universal decoder
- ✅ **Simple math** → no crypto expertise needed
- ✅ **No keys** → rules-as-code, not secrets

## 🚀 Get Started in 30 Seconds

FISE is incredibly simple - you only need to define **3 security points**:

### Method 1: Copy and Modify Default Rules (Easiest!)

**Rules definition (shared between backend and frontend):**

```typescript
// rules.ts - Shared between backend and frontend
import { defaultRules } from "fise";

// Just copy defaultRules and modify the offset!
export const myRules = {
  ...defaultRules,
  offset(c, ctx) {
    // Your unique offset - just change the multiplier/modulo!
    const t = ctx.timestampMinutes ?? 0;
    return (c.length * 13 + (t % 17)) % c.length; // Different primes!
  }
};
```

**Backend (encrypt):**

```typescript
// backend.ts
import { encryptFise, xorCipher } from "fise";
import { myRules } from "./rules.js";

// Encrypt on backend before sending to frontend
const encrypted = encryptFise("Hello, World!", xorCipher, myRules);
// encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
// (sample base64-encoded output - actual encrypted text will vary due to random salt)

// Send encrypted to frontend via API
res.json({ data: encrypted });
```

**Frontend (decrypt):**

```typescript
// frontend.ts
import { decryptFise, xorCipher } from "fise";
import { myRules } from "./rules.js";

// Receive encrypted from API
const { data: encrypted } = await fetch('/api/data').then(r => r.json());

// Decrypt on frontend
// encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
const decrypted = decryptFise(encrypted, xorCipher, myRules);
// decrypted: "Hello, World!" (decrypted plaintext)
console.log(decrypted); // "Hello, World!"
```

### Method 2: Use FiseBuilder Presets

**Rules definition (shared between backend and frontend):**

```typescript
// rules.ts - Shared between backend and frontend
import { FiseBuilder } from "fise";

// Use a preset - one line!
export const rules = FiseBuilder.defaults().build();
// or
// export const rules = FiseBuilder.hex().build();
// or
// export const rules = FiseBuilder.timestamp(13, 17).build();
```

**Backend (encrypt):**

```typescript
// backend.ts
import { encryptFise, xorCipher } from "fise";
import { rules } from "./rules.js";

const encrypted = encryptFise("Hello, World!", xorCipher, rules);
// encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
// (sample base64-encoded output - actual encrypted text will vary due to random salt)
res.json({ data: encrypted });
```

**Frontend (decrypt):**

```typescript
// frontend.ts
import { decryptFise, xorCipher } from "fise";
import { rules } from "./rules.js";

const { data: encrypted } = await fetch('/api/data').then(r => r.json());
// encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
const decrypted = decryptFise(encrypted, xorCipher, rules);
// decrypted: "Hello, World!" (decrypted plaintext)
```

### Method 3: Define Rules Directly

**Rules definition (shared between backend and frontend):**

```typescript
// rules.ts - Shared between backend and frontend
import { FiseRules } from "fise";

// Define your rules - just 3 methods!
export const myRules: FiseRules = {
  // 1. Where to place metadata (varies per app - THIS IS THE KEY!)
  offset(cipherText, ctx) {
    const t = ctx.timestampMinutes ?? 0;
    return (cipherText.length * 7 + (t % 11)) % cipherText.length;
  },
  
  // 2. How to encode salt length (usually base36)
  encodeLength(len) {
    return len.toString(36).padStart(2, "0");
  },
  
  // 3. How to decode salt length (must match encodeLength)
  decodeLength(encoded) {
    return parseInt(encoded, 36);
  }
};
```

**Backend (encrypt):**

```typescript
// backend.ts
import { encryptFise, xorCipher } from "fise";
import { myRules } from "./rules.js";

// Encrypt on backend
const encrypted = encryptFise("Hello, World!", xorCipher, myRules);
// encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
// (sample base64-encoded output - actual encrypted text will vary due to random salt)
res.json({ data: encrypted });
```

**Frontend (decrypt):**

```typescript
// frontend.ts
import { decryptFise, xorCipher } from "fise";
import { myRules } from "./rules.js";

// Decrypt on frontend
const { data: encrypted } = await fetch('/api/data').then(r => r.json());
// encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
const decrypted = decryptFise(encrypted, xorCipher, myRules);
// decrypted: "Hello, World!" (decrypted plaintext)
console.log(decrypted); // "Hello, World!"
```

That's it! Everything else is automated with secure defaults.

## 📋 What You Need to Know

### The 3 Security Points

1. **`offset()`** - **PRIMARY SECURITY POINT**
   - Calculates where to insert the encoded salt length in the ciphertext
   - **Must vary per app** - this is what makes each deployment unique
   - Creates **spatial diversity**

2. **`encodeLength()`** - Format diversity
   - Encodes the salt length as a string (e.g., base36, base62, hex)
   - Creates **format diversity** - different apps use different encodings

3. **`decodeLength()`** - Extraction diversity
   - Decodes the encoded salt length back to a number
   - Must match `encodeLength` - `decode(encode(len)) === len`

### Everything Else is Automated

- ✅ Salt extraction (default: tail-based)
- ✅ Brute-force search for salt length (default: 10-99)
- ✅ Metadata size inference
- ✅ All internal logic

## 🎯 Common Patterns

### Pattern 1: Copy and Modify Default Rules (Recommended!)

**The simplest approach - most developers just copy `defaultRules` and change the offset!**

**Rules definition (shared between backend and frontend):**

```typescript
// rules.ts - Shared between backend and frontend
import { defaultRules } from "fise";

// Just copy and modify - that's it!
export const myRules = {
  ...defaultRules,
  offset(c, ctx) {
    // Just change the multiplier/modulo - you're done!
    const t = ctx.timestampMinutes ?? 0;
    return (c.length * 13 + (t % 17)) % c.length; // Different primes!
  }
};
```

**Backend (encrypt):**

```typescript
// backend.ts
import { encryptFise, xorCipher } from "fise";
import { myRules } from "./rules.js";

const plaintext = "Hello";
const encrypted = encryptFise(plaintext, xorCipher, myRules);
// encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
// (sample base64-encoded output - actual encrypted text will vary due to random salt)

res.json({ data: encrypted });
```

**Frontend (decrypt):**

```typescript
// frontend.ts
import { decryptFise, xorCipher } from "fise";
import { myRules } from "./rules.js";

const { data: encrypted } = await fetch('/api/data').then(r => r.json());
// encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
const decrypted = decryptFise(encrypted, xorCipher, myRules);
// decrypted: "Hello" (decrypted plaintext)
```

**That's it!** You now have unique rules. Everything else uses secure defaults.

### Pattern 2: Use Default Rules (No Modification)

**Backend (encrypt):**

```typescript
// backend.ts
import { encryptFise, xorCipher, defaultRules } from "fise";

const plaintext = "Hello";
const encrypted = encryptFise(plaintext, xorCipher, defaultRules);
// encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
// (sample base64-encoded output - actual encrypted text will vary due to random salt)

res.json({ data: encrypted });
```

**Frontend (decrypt):**

```typescript
// frontend.ts
import { decryptFise, xorCipher, defaultRules } from "fise";

const { data: encrypted } = await fetch('/api/data').then(r => r.json());
// encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
const decrypted = decryptFise(encrypted, xorCipher, defaultRules);
// decrypted: "Hello" (decrypted plaintext)
```

### Pattern 3: Custom Offset Only

```typescript
const rules = {
  offset(c, ctx) {
    // Your unique offset calculation
    const t = ctx.timestampMinutes ?? 0;
    return (c.length * 13 + (t % 17)) % c.length;
  },
  encodeLength: (len) => len.toString(36).padStart(2, "0"),
  decodeLength: (encoded) => parseInt(encoded, 36)
};
```

### Pattern 4: Custom Encoding

```typescript
const rules = {
  offset(c, ctx) {
    const t = ctx.timestampMinutes ?? 0;
    return (c.length * 7 + (t % 11)) % c.length;
  },
  // Base62 encoding instead of base36
  encodeLength(len) {
    const base62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let result = "";
    let n = len;
    do {
      result = base62[n % 62] + result;
      n = Math.floor(n / 62);
    } while (n > 0);
    return result.padStart(2, "0");
  },
  decodeLength(encoded) {
    const base62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let result = 0;
    for (let i = 0; i < encoded.length; i++) {
      result = result * 62 + base62.indexOf(encoded[i]);
    }
    return result;
  }
};
```

### Pattern 5: Custom Salt Range

```typescript
const rules = {
  offset(c, ctx) {
    const t = ctx.timestampMinutes ?? 0;
    return (c.length * 7 + (t % 11)) % c.length;
  },
  encodeLength: (len) => len.toString(36).padStart(2, "0"),
  decodeLength: (encoded) => parseInt(encoded, 36),
  saltRange: { min: 20, max: 150 } // Wider range for more security
};
```

### Pattern 6: Head-Based Salt Extraction

```typescript
const rules = {
  offset(c, ctx) {
    const t = ctx.timestampMinutes ?? 0;
    return (c.length * 7 + (t % 11)) % c.length;
  },
  encodeLength: (len) => len.toString(36).padStart(2, "0"),
  decodeLength: (encoded) => parseInt(encoded, 36),
  // Custom extraction for head-based salt
  extractSalt(envelope, saltLen) {
    return envelope.slice(0, saltLen);
  },
  stripSalt(envelope, saltLen) {
    return envelope.slice(saltLen);
  }
};
```

## 🎨 Real Developer Variations

Here are examples of how different developers create their unique rules:

### Developer A - Copy DefaultRules and Modify
```typescript
import { defaultRules } from "fise";

const rules = {
  ...defaultRules,
  offset(c, ctx) {
    const t = ctx.timestampMinutes ?? 0;
    return (c.length * 7 + (t % 11)) % c.length;
  }
};
```

### Developer B - Different Multipliers
```typescript
import { defaultRules } from "fise";

const rules = {
  ...defaultRules,
  offset(c, ctx) {
    const t = ctx.timestampMinutes ?? 0;
    return (c.length * 13 + (t % 17)) % c.length; // Different primes!
  }
};
```

### Developer C - Fixed Position
```typescript
const rules = {
  offset(c) {
    return Math.floor(c.length / 2);
  },
  encodeLength: len => len.toString(36).padStart(2, "0"),
  decodeLength: encoded => parseInt(encoded, 36)
};
```

### Developer D - Length-Based
```typescript
const rules = {
  offset(c) {
    return c.length % 7;
  },
  encodeLength: len => len.toString(36).padStart(2, "0"),
  decodeLength: encoded => parseInt(encoded, 36)
};
```

### Developer E - Multi-Factor
```typescript
const rules = {
  offset(c, ctx) {
    const t = ctx.timestampMinutes ?? 0;
    const len = c.length || 1;
    const saltLen = ctx.saltLength ?? 10;
    return (len * 17 + (t % 23) + (saltLen * 3)) % len;
  },
  encodeLength: len => len.toString(36).padStart(2, "0"),
  decodeLength: encoded => parseInt(encoded, 36)
};
```

### Developer F - XOR-Based
```typescript
const rules = {
  offset(c, ctx) {
    const t = ctx.timestampMinutes ?? 0;
    return (c.length ^ t) % c.length;
  },
  encodeLength: len => len.toString(36).padStart(2, "0"),
  decodeLength: encoded => parseInt(encoded, 36)
};
```

### Developer G - Prime Numbers
```typescript
const rules = {
  offset(c, ctx) {
    const t = ctx.timestampMinutes ?? 0;
    // Using prime numbers for better distribution
    return (c.length * 3 + (t % 7)) % c.length;
  },
  encodeLength: len => len.toString(36).padStart(2, "0"),
  decodeLength: encoded => parseInt(encoded, 36)
};
```

### Developer H - Custom Encoding (Base62)
```typescript
const rules = {
  offset(c, ctx) {
    const t = ctx.timestampMinutes ?? 0;
    return (c.length * 7 + (t % 11)) % c.length;
  },
  encodeLength(len) {
    const base62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let result = "";
    let n = len;
    do {
      result = base62[n % 62] + result;
      n = Math.floor(n / 62);
    } while (n > 0);
    return result.padStart(2, "0");
  },
  decodeLength(encoded) {
    const base62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let result = 0;
    for (let i = 0; i < encoded.length; i++) {
      result = result * 62 + base62.indexOf(encoded[i]);
    }
    return result;
  }
};
```

## 🎨 The Power of Diversity

Each developer's unique approach creates:
- ✅ **Unique encryption dialect** per app
- ✅ **No universal decoder** across deployments
- ✅ **Natural diversity** without coordination
- ✅ **Easy rotation** - just change the offset function

### Same vs. Unique Rules

**If Everyone Used the Same Rules:**
```typescript
// Everyone uses this
const sameRules = {
  offset: (c, ctx) => (c.length * 7 + (ctx.timestampMinutes % 11)) % c.length,
  encodeLength: len => len.toString(36).padStart(2, "0"),
  decodeLength: encoded => parseInt(encoded, 36)
};
```
**Result**: ❌ Universal decoder exists → weak security

**When Everyone Writes Their Own:**
```typescript
// Developer A
offset: (c, ctx) => (c.length * 7 + (ctx.timestampMinutes % 11)) % c.length

// Developer B  
offset: (c, ctx) => (c.length * 13 + (ctx.timestampMinutes % 17)) % c.length

// Developer C
offset: (c) => Math.floor(c.length / 2)

// Developer D
offset: (c, ctx) => (c.length ^ ctx.timestampMinutes) % c.length
```
**Result**: ✅ No universal decoder → strong security through diversity

## 🔒 Security Best Practices

1. **Always customize `offset()`** - This is the primary security point
   - Use different multipliers/modulos per app
   - Consider using app-specific constants
   - **Just copy `defaultRules` and change the multiplier/modulo - that's it!**

2. **Use timestamp for rotation** - Pass `timestampMinutes` in options (backend only):
   ```typescript
   // backend.ts
   encryptFise(text, cipher, rules, { 
     timestampMinutes: Math.floor(Date.now() / 60000) 
   });
   ```

3. **Rotate rules periodically** - Change your offset function over time
   - Makes decoders stale quickly
   - Increases attacker maintenance cost

4. **Keep it simple** - The 3 security points are enough for most use cases
   - Simple is better than complex
   - Easy to understand = easy to maintain
   - Easy to rotate = better security

5. **Test your rules** - Ensure they work correctly:
   ```typescript
   // Test your rules
   const encrypted = encryptFise("test", xorCipher, myRules);
   const decrypted = decryptFise(encrypted, xorCipher, myRules);
   console.assert(decrypted === "test", "Rules work!");
   ```

## 💪 The FISE Advantage

**Traditional approach:**
- Complex crypto → only experts can use → limited diversity → weak security

**FISE approach:**
- Simple rules → any developer can use → natural diversity → strong security

## 📚 Next Steps

- Read [WHITEPAPER.md](./WHITEPAPER.md) for deeper understanding
- Check [SECURITY.md](./SECURITY.md) for security considerations
- Explore [USE_CASES.md](./USE_CASES.md) for real-world scenarios
- See [RULES.md](./RULES.md) for advanced rule customization

## ❓ FAQ

**Q: Do I need to implement all 3 methods?**  
A: Yes, all 3 are required. But they're simple - see the examples above.

**Q: Can I use the same rules for multiple apps?**  
A: No! Each app should have a unique `offset()` function. This is the core security principle.

**Q: What if I want more control?**  
A: You can optionally override `saltRange`, `extractSalt`, and `stripSalt`, but the 3 security points are sufficient.

**Q: Is the builder necessary?**  
A: No! The builder is optional. Most users just copy `defaultRules` and modify the offset, or define the 3 methods directly.

**Q: What's the easiest way to create rules?**  
A: Copy `defaultRules` and modify the `offset()` function - that's it! Just change the multiplier/modulo to make it unique. See the examples above - most developers just copy and modify!

**Q: Do I need to be a cryptography expert?**  
A: No! FISE empowers every developer to create their own unique encryption dialect. You don't need cryptography expertise - you just need to write your unique offset function. The simplicity is the power.


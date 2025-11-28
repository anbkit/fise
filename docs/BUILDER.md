# FISE Rule Builder

The Rule Builder provides a fluent API for creating custom FISE rules without writing the full `FiseRules` implementation from scratch.

## Quick Start

```ts
import { RuleBuilder, encryptFise, decryptFise, xorCipher } from "fise";

// Create custom rules
const customRules = RuleBuilder.create()
  .encodedLengthSize(2)
  .offset("timestamp-linear", { multiplier: 7, modulo: 11 })
  .encoding("base36")
  .saltExtraction("tail")
  .preExtraction("brute-force", { minSaltLength: 10, maxSaltLength: 99 })
  .build();

// Use the rules
const plaintext = "Hello, world!";
const encrypted = encryptFise(plaintext, xorCipher, customRules);
const decrypted = decryptFise(encrypted, xorCipher, customRules);
```

## Presets

### Default Rules

Creates rules similar to the built-in `defaultRules`:

```ts
const rules = RuleBuilder.defaults().build();
```

### Scanning Rules

Creates rules with scanning-based pre-extraction (similar to `scanningRulesExample`):

```ts
const rules = RuleBuilder.scanning().build();
```

## Configuration Options

### Encoded Length Size

Set the size of the encoded length metadata (1-10 characters):

```ts
RuleBuilder.create().encodedLengthSize(3)
```

### Offset Strategies

Control where the encoded length is inserted in the cipher text.

#### `timestamp-linear`
Uses timestamp and cipher text length to calculate offset:
```ts
.offset("timestamp-linear", { multiplier: 7, modulo: 11 })
```

#### `timestamp-prime`
Similar to `timestamp-linear` but with different prime-based calculation:
```ts
.offset("timestamp-prime", { multiplier: 3, modulo: 7 })
```

#### `length-based`
Simple offset based on cipher text length (middle position):
```ts
.offset("length-based")
```

#### `fixed`
Fixed offset position:
```ts
.offset("fixed", { fixedValue: 10 })
```

#### `custom`
Provide your own offset calculation function:
```ts
.offset("custom", {
  customFn: (cipherText, ctx) => {
    const len = cipherText.length || 1;
    const t = ctx.timestamp ?? 0;
    return (len * 17 + (t * 3) % 23) % len;
  }
})
```

### Encoding Strategies

Control how salt length is encoded/decoded.

#### `base36` (default)
Base-36 encoding (0-9, a-z):
```ts
.encoding("base36")
```

#### `base62`
Base-62 encoding (0-9, A-Z, a-z):
```ts
.encoding("base62")
```

#### `hex`
Hexadecimal encoding:
```ts
.encoding("hex")
```

#### `emoji`
Emoji-based encoding (⚠️ may have normalization issues):
```ts
.encoding("emoji")
```

#### `custom`
Provide your own encode/decode functions:
```ts
.encoding("custom", {
  customEncode: (len, ctx) => len.toString(36).padStart(2, "0"),
  customDecode: (encoded, ctx) => parseInt(encoded, 36)
})
```

### Salt Extraction Strategies

Control where salt is placed in the envelope.

#### `tail` (default)
Salt appended at the end:
```ts
.saltExtraction("tail")
```

#### `head`
Salt prepended at the beginning:
```ts
.saltExtraction("head")
```

#### `custom`
Provide your own extract/strip functions:
```ts
.saltExtraction("custom", {
  customExtract: (envelope, saltLen, ctx) => envelope.slice(-saltLen),
  customStrip: (envelope, saltLen, ctx) => envelope.slice(0, envelope.length - saltLen)
})
```

### Pre-Extraction Strategies

Control how salt length is inferred during decryption.

#### `brute-force` (default)
Tries all possible salt lengths and validates:
```ts
.preExtraction("brute-force", { 
  minSaltLength: 10, 
  maxSaltLength: 99 
})
```

#### `scanning`
Uses a scanning function to locate encoded length:
```ts
.preExtraction("scanning")
.scanning((envelope, ctx) => {
  const size = 2;
  const t = ctx.timestamp ?? 0;
  for (let i = 0; i <= envelope.length - size; i++) {
    const code = envelope.charCodeAt(i);
    const sig = (code ^ t) % 9;
    if (sig === 4) {
      const encoded = envelope.slice(i, i + size);
      return { index: i, encoded };
    }
  }
  throw new Error("FISE: encoded length not found.");
})
```

#### `custom`
Provide your own pre-extraction function:
```ts
.preExtraction("custom", {
  customPreExtract: (envelope, ctxBase) => {
    // Your custom logic here
    return { saltLength, encodedLength, withoutLen };
  }
})
```

## Complete Examples

### Example 1: High-Entropy Rules

```ts
const highEntropyRules = RuleBuilder.create()
  .encodedLengthSize(3)
  .offset("timestamp-prime", { multiplier: 13, modulo: 17 })
  .encoding("base62")
  .saltExtraction("tail")
  .preExtraction("brute-force", { minSaltLength: 20, maxSaltLength: 50 })
  .build();
```

### Example 2: Simple Fixed Rules

```ts
const simpleRules = RuleBuilder.create()
  .encodedLengthSize(2)
  .offset("fixed", { fixedValue: 5 })
  .encoding("hex")
  .saltExtraction("tail")
  .preExtraction("brute-force", { minSaltLength: 10, maxSaltLength: 99 })
  .build();
```

### Example 3: Custom Scanning Rules

```ts
const customScanningRules = RuleBuilder.create()
  .encodedLengthSize(2)
  .offset("timestamp-linear", { multiplier: 7, modulo: 11 })
  .encoding("base36")
  .saltExtraction("tail")
  .preExtraction("scanning")
  .scanning((envelope, ctx) => {
    const size = 2;
    const t = ctx.timestamp ?? 0;
    // Custom signature detection
    for (let i = 0; i <= envelope.length - size; i++) {
      const code = envelope.charCodeAt(i);
      const sig = (code ^ (t * 2)) % 7;
      if (sig === 3) {
        const encoded = envelope.slice(i, i + size);
        return { index: i, encoded };
      }
    }
    throw new Error("FISE: encoded length not found.");
  })
  .build();
```

## Best Practices

1. **Use presets when possible**: `RuleBuilder.defaults()` or `RuleBuilder.scanning()` are good starting points.

2. **Test your rules**: Always test encrypt/decrypt roundtrips with various payloads:
   ```ts
   const testCases = ["", "short", "A".repeat(1000), "Hello 🌍 世界"];
   for (const plaintext of testCases) {
     const encrypted = encryptFise(plaintext, xorCipher, rules);
     const decrypted = decryptFise(encrypted, xorCipher, rules);
     assert(decrypted === plaintext);
   }
   ```

3. **Consider normalization**: Emoji and zero-width characters may be normalized by CDNs/proxies. Test with your deployment stack.

4. **Balance performance**: `brute-force` pre-extraction is slower but more reliable. `scanning` is faster but requires careful signature design.

5. **Rotate rules**: Use different rule configurations per session/request to increase attacker cost.

## Advanced: Building Rules Programmatically

You can build rules dynamically based on runtime conditions:

```ts
function createRulesForSession(sessionId: string): FiseRules {
  const hash = sessionId.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const multiplier = 7 + (hash % 10);
  const modulo = 11 + (hash % 5);
  
  return RuleBuilder.create()
    .offset("timestamp-linear", { multiplier, modulo })
    .encoding("base36")
    .saltExtraction("tail")
    .preExtraction("brute-force", { minSaltLength: 10, maxSaltLength: 99 })
    .build();
}
```

## See Also

- [RULES.md](./RULES.md) - Detailed rule implementation guide
- [WHITEPAPER.md](./WHITEPAPER.md) - FISE design philosophy
- [SECURITY.md](./SECURITY.md) - Security considerations





# FISE Use Cases

FISE is designed for scenarios where you need to protect API and frontend data from casual inspection, scraping, and reverse engineering. Here are common use cases:

## 1. Protect AI/LLM Responses

**Problem:** AI responses contain valuable, proprietary content that competitors could scrape.

**Solution:** Encrypt AI responses with FISE before sending to frontend.

```typescript
// ===== BACKEND =====
// backend/api/ai.ts
import { encryptFise, xorCipher } from "fise";
import { myRules } from "../rules.js";

app.post('/api/ai', async (req, res) => {
  const aiResponse = await callLLM(req.body.prompt);
  const encrypted = encryptFise(
    JSON.stringify(aiResponse),
    xorCipher,
    myRules,
    { timestampMinutes: Math.floor(Date.now() / 60000) }
  );
  // encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
  // (sample base64-encoded output - actual encrypted text will vary due to random salt)
  res.json({ data: encrypted });
});

// ===== FRONTEND =====
// frontend/services/ai.ts
import { decryptFise, xorCipher } from "fise";
import { myRules } from "../rules.js";

const response = await fetch('/api/ai', {
  method: 'POST',
  body: JSON.stringify({ prompt: "..." })
});
const { data: encrypted } = await response.json();
// encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
const decrypted = decryptFise(encrypted, xorCipher, myRules);
// decrypted: '{"response":"AI generated content here..."}' (decrypted JSON string)
const aiResponse = JSON.parse(decrypted);
```

**Benefits:**
- ✅ Prevents casual scraping of AI responses
- ✅ Makes automated extraction harder
- ✅ Can rotate rules per session

## 2. Hide API Data from Browser DevTools

**Problem:** Sensitive API data is visible in Network tab and browser DevTools.

**Solution:** Encrypt API responses with FISE.

```typescript
// ===== BACKEND =====
// backend/api/data.ts
import { encryptFise, xorCipher } from "fise";
import { myRules } from "../rules.js";

app.get('/api/data', (req, res) => {
  const sensitiveData = { prices: [...], inventory: [...] };
  const encrypted = encryptFise(
    JSON.stringify(sensitiveData),
    xorCipher,
    myRules
  );
  // encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
  // (sample base64-encoded output - actual encrypted text will vary due to random salt)
  res.json({ encrypted });
});

// ===== FRONTEND =====
// frontend/services/data.ts
import { decryptFise, xorCipher } from "fise";
import { myRules } from "../rules.js";

const { encrypted } = await fetch('/api/data').then(r => r.json());
// encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
const decrypted = decryptFise(encrypted, xorCipher, myRules);
// decrypted: '{"prices":[...],"inventory":[...]}' (decrypted JSON string)
const data = JSON.parse(decrypted);
```

**Benefits:**
- ✅ Data not visible in plaintext in Network tab
- ✅ Makes casual inspection harder
- ✅ Doesn't require exposing static keys

## 3. Prevent Web Scraping

**Problem:** Competitors scrape your website's data (prices, products, content).

**Solution:** Use FISE to obfuscate data sent to frontend.

```typescript
// Each app uses unique rules
const appARules = {
  offset(c, ctx) {
    return (c.length * 7 + (ctx.timestampMinutes % 11)) % c.length;
  },
  // ... other methods
};

const appBRules = {
  offset(c, ctx) {
    return (c.length * 13 + (ctx.timestampMinutes % 17)) % c.length;
  },
  // ... other methods
};

// Scrapers can't use universal decoder
```

**Benefits:**
- ✅ No universal decoder exists
- ✅ Each app is unique
- ✅ Raises cost of scraping

## 4. Protect SaaS Business Logic

**Problem:** SaaS applications expose business logic and data structures in API responses.

**Solution:** Encrypt sensitive business data with FISE.

```typescript
// ===== BACKEND =====
// backend/api/business.ts
import { encryptFise, xorCipher } from "fise";
import { myRules } from "../rules.js";

app.get('/api/business', (req, res) => {
  // Protect pricing, features, configurations
  const businessData = {
    pricing: { plans: [...] },
    features: { enabled: [...] },
    config: { settings: [...] }
  };

  const encrypted = encryptFise(
    JSON.stringify(businessData),
    xorCipher,
    myRules
  );
  // encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
  // (sample base64-encoded output - actual encrypted text will vary due to random salt)
  res.json({ data: encrypted });
});
```

**Benefits:**
- ✅ Hides business logic from competitors
- ✅ Protects pricing and feature data
- ✅ Makes reverse engineering harder

## 5. Protect Game Configuration Data

**Problem:** Game configs, item data, and mechanics are exposed in client code.

**Solution:** Encrypt game data with FISE.

```typescript
// ===== BACKEND (Game Server) =====
// backend/game/data.ts
import { encryptFise, xorCipher } from "fise";
import { myRules } from "../rules.js";

app.get('/api/game/data', (req, res) => {
  const gameData = {
    items: [...],
    levels: [...],
    mechanics: {...}
  };

  const encrypted = encryptFise(
    JSON.stringify(gameData),
    xorCipher,
    myRules
  );
  // encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
  // (sample base64-encoded output - actual encrypted text will vary due to random salt)
  res.json({ data: encrypted });
});

// ===== FRONTEND (Game Client) =====
// frontend/game/data.ts
import { decryptFise, xorCipher } from "fise";
import { myRules } from "../rules.js";

const { data: encrypted } = await fetch('/api/game/data').then(r => r.json());
// encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
const decrypted = decryptFise(encrypted, xorCipher, myRules);
// decrypted: '{"items":[...],"levels":[...],"mechanics":{...}}' (decrypted JSON string)
const gameData = JSON.parse(decrypted);
```

**Benefits:**
- ✅ Protects game mechanics from data miners
- ✅ Prevents item/level data extraction
- ✅ Makes cheating harder

## 6. Protect Real Estate Listings

**Problem:** Real estate listings contain valuable data (prices, addresses, features).

**Solution:** Encrypt listings with FISE.

```typescript
// ===== BACKEND =====
// backend/api/listings.ts
import { encryptFise, xorCipher } from "fise";
import { myRules } from "../rules.js";

app.get('/api/listings/:id', (req, res) => {
  const listing = {
    address: "123 Main St",
    price: 500000,
    features: [...]
  };

  const encrypted = encryptFise(
    JSON.stringify(listing),
    xorCipher,
    myRules
  );
  // encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
  // (sample base64-encoded output - actual encrypted text will vary due to random salt)
  res.json({ data: encrypted });
});
```

**Benefits:**
- ✅ Prevents bulk scraping of listings
- ✅ Protects pricing data
- ✅ Makes competitor analysis harder

## 7. Protect E-commerce Product Data

**Problem:** Product data (prices, inventory, descriptions) is scraped by competitors.

**Solution:** Encrypt product data with FISE.

```typescript
// ===== BACKEND =====
// backend/api/products.ts
import { encryptFise, xorCipher } from "fise";
import { myRules } from "../rules.js";

app.get('/api/products/:id', (req, res) => {
  const product = {
    name: "Product Name",
    price: 99.99,
    inventory: 50,
    description: "..."
  };

  const encrypted = encryptFise(
    JSON.stringify(product),
    xorCipher,
    myRules
  );
  // encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
  // (sample base64-encoded output - actual encrypted text will vary due to random salt)
  res.json({ data: encrypted });
});
```

**Benefits:**
- ✅ Prevents price scraping
- ✅ Protects inventory data
- ✅ Makes competitive intelligence harder

## 8. Protect API Response Metadata

**Problem:** API responses expose internal structure, IDs, and relationships.

**Solution:** Encrypt entire API responses with FISE.

```typescript
// ===== BACKEND =====
// backend/api/users.ts
import { encryptFise, xorCipher } from "fise";
import { myRules } from "../rules.js";

app.get('/api/users', (req, res) => {
  const apiResponse = {
    users: [...],
    relationships: {...},
    metadata: {...}
  };

  const encrypted = encryptFise(
    JSON.stringify(apiResponse),
    xorCipher,
    myRules
  );
  // encrypted: "22DD0WVDdpEiYqGgUWEg==DXz8XE2qEhir3KwoowSUnUA40rVIQbVT3FzgoZRBWExbu5D5Eg1dcTg2GkqvBnf6X3AZZKNoMy"
  // (sample base64-encoded output - actual encrypted text will vary due to random salt)
  res.json({ data: encrypted });
});
```

**Benefits:**
- ✅ Hides API structure
- ✅ Protects internal IDs
- ✅ Makes API reverse engineering harder

## 9. Session-Based Data Protection

**Problem:** Need to protect data per session with rotation.

**Solution:** Use timestamp-based rules that rotate per session.

```typescript
// ===== BACKEND =====
// backend/rules/session.ts
import { FiseRules } from "fise";

// Per-session rules (can be generated per session)
export function createSessionRules(sessionId: number): FiseRules {
  return {
    offset(c, ctx) {
      const t = ctx.timestampMinutes ?? 0;
      return (c.length * sessionId + (t % 11)) % c.length;
    },
    encodeLength: (len) => len.toString(36).padStart(2, "0"),
    decodeLength: (encoded) => parseInt(encoded, 36)
  };
}

// ===== FRONTEND =====
// frontend/rules/session.ts
// Import the same rules (or receive from backend)
import { createSessionRules } from "../backend/rules/session.js";
const sessionRules = createSessionRules(sessionId);
```

**Benefits:**
- ✅ Rules rotate per session
- ✅ Decoders expire quickly
- ✅ Higher security through rotation

## 10. Multi-Tenant Data Protection

**Problem:** Need different protection per tenant.

**Solution:** Use tenant-specific rules.

```typescript
// ===== BACKEND =====
// backend/rules/tenant.ts
import { FiseRules } from "fise";

export function getTenantRules(tenantId: number): FiseRules {
  return {
    offset(c, ctx) {
      const t = ctx.timestampMinutes ?? 0;
      return (c.length * tenantId + (t % 11)) % c.length;
    },
    encodeLength: (len) => len.toString(36).padStart(2, "0"),
    decodeLength: (encoded) => parseInt(encoded, 36)
  };
}

// ===== FRONTEND =====
// frontend/rules/tenant.ts
// Import the same rules (or receive from backend)
import { getTenantRules } from "../backend/rules/tenant.js";
const tenantRules = getTenantRules(tenantId);
```

**Benefits:**
- ✅ Each tenant has unique rules
- ✅ Cross-tenant attacks harder
- ✅ Isolation between tenants

## When NOT to Use FISE

FISE is **not** suitable for:

- ❌ **Highly sensitive data** (use proper encryption + TLS)
- ❌ **Regulatory compliance** (use certified encryption)
- ❌ **Authentication/authorization** (use proper auth systems)
- ❌ **Data at rest** (use database encryption)
- ❌ **PII/PHI** (use compliant encryption solutions)

## Best Practices

1. **Use with TLS** - FISE complements TLS, doesn't replace it
2. **Rotate rules** - Change rules periodically for better security
3. **Use unique rules per app** - Don't share rules across apps
4. **Combine with rate limiting** - Add rate limiting for extra protection
5. **Monitor for abuse** - Watch for unusual decryption patterns

## See Also

- [Quick Start](./QUICK_START.md) - Get started quickly
- [Rules Guide](./RULES.md) - How to create rules
- [Security](./SECURITY.md) - Security considerations

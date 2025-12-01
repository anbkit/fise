# Platform Support

**FISE currently supports all JavaScript/TypeScript backend and frontend platforms. Support for other programming languages is planned and coming soon.**

---

## ✅ Currently Supported (JavaScript/TypeScript)

FISE works out of the box with **zero configuration** on all JavaScript/TypeScript platforms.

### 🖥️ Backend Frameworks (Node.js/JavaScript)

FISE works seamlessly with any Node.js framework:

- ✅ **Express** — most popular Node.js framework
- ✅ **Fastify** — high-performance framework
- ✅ **NestJS** — enterprise TypeScript framework
- ✅ **Koa** — modern lightweight framework
- ✅ **Hapi** — configuration-centric framework
- ✅ **Adonis.js** — full-stack MVC framework
- ✅ **Sails.js** — MVC framework for data-driven APIs
- ✅ **Restify** — REST API framework
- ✅ **Feathers.js** — real-time framework
- ✅ **Deno** — secure TypeScript/JavaScript runtime
- ✅ **Bun** — fast all-in-one JavaScript runtime
- ✅ **Edge Runtimes** — Cloudflare Workers, Vercel Edge, Deno Deploy, Netlify Edge

**Example (Express):**
```typescript
import { fiseEncrypt, defaultRules } from 'fise';

app.get('/api/users', (req, res) => {
  const users = getUsersFromDatabase();
  const encrypted = fiseEncrypt(JSON.stringify(users), defaultRules);
  res.json({ data: encrypted });
});
```

**Example (Fastify):**
```typescript
import { fiseEncrypt, defaultRules } from 'fise';

fastify.get('/api/users', async (request, reply) => {
  const users = await getUsersFromDatabase();
  const encrypted = fiseEncrypt(JSON.stringify(users), defaultRules);
  return { data: encrypted };
});
```

**Example (NestJS):**
```typescript
import { fiseEncrypt, defaultRules } from 'fise';

@Get('users')
getUsers() {
  const users = this.usersService.findAll();
  return fiseEncrypt(JSON.stringify(users), defaultRules);
}
```

---

### 🎨 Frontend Frameworks (JavaScript/TypeScript)

FISE works seamlessly with any frontend framework:

- ✅ **React** — with Next.js, Remix, Create React App, Vite
- ✅ **Vue** — with Nuxt, Vue CLI, Vite
- ✅ **Angular** — with SSR support
- ✅ **Svelte** — with SvelteKit
- ✅ **Solid.js** — reactive framework
- ✅ **Qwik** — resumable framework
- ✅ **Astro** — content-focused framework
- ✅ **Preact** — lightweight React alternative
- ✅ **Alpine.js** — minimal framework
- ✅ **Lit** — web components
- ✅ **Vanilla JavaScript** — no framework required

**Example (React):**
```typescript
import { fiseDecrypt, defaultRules } from 'fise';

function UserList() {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    fetch('/api/users')
      .then(r => r.json())
      .then(({ data }) => {
        const decrypted = fiseDecrypt(data, defaultRules);
        setUsers(JSON.parse(decrypted));
      });
  }, []);

  return <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
}
```

**Example (Vue 3):**
```typescript
import { ref, onMounted } from 'vue';
import { fiseDecrypt, defaultRules } from 'fise';

const users = ref([]);

onMounted(async () => {
  const { data } = await fetch('/api/users').then(r => r.json());
  const decrypted = fiseDecrypt(data, defaultRules);
  users.value = JSON.parse(decrypted);
});
```

**Example (Angular):**
```typescript
import { Component } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs/operators';
import { fiseDecrypt, defaultRules } from 'fise';

@Component({
  selector: 'app-users',
  template: '<ul><li *ngFor="let user of users$ | async">{{user.name}}</li></ul>'
})
export class UsersComponent {
  users$ = this.http.get<{ data: string }>('/api/users').pipe(
    map(({ data }) => {
      const decrypted = fiseDecrypt(data, defaultRules);
      return JSON.parse(decrypted);
    })
  );

  constructor(private http: HttpClient) {}
}
```

**Example (Svelte):**
```svelte
<script>
import { onMount } from 'svelte';
import { fiseDecrypt, defaultRules } from 'fise';

let users = [];

onMount(async () => {
  const { data } = await fetch('/api/users').then(r => r.json());
  users = JSON.parse(fiseDecrypt(data, defaultRules));
});
</script>

<ul>
  {#each users as user}
    <li>{user.name}</li>
  {/each}
</ul>
```

---

### 📦 Build Tools & Bundlers

FISE works with all modern build tools:

- ✅ **Vite** — modern fast build tool
- ✅ **Webpack** — classic bundler (4.x, 5.x)
- ✅ **Rollup** — library bundler
- ✅ **esbuild** — ultra-fast bundler
- ✅ **Parcel** — zero-config bundler
- ✅ **Turbopack** — Next.js 13+ bundler
- ✅ **SWC** — Rust-based compiler
- ✅ **Babel** — JavaScript compiler

---

### 🌐 JavaScript Runtimes

- ✅ **Node.js** — v14+ (ESM & CommonJS)
- ✅ **Deno** — secure runtime
- ✅ **Bun** — fast all-in-one runtime
- ✅ **Browser** — all modern browsers (Chrome, Firefox, Safari, Edge)
- ✅ **Edge Functions** — Cloudflare Workers, Vercel Edge, Netlify Edge, Deno Deploy

---

## 🔑 Why It Works Everywhere

**Zero Dependencies + Pure Functions = Universal Compatibility**

FISE core is built with:

- ✅ **No runtime dependencies** — just standard JavaScript/TypeScript
- ✅ **Pure functions** — no side effects, no global state
- ✅ **Environment detection** — auto-adapts to Node.js or browser
- ✅ **Framework-agnostic** — no coupling to any specific framework
- ✅ **~200 lines of core logic** — simple, maintainable, portable
- ✅ **Standard APIs only** — uses only `Math.random()`, `String`, `Array`, `Uint8Array`

### Environment Detection

FISE automatically detects the runtime environment:

```typescript
// From src/core/utils.ts
export function toBase64(str: string): string {
  if (typeof Buffer !== "undefined") {
    // Node.js environment
    return Buffer.from(str, "utf8").toString("base64");
  }
  if (typeof btoa === "function") {
    // Browser environment
    return btoa(/* ... */);
  }
  throw new Error("FISE: no base64 encoder available.");
}
```

---

## 🛠 Other Languages (In Development)

Because FISE core is **dependency-free** and uses only **simple string/byte operations**, it can be easily implemented in any language.

### Implementation Complexity

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

### What Needs to be Implemented

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

### Python (Planned)

Target frameworks: **Django, Flask, FastAPI, Tornado**

```python
# Pseudocode
from fise import encrypt_fise, decrypt_fise, xor_cipher, default_rules

# Django/Flask
@app.route('/api/users')
def get_users():
    users = get_users_from_db()
    encrypted = encrypt_fise(json.dumps(users), xor_cipher, default_rules)
    return {'data': encrypted}
```

### PHP Laravel (In Progress)

Target frameworks: **Laravel, Symfony, CodeIgniter, Slim**

```php
// Pseudocode
use Fise\FiseEncrypt;
use Fise\XorCipher;
use Fise\DefaultRules;

Route::get('/api/users', function () {
    $users = getUsersFromDb();
    $encrypted = FiseEncrypt::encrypt(
        json_encode($users),
        new XorCipher(),
        new DefaultRules()
    );
    return response()->json(['data' => $encrypted]);
});
```

### Go (Planned)

Target frameworks: **Gin, Echo, Fiber, Chi**

```go
// Pseudocode
import "github.com/anbkit/fise-go"

func getUsers(c *gin.Context) {
    users := getUsersFromDB()
    encrypted := fise.Encrypt(users, fise.XorCipher, fise.DefaultRules)
    c.JSON(200, gin.H{"data": encrypted})
}
```

### Rust (Planned)

Target frameworks: **Axum, Actix-web, Rocket, Warp**

```rust
// Pseudocode
use fise::{encrypt_fise, xor_cipher, default_rules};

async fn get_users() -> Json<Response> {
    let users = get_users_from_db().await;
    let encrypted = encrypt_fise(&users, xor_cipher, default_rules);
    Json(Response { data: encrypted })
}
```

---

## 🧪 Cross-Platform Compatibility

All implementations must maintain **byte-for-byte compatibility** with the reference JavaScript implementation.

### Golden Test Suite

Every implementation must pass the same test vectors:

```typescript
// Test vector example
const plaintext = "Hello, FISE!";
const salt = "abc123XYZ";
const timestamp = 1234567890;

// All implementations must produce identical output
const encrypted = fiseEncrypt(plaintext, defaultRules, { timestamp });
// Expected: "GvQhPw2xHjI8NQo=abc123XYZ12" (example)
```

This ensures:
- ✅ Rules work identically across all platforms
- ✅ Server in Go can work with client in React
- ✅ Server in Python can work with client in Vue
- ✅ Any backend + any frontend combination works

---

## 📱 Mobile & Native Platforms

### React Native
✅ **Supported via JavaScript bridge**

```typescript
import { fiseDecrypt, defaultRules } from 'fise';

// Works identically to web
const decrypted = fiseDecrypt(encryptedData, defaultRules);
```

### iOS (Swift) - Planned
Native Swift implementation for maximum performance

### Android (Kotlin/Java) - Planned
Native Kotlin/Java implementation for maximum performance

### Flutter (Dart) - Planned
Dart implementation for cross-platform mobile

---

## 🎮 Other Platforms

### WebAssembly (WASM)
Can be compiled from Rust/C++ for high-performance scenarios:
- Smart TV apps (Tizen, webOS)
- Embedded devices
- High-throughput video processing

### Desktop
- ✅ **Electron** — via Node.js/JavaScript
- ✅ **Tauri** — via JavaScript bridge
- 🛠 **Native** — via language-specific implementations

---

## 🚀 Contributing New Platform Implementations

We welcome implementations for new languages and platforms! See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.

**Requirements:**
1. Implement core API (`fiseEncrypt`, `fiseDecrypt`, `defaultRules`)
2. Pass golden test suite (byte-for-byte compatibility)
3. Use only standard library (no external dependencies)
4. Provide examples for popular frameworks
5. Include performance benchmarks

---

## 📊 Platform Status Summary

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

---

## 🤝 Need Help?

- **Issues:** [GitHub Issues](https://github.com/anbkit/fise/issues)
- **Examples:** [FISE Examples Repository](https://github.com/anbkit/fise-examples)
- **Documentation:** [Main README](../README.md)

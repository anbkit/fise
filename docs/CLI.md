# CLI reference

The FISE CLI generates and verifies executable Profile modules. Install `fise`
in the project and invoke its local binary through `npx`; no global package is
required.

```sh
npm install fise
npx fise help
```

## Commands

| Command | Purpose |
| --- | --- |
| `fise generate <output-file>` | Generate, verify, and atomically publish one new Profile. |
| `fise generate <output-file> --override` | Intentionally replace an existing Profile after the candidate passes verification. |
| `fise verify <profile-file>` | Verify a trusted generated Profile without changing it. |
| `fise help` | Show root command help. |
| `fise --version` | Print the installed package version. |

Use `fise generate --help`, `fise verify --help`, or the `-h` equivalent for
command-specific help.

## Generate

```sh
npx fise generate ./src/fise.profile.ts
```

Each invocation creates a new independent reversible pipeline. Before writing
anything to the destination, the CLI loads the candidate and proves:

- text, adaptive structured compression, and binary encrypt/decrypt round trips;
- deterministic decrypt/encrypt reproduction of each envelope;
- random synthetic positional context and empty/default-context behavior;
- different-context output and wrong-context rejection;
- constructor TTL across full, range, and progressive restoration;
- binary full coverage, edge coverage, range, and progressive restoration;
- JavaScript interoperability in both directions with WASM and workers.

The CLI writes a complete temporary file in the destination directory. Normal
generation publishes it with atomic no-clobber behavior, so an existing file or
a concurrent writer wins without being overwritten. Partial temporary files
are not published.

On success, output includes the absolute file path, Profile fingerprint,
verification coverage, and next-step guidance. Commit the generated file. In a
monorepo, import it from one shared package. With separate repositories,
distribute that exact file rather than generating again. Both sides must also
use the same positional context contract and matching per-operation values.

### Intentional replacement

Generation refuses an existing destination by default:

```sh
npx fise generate ./src/fise.profile.ts --override
```

`--override` still verifies the complete candidate before atomically replacing
the destination. The replacement is a new compatibility artifact: envelopes
created with the previous Profile still require that previous committed file.

## Verify

```sh
npx fise verify ./src/fise.profile.ts
```

`verify` repeats the bidirectional data, adaptive structured compression,
context, TTL, binary coverage,
range/progressive, JavaScript, WASM, and worker checks without modifying the
file. A successful run prints the
Profile fingerprint and a `PASS` summary. Compare that fingerprint wherever an
exact profile copy is deployed.

A generated Profile is executable source. Verify only files you trust. The CLI
accepts recognized FISE 2.0 generated modules up to 2 MiB using `.js`, `.mjs`,
`.mts`, or `.ts`. It rejects declaration files such as `.d.ts` and `.d.mts`.

## Exit behavior and CI

Every successful command exits with status `0`. Invalid usage, an unsupported
path, an existing generate target, an unrecognized profile, or any failed
verification exits non-zero and writes a typed error code and message to
standard error.

Use verification as a CI check after the profile is generated and committed:

```sh
npx fise verify ./src/fise.profile.ts
```

Do not run `fise generate` during install, build, application startup, or normal
test setup. Generate once for a compatibility domain and deploy that exact
source artifact to every producer and consumer.

See [Generated profiles](./PROFILES.md) for lifecycle and ownership details and
the [agent integration guide](./AGENT_GUIDE.md) for automated repository work.

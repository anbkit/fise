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
| `fise generate <output-file> --backend python` | Emit frontend JavaScript and backend Python artifacts from one Profile IR, verify exact wire parity, then publish the pair. |
| `fise generate <output-file> --override` | Intentionally replace an existing Profile after the candidate passes verification. |
| `fise verify <profile-file>` | Verify a trusted generated Profile without changing it. |
| `fise verify <javascript-profile> <python-profile>` | Verify both native runtimes, the shared fingerprint, and exact JavaScript/Python wire output. |
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

### Python backend pair

```sh
npx fise generate ./shared/fise.profile.ts --backend python
```

The output path names the JavaScript/TypeScript frontend artifact. The CLI
derives an importable adjacent Python filename from its stem; this example
produces `fise_profile.py`. It creates one transient typed IR, emits both
languages from it, gives both artifacts one fingerprint, runs both native
verifiers, and compares exact envelopes in both directions. Python 3.10 or
newer is required only when generating or verifying a Python artifact.

The pair is one compatibility unit. Both destinations are verified before
publication. New generation uses no-clobber publication with rollback if the
second file cannot be published; intentional replacement retains recoverable
backups until both replacements succeed. Commit and distribute both files
together. Two filesystem paths cannot be replaced as one OS-atomic operation;
an abrupt process or machine failure may require restoring the pair from Git or
the retained temporary backup. Run paired `fise verify` before deployment.
Never run a second generation command in the backend repository.

### Intentional replacement

Generation refuses an existing destination by default:

```sh
npx fise generate ./src/fise.profile.ts --override
```

`--override` still verifies the complete candidate before atomically replacing
the destination. The replacement is a new compatibility artifact: envelopes
created with the previous Profile still require that previous committed file.
With `--backend python`, replacement applies to the complete adjacent pair.

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
`.mts`, or `.ts`, plus generated Python modules using `.py`. It rejects
declaration files such as `.d.ts` and `.d.mts`.

Verify one Python artifact with its native runtime:

```sh
npx fise verify ./shared/fise_profile.py
```

For a JavaScript/Python deployment, use the stronger paired check:

```sh
npx fise verify ./shared/fise.profile.ts ./shared/fise_profile.py
```

## Exit behavior and CI

Every successful command exits with status `0`. Invalid usage, an unsupported
path, an existing generate target, an unrecognized profile, or any failed
verification exits non-zero and writes a typed error code and message to
standard error.

Use verification as a CI check after the profile is generated and committed:

```sh
npx fise verify ./src/fise.profile.ts
```

For a Python backend, CI should run the paired form and install Python 3.10+.

Do not run `fise generate` during install, build, application startup, or normal
test setup. Generate once for a compatibility domain and deploy that exact
source artifact to every producer and consumer.

See [Generated profiles](./PROFILES.md) for lifecycle and ownership details and
the [agent integration guide](./AGENT_GUIDE.md) for automated repository work.

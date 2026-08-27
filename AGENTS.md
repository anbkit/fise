# FISE repository instructions for coding agents

These instructions apply to the entire repository.

## Read before changing behavior

- Read `CONTRIBUTING.md` first.
- Use `README.md` for the public mental model.
- Use `docs/CLI.md` for public command syntax and lifecycle behavior.
- Use `docs/PROFILES.md` for generated-profile ownership and lifecycle.
- Use `docs/SPEC.md` for normative FISE behavior.
- Use `docs/SECURITY.md` for claims and non-claims.
- Use `docs/AGENT_GUIDE.md` when integrating FISE into another application.
- Use `conformance/README.md` and `conformance/v2/vectors.json` for the frozen
  cross-runtime byte contract.

Keep those owners synchronized when a public command, API, wire contract,
profile lifecycle rule, or security statement changes.

## Preserve the FISE 2.0 model

- A generated `Profile` is mandatory when constructing `Fise`.
- One profile handles strings, JSON-safe structured data, and `Uint8Array`.
- Context is an optional dense positional scalar array. It is not a secret key.
- `encrypt` and `decrypt` are operational API terms. Do not describe FISE as
  cryptographic confidentiality, authenticity, integrity, or authorization.
- Do not add a 1.x decoder, default profile, runtime builder, seed, manifest,
  name, revision, or profile history mechanism.

## Generated-profile workflow

- Generate profiles only through `fise generate`; never hand-edit generated
  profile code or call the low-level generated-profile ABI manually.
- Generate exactly once for a compatibility domain. JavaScript-only domains
  share the exact JavaScript file. Python-backend domains use `--backend python`
  so one invocation emits the JavaScript/Python pair from the same transient IR.
  Every producer and consumer must use that exact artifact or pair and the same
  positional context contract.
- In a monorepo, prefer one canonical profile in a shared package instead of
  duplicate copies.
- With separate repositories, generate in one chosen owner. If the destination
  repository or folder is not explicit, ask the user where or how to distribute
  the exact file or language pair before copying it. Never generate a second
  profile on the other side.
- After distribution, run `fise verify` for each JavaScript or Python copy and
  run paired verification for JavaScript/Python deployments. Confirm every
  reported fingerprint matches.
- Do not regenerate a profile during install, build, application startup, or
  test setup. Commit generated profiles and treat replacement as a compatibility
  change. Existing envelopes still require their previous profile.
- Never regenerate the conformance Profile or vectors as routine maintenance.
  A deliberate corpus change requires protocol/version review.

## Change discipline

- Keep the public CLI small and fail closed. Avoid aliases and options that do
  not materially improve the profile lifecycle.
- Preserve unrelated working-tree changes. Do not commit or push unless the user
  explicitly requests it.
- Add focused success, failure, malformed-input, and interoperability tests for
  behavior changes.
- Generated JavaScript/Python profiles, the Python runtime, JavaScript, WASM,
  workers, full/edge coverage, range/progressive operations, documentation, and
  packed npm behavior must remain consistent.

## Verification

Run the narrowest relevant checks while iterating. Before release-oriented
handoff, run:

```sh
npm run release:check
```

The release gate covers tests, examples, docs, types, benchmarks, the packed npm
artifact, and the Chromium JS/WASM/worker smoke test.

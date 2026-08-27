# Roadmap

FISE 2.0 intentionally starts with one small public model: generated
`Profile`, profile-bound `Fise`, one structured/binary codec, one strict wire,
direct binary restoration, explicit full/edge coverage, and optional execution
backends. JavaScript/TypeScript and Python 3.10+ now share one wire and
same-generation Profile-pair workflow.

Potential follow-up work must preserve that model, in this order:

- additional language runtimes emitted from the same transient IR and verified
  bidirectionally against the JavaScript/Python conformance pair;
- framework-specific Python integration examples only where they add behavior
  beyond the dependency-free agent-service example;
- measured code-size and runtime budgets across representative generated profiles;
- property and mutation testing for generator equivalence rejection;
- automated cross-browser CI coverage for the packed restrictive-CSP smoke;
- application-owned HTTP transport adapters outside the core package;
- browser memory and main-thread responsiveness evidence for 10–100 MiB binary workloads;
- bounded block-local primitives only after alignment and range semantics are specified;
- evidence-based evaluation of profile-specific static analysis cost.

Not planned:

- secret profile claims;
- automatic legacy decoding;
- profile-name or revision registries;
- seed storage and deterministic regeneration;
- manual context-segment, offset, marker, or pipeline builders;
- random wire fields presented as cryptographic strength;
- lazy JSON objects or implicit context guessing.

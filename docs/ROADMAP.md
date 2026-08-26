# Roadmap

FISE 2.0 intentionally starts with one small public model: generated
`Profile`, profile-bound `Fise`, one structured/binary codec, one strict wire,
and optional framing/backends.

Potential follow-up work must preserve that model:

- independent cross-runtime conformance implementations generated in the same CLI run;
- measured code-size and runtime budgets across representative generated profiles;
- property and mutation testing for generator equivalence rejection;
- automated cross-browser CI coverage for the packed restrictive-CSP smoke;
- application-owned HTTP transport adapters outside the core package;
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

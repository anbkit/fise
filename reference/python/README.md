# Python binary reference

This standard-library-only implementation independently exercises the FISE 1.1
compiled binary contract. It verifies a canonical profile artifact, reproduces
its content-derived identity, decodes the TypeScript-generated vector, and
encodes the same bytes back from an explicit conformance salt.

It intentionally supports only the portable compiled binary surface:

- `fise.profile-artifact/1`;
- `xor-u8-v1`;
- `uint-be` or printable-ASCII `base-n` markers;
- affine offsets and declared primitive context; and
- complete, non-streaming FISE 1.1 binary envelopes.

It does not execute handwritten JavaScript callbacks, implement the
JavaScript-specific UTF-16 string profile, provide production randomness, or
claim to be a clean-room implementation. It shares no runtime code with the
TypeScript package and exists as independent conformance evidence.

Run:

```sh
python3 -m unittest discover -s reference/python -p 'test_*.py'
```

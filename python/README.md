# FISE for Python

This directory contains the dependency-free Python 3.10+ runtime for FISE 2.0.
It implements the same wire, generated Profile, structured-data, context, TTL,
binary full/edge, range, and progressive behavior as the JavaScript runtime.

Generate the frontend and Python backend Profiles together:

```sh
npx fise generate ./shared/fise.profile.mjs --backend python
```

That one command creates `fise.profile.mjs` and importable `fise_profile.py`
from the same transient generation IR. Commit and distribute those exact files
together. Do not run a second generation in the backend repository.

Verify the complete deployed pair with:

```sh
npx fise verify ./shared/fise.profile.mjs ./shared/fise_profile.py
```

Install the runtime from PyPI, or from a repository checkout during development:

```sh
python -m pip install fise
# development checkout: python -m pip install ./python
```

Then the backend can use the generated instance directly:

```python
from fise import Fise
from fise_profile import profile

fise = Fise(profile, ttl_seconds=30)
context = [session_id, user_id, "orders", "v2"]

encrypted = fise.encrypt({"orderId": "order_1042"}, context)
```

The frontend imports the paired JavaScript Profile and passes the same ordered
context values to `decrypt`. Structured input produces Base64URL text; top-level
binary input produces `bytes`.

Structured values use the shared JSON/binary64 contract: plain `dict`/`list`,
strings, booleans, `None`, and finite `int`/`float` values representable by the
JavaScript number model. Use strings for identifiers or amounts that require
precision beyond binary64. Context is an optional `list` of scalar values in a
fixed order; it is not a secret key.

For large binary data, Python also supports:

```python
fise = Fise(profile, binary="edges")
selected = fise.decrypt_range(encrypted_file, 1_000, 2_000, context)

for chunk in fise.decrypt_progressive(encrypted_file, context, chunk_size=256 * 1024):
    consume(chunk)
```

Binary edge mode leaves the middle bytes directly inspectable. Context is an
ordered application binding, not a secret key. FISE is not cryptographic
confidentiality, integrity, authentication, or authorization.

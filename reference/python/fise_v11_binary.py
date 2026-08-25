"""Independent Python reference for the FISE 1.1 compiled binary profile.

This module is intentionally small and standard-library only. It verifies a
normalized ``fise.profile-artifact/1`` document and implements the complete
binary envelope encode/decode path for the manifest compiler's ``xor-u8-v1``
surface. Production encoding remains owned by the main package; the explicit
salt entry point here exists for deterministic conformance evidence.
"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
import re
from typing import Any, Mapping


MAGIC = b"FISE"
WIRE_MAJOR = 1
WIRE_MINOR = 1
MAX_SAFE_INTEGER = (1 << 53) - 1
PROFILE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$")
CONTEXT_KEY_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class FiseReferenceError(ValueError):
    """Typed failure used by the reference implementation."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"FISE: {message}")
        self.code = code


@dataclass(frozen=True)
class CompiledBinaryProfile:
    """Validated behavior extracted from one canonical profile artifact."""

    profile_id: str
    digest: str
    manifest: Mapping[str, Any]


def _fail(code: str, message: str) -> None:
    raise FiseReferenceError(code, message)


def _require_mapping(value: Any, label: str) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        _fail("INVALID_PROFILE", f"{label} must be an object")
    return value


def _require_exact_keys(value: Mapping[str, Any], expected: set[str], label: str) -> None:
    actual = set(value)
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        _fail(
            "INVALID_PROFILE",
            f"{label} fields differ; missing={missing}, extra={extra}",
        )


def _is_safe_integer(value: Any) -> bool:
    return type(value) is int and -MAX_SAFE_INTEGER <= value <= MAX_SAFE_INTEGER


def _validate_canonical_value(value: Any, label: str) -> None:
    if value is None or type(value) is bool:
        return
    if type(value) is int:
        if not _is_safe_integer(value):
            _fail("INVALID_PROFILE", f"{label} integer is outside the safe range")
        return
    if isinstance(value, str):
        if any(0xD800 <= ord(character) <= 0xDFFF for character in value):
            _fail("INVALID_PROFILE", f"{label} contains a lone surrogate")
        return
    if isinstance(value, list):
        for index, child in enumerate(value):
            _validate_canonical_value(child, f"{label}[{index}]")
        return
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str):
                _fail("INVALID_PROFILE", f"{label} contains a non-string key")
            _validate_canonical_value(key, f"{label} key")
            _validate_canonical_value(child, f"{label}.{key}")
        return
    _fail("INVALID_PROFILE", f"{label} contains a non-JSON value")


def canonical_manifest_json(manifest: Mapping[str, Any]) -> str:
    """Returns the invariant JSON bytes-as-text used for manifest identity.

    Normalized FISE manifests contain only safe integers and schema-restricted
    strings/keys, so Python's compact sorted serialization matches the
    ECMAScript serialization defined by the FISE profile artifact contract.
    """

    _validate_canonical_value(manifest, "manifest")
    return json.dumps(
        manifest,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def load_compiled_binary_profile(artifact: Mapping[str, Any]) -> CompiledBinaryProfile:
    """Validates one normalized artifact and returns its binary behavior."""

    artifact = _require_mapping(artifact, "artifact")
    _require_exact_keys(
        artifact,
        {"schema", "wireVersion", "profileId", "digestAlgorithm", "digest", "manifest"},
        "artifact",
    )
    if artifact["schema"] != "fise.profile-artifact/1":
        _fail("INVALID_PROFILE", "artifact schema is unsupported")
    wire_version = _require_mapping(artifact["wireVersion"], "artifact.wireVersion")
    _require_exact_keys(wire_version, {"major", "minor"}, "artifact.wireVersion")
    if wire_version != {"major": WIRE_MAJOR, "minor": WIRE_MINOR}:
        _fail("UNSUPPORTED_VERSION", "artifact wire version is unsupported")
    if artifact["digestAlgorithm"] != "sha256":
        _fail("INVALID_PROFILE", "artifact digest algorithm must be sha256")

    manifest = _require_mapping(artifact["manifest"], "artifact.manifest")
    _validate_normalized_binary_manifest(manifest)
    canonical = canonical_manifest_json(manifest)
    digest = sha256(canonical.encode("utf-8")).hexdigest()
    if artifact["digest"] != digest:
        _fail("INVALID_PROFILE", "artifact digest does not match canonical manifest")

    profile_id = artifact["profileId"]
    if not isinstance(profile_id, str) or not PROFILE_ID_PATTERN.fullmatch(profile_id):
        _fail("INVALID_PROFILE", "artifact profile ID is invalid")
    expected_id = f"{manifest['name']}.v{manifest['revision']}.{digest[:32]}"
    if profile_id != expected_id:
        _fail("INVALID_PROFILE", "artifact profile ID does not match its manifest digest")
    return CompiledBinaryProfile(profile_id, digest, manifest)


def _validate_normalized_binary_manifest(manifest: Mapping[str, Any]) -> None:
    _require_exact_keys(
        manifest,
        {
            "schema",
            "name",
            "revision",
            "representation",
            "transform",
            "saltRange",
            "marker",
            "offset",
            "context",
            "limits",
        },
        "artifact.manifest",
    )
    if manifest["schema"] != "fise.profile/1":
        _fail("INVALID_PROFILE", "manifest schema is unsupported")
    if manifest["representation"] != "binary" or manifest["transform"] != "xor-u8-v1":
        _fail("INVALID_PROFILE", "reference supports only compiled xor-u8-v1 binary profiles")
    name = manifest["name"]
    if not isinstance(name, str) or not PROFILE_ID_PATTERN.fullmatch(name):
        _fail("INVALID_PROFILE", "manifest name is invalid")
    if not _is_safe_integer(manifest["revision"]) or manifest["revision"] < 1:
        _fail("INVALID_PROFILE", "manifest revision must be a positive safe integer")

    salt_range = _require_mapping(manifest["saltRange"], "manifest.saltRange")
    _require_exact_keys(salt_range, {"min", "max"}, "manifest.saltRange")
    minimum = salt_range["min"]
    maximum = salt_range["max"]
    if not (_is_safe_integer(minimum) and _is_safe_integer(maximum)):
        _fail("INVALID_PROFILE", "salt range must contain safe integers")
    if not 1 <= minimum <= maximum <= 65_535:
        _fail("INVALID_PROFILE", "salt range is outside 1..65535")

    marker = _require_mapping(manifest["marker"], "manifest.marker")
    kind = marker.get("kind")
    if kind == "uint-be":
        _require_exact_keys(marker, {"kind", "width"}, "manifest.marker")
        width = marker["width"]
        if type(width) is not int or not 1 <= width <= 4:
            _fail("INVALID_PROFILE", "uint-be marker width is outside 1..4")
        capacity = (1 << (8 * width)) - 1
    elif kind == "base-n":
        _require_exact_keys(marker, {"kind", "alphabet", "width"}, "manifest.marker")
        alphabet = marker["alphabet"]
        width = marker["width"]
        if (
            not isinstance(alphabet, str)
            or len(alphabet) < 2
            or len(set(alphabet)) != len(alphabet)
            or any(ord(character) < 0x20 or ord(character) > 0x7E for character in alphabet)
        ):
            _fail("INVALID_PROFILE", "base-n marker alphabet is invalid")
        if type(width) is not int or not 1 <= width <= 255:
            _fail("INVALID_PROFILE", "base-n marker width is outside 1..255")
        capacity = len(alphabet) ** width - 1
    else:
        _fail("INVALID_PROFILE", "binary marker kind is unsupported")
    if capacity < maximum:
        _fail("INVALID_PROFILE", "marker cannot represent maximum salt length")

    context = _require_mapping(manifest["context"], "manifest.context")
    _require_exact_keys(
        context,
        {"timestamp", "metadata", "allowAdditionalMetadata"},
        "manifest.context",
    )
    if context["timestamp"] not in {"optional", "required", "forbidden"}:
        _fail("INVALID_PROFILE", "timestamp context policy is invalid")
    if type(context["allowAdditionalMetadata"]) is not bool:
        _fail("INVALID_PROFILE", "allowAdditionalMetadata must be boolean")
    metadata = _require_mapping(context["metadata"], "manifest.context.metadata")
    for key, field_value in metadata.items():
        if not CONTEXT_KEY_PATTERN.fullmatch(key):
            _fail("INVALID_PROFILE", f"metadata key '{key}' is invalid")
        field = _require_mapping(field_value, f"manifest.context.metadata.{key}")
        _require_exact_keys(field, {"type", "required"}, f"manifest.context.metadata.{key}")
        if field["type"] not in {"string", "number", "boolean"}:
            _fail("INVALID_PROFILE", f"metadata field '{key}' type is invalid")
        if type(field["required"]) is not bool:
            _fail("INVALID_PROFILE", f"metadata field '{key}' required flag is invalid")

    offset = _require_mapping(manifest["offset"], "manifest.offset")
    _require_exact_keys(
        offset,
        {
            "kind",
            "lengthMultiplier",
            "saltMultiplier",
            "constant",
            "timestampModulo",
            "metadataTerms",
        },
        "manifest.offset",
    )
    if offset["kind"] != "affine":
        _fail("INVALID_PROFILE", "offset kind must be affine")
    for key in ("lengthMultiplier", "saltMultiplier", "constant"):
        value = offset[key]
        if not _is_safe_integer(value) or abs(value) > 1_000_000:
            _fail("INVALID_PROFILE", f"offset {key} is outside the compiler range")
    timestamp_modulo = offset["timestampModulo"]
    if timestamp_modulo is not None and (
        not _is_safe_integer(timestamp_modulo) or not 1 <= timestamp_modulo <= 1_000_000
    ):
        _fail("INVALID_PROFILE", "timestampModulo is outside the compiler range")
    if timestamp_modulo is not None and context["timestamp"] == "forbidden":
        _fail("INVALID_PROFILE", "timestampModulo conflicts with forbidden context")
    terms = offset["metadataTerms"]
    if not isinstance(terms, list):
        _fail("INVALID_PROFILE", "metadataTerms must be an array")
    previous_key = ""
    for index, term_value in enumerate(terms):
        term = _require_mapping(term_value, f"manifest.offset.metadataTerms[{index}]")
        _require_exact_keys(
            term,
            {"key", "multiplier", "modulo"},
            f"manifest.offset.metadataTerms[{index}]",
        )
        key = term["key"]
        if not isinstance(key, str) or not CONTEXT_KEY_PATTERN.fullmatch(key) or key <= previous_key:
            _fail("INVALID_PROFILE", "metadata terms must have unique sorted keys")
        previous_key = key
        field = metadata.get(key)
        if not field or field["type"] != "number" or field["required"] is not True:
            _fail("INVALID_PROFILE", f"metadata term '{key}' lacks a required number field")
        multiplier = term["multiplier"]
        if not _is_safe_integer(multiplier) or abs(multiplier) > 1_000_000:
            _fail("INVALID_PROFILE", f"metadata term '{key}' multiplier is invalid")
        modulo = term["modulo"]
        if modulo is not None and (
            not _is_safe_integer(modulo) or not 1 <= modulo <= 1_000_000
        ):
            _fail("INVALID_PROFILE", f"metadata term '{key}' modulo is invalid")

    limits = _require_mapping(manifest["limits"], "manifest.limits")
    _require_exact_keys(limits, {"maxEnvelopeLength"}, "manifest.limits")
    limit = limits["maxEnvelopeLength"]
    if limit is not None and (not _is_safe_integer(limit) or limit < 0):
        _fail("INVALID_PROFILE", "maxEnvelopeLength must be null or non-negative")


def _context_snapshot(
    profile: CompiledBinaryProfile,
    supplied: Mapping[str, Any] | None,
) -> tuple[int | None, Mapping[str, Any]]:
    supplied = {} if supplied is None else _require_mapping(supplied, "context")
    unknown = set(supplied) - {"timestamp", "metadata"}
    if unknown:
        _fail("INVALID_CONTEXT", f"context contains unknown fields {sorted(unknown)}")
    contract = profile.manifest["context"]
    has_timestamp = "timestamp" in supplied
    timestamp = supplied.get("timestamp")
    policy = contract["timestamp"]
    if has_timestamp and not _is_safe_integer(timestamp):
        _fail("INVALID_CONTEXT", "timestamp must be a safe integer")
    if policy == "required" and not has_timestamp:
        _fail("INVALID_CONTEXT", "timestamp is required")
    if policy == "forbidden" and has_timestamp:
        _fail("INVALID_CONTEXT", "timestamp is forbidden")

    metadata = supplied.get("metadata", {})
    metadata = _require_mapping(metadata, "context.metadata")
    declared = contract["metadata"]
    for key, field in declared.items():
        if field["required"] and key not in metadata:
            _fail("INVALID_CONTEXT", f"metadata '{key}' is required")
    for key, value in metadata.items():
        field = declared.get(key)
        if field is None:
            if not contract["allowAdditionalMetadata"]:
                _fail("INVALID_CONTEXT", f"metadata '{key}' is not declared")
            continue
        expected = field["type"]
        valid = (
            (expected == "string" and isinstance(value, str))
            or (expected == "boolean" and type(value) is bool)
            or (expected == "number" and _is_safe_integer(value))
        )
        if not valid:
            _fail("INVALID_CONTEXT", f"metadata '{key}' must be a {expected}")
    return timestamp, dict(metadata)


def _js_remainder(value: int, modulus: int) -> int:
    return value % modulus if value >= 0 else -((-value) % modulus)


def _marker_and_offset(
    profile: CompiledBinaryProfile,
    transformed_length: int,
    salt_length: int,
    context: Mapping[str, Any] | None,
) -> tuple[bytes, int]:
    timestamp, metadata = _context_snapshot(profile, context)
    marker = profile.manifest["marker"]
    width = marker["width"]
    if marker["kind"] == "uint-be":
        marker_bytes = salt_length.to_bytes(width, "big")
    else:
        alphabet = marker["alphabet"]
        remaining = salt_length
        encoded = ""
        while True:
            encoded = alphabet[remaining % len(alphabet)] + encoded
            remaining //= len(alphabet)
            if remaining == 0:
                break
        marker_bytes = encoded.rjust(width, alphabet[0]).encode("ascii")

    offset = profile.manifest["offset"]
    value = (
        transformed_length * offset["lengthMultiplier"]
        + salt_length * offset["saltMultiplier"]
        + offset["constant"]
    )
    if offset["timestampModulo"] is not None:
        value += _js_remainder(timestamp or 0, offset["timestampModulo"])
    for term in offset["metadataTerms"]:
        raw = metadata[term["key"]]
        contribution = raw if term["modulo"] is None else _js_remainder(raw, term["modulo"])
        value += contribution * term["multiplier"]
    domain = transformed_length or 1
    position = value % domain
    return marker_bytes, position


def _xor_bytes(value: bytes, salt: bytes) -> bytes:
    if value and not salt:
        _fail("INVALID_SALT", "binary XOR salt must not be empty")
    return bytes(byte ^ salt[index % len(salt)] for index, byte in enumerate(value)) if value else b""


def encode_binary_with_salt(
    payload: bytes,
    salt: bytes,
    profile: CompiledBinaryProfile,
    context: Mapping[str, Any] | None = None,
) -> bytes:
    """Creates a deterministic envelope for conformance tests."""

    if not isinstance(payload, bytes) or not isinstance(salt, bytes):
        _fail("INVALID_INPUT", "payload and salt must be bytes")
    salt_range = profile.manifest["saltRange"]
    if not salt_range["min"] <= len(salt) <= salt_range["max"]:
        _fail("INVALID_SALT", "salt length is outside the profile range")
    if len(payload) > 0xFFFF_FFFF:
        _fail("INVALID_INPUT", "payload is too large for the 1.1 binary header")

    transformed = _xor_bytes(payload, salt)
    marker, position = _marker_and_offset(profile, len(transformed), len(salt), context)
    profile_id = profile.profile_id.encode("ascii")
    header = (
        MAGIC
        + bytes((WIRE_MAJOR, WIRE_MINOR, len(profile_id)))
        + len(salt).to_bytes(2, "big")
        + len(transformed).to_bytes(4, "big")
        + profile_id
    )
    envelope = header + transformed[:position] + marker + transformed[position:] + salt
    limit = profile.manifest["limits"]["maxEnvelopeLength"]
    if limit is not None and len(envelope) > limit:
        _fail("ENVELOPE_TOO_LARGE", "envelope exceeds the profile limit")
    return envelope


def decode_binary(
    envelope: bytes,
    profile: CompiledBinaryProfile,
    context: Mapping[str, Any] | None = None,
    max_envelope_length: int | None = None,
) -> bytes:
    """Validates and restores one complete FISE 1.1 binary envelope."""

    if not isinstance(envelope, bytes):
        _fail("INVALID_ENVELOPE", "envelope must be bytes")
    if max_envelope_length is not None and (
        not _is_safe_integer(max_envelope_length) or max_envelope_length < 0
    ):
        _fail("INVALID_INPUT", "max_envelope_length must be non-negative")
    profile_limit = profile.manifest["limits"]["maxEnvelopeLength"]
    limits = [limit for limit in (profile_limit, max_envelope_length) if limit is not None]
    if limits and len(envelope) > min(limits):
        _fail("ENVELOPE_TOO_LARGE", "envelope exceeds the active limit")
    if len(envelope) < 13:
        _fail("INVALID_ENVELOPE", "binary envelope is shorter than its fixed header")
    if envelope[:4] != MAGIC:
        _fail("UNSUPPORTED_LEGACY", "binary envelope does not carry FISE magic")
    if envelope[4] != WIRE_MAJOR or envelope[5] != WIRE_MINOR:
        _fail("UNSUPPORTED_VERSION", "binary envelope version is unsupported")

    profile_id_length = envelope[6]
    salt_length = int.from_bytes(envelope[7:9], "big")
    transformed_length = int.from_bytes(envelope[9:13], "big")
    header_length = 13 + profile_id_length
    if len(envelope) < header_length:
        _fail("INVALID_ENVELOPE", "binary envelope truncates its profile ID")
    try:
        profile_id = envelope[13:header_length].decode("ascii")
    except UnicodeDecodeError:
        _fail("INVALID_ENVELOPE", "binary envelope profile ID is not ASCII")
    if profile_id != profile.profile_id:
        _fail("PROFILE_MISMATCH", "binary envelope profile ID does not match")
    salt_range = profile.manifest["saltRange"]
    if not salt_range["min"] <= salt_length <= salt_range["max"]:
        _fail("INVALID_ENVELOPE", "declared salt length is outside the profile range")

    marker_size = profile.manifest["marker"]["width"]
    expected_length = header_length + transformed_length + marker_size + salt_length
    if len(envelope) != expected_length:
        _fail("LENGTH_MISMATCH", "binary envelope length differs from declared framing")
    expected_marker, position = _marker_and_offset(
        profile,
        transformed_length,
        salt_length,
        context,
    )
    marker_start = header_length + position
    marker_end = marker_start + marker_size
    actual_marker = envelope[marker_start:marker_end]
    if actual_marker != expected_marker:
        _fail("MARKER_MISMATCH", "binary envelope marker does not match")

    salt_start = header_length + transformed_length + marker_size
    salt = envelope[salt_start:]
    transformed = envelope[header_length:marker_start] + envelope[marker_end:salt_start]
    return _xor_bytes(transformed, salt)

from __future__ import annotations

import base64
import json
import math
from decimal import Decimal
from typing import Any

from ._lz4 import compress_lz4_block, decompress_lz4_block
from .errors import FiseError
from .profile_runtime import Context, ContextScalar

METADATA_LENGTH = 2
_METADATA_VERSION = 1
_STRUCTURED_DATA = 1
_BINARY_DATA = 2
_COMPRESSED_STRUCTURED_DATA = 3
_COMPRESSED_HEADER_LENGTH = METADATA_LENGTH + 4
_MINIMUM_COMPRESSION_INPUT = 256
_MAX_STRUCTURED_CONTENT_LENGTH = 512 * 1024 * 1024
_MAX_COMPRESSION_RATIO = 256
_MAX_NESTING_DEPTH = 64
_MAX_CONTEXT_BYTES = 64 * 1024


def encode_value(value: Any) -> bytes:
    if type(value) is bytes:
        return bytes((_METADATA_VERSION, _BINARY_DATA)) + value
    canonical = canonical_json(value, "input")
    content = canonical.encode("utf-8")
    if len(content) >= _MINIMUM_COMPRESSION_INPUT and len(content) <= 0xFFFFFFFF:
        compressed = compress_lz4_block(content)
        if len(compressed) + 4 < len(content):
            return (
                bytes((_METADATA_VERSION, _COMPRESSED_STRUCTURED_DATA))
                + len(content).to_bytes(4, "big")
                + compressed
            )
    return bytes((_METADATA_VERSION, _STRUCTURED_DATA)) + content


def decode_value(payload: bytes) -> Any:
    _assert_payload_metadata(payload)
    data_type = payload[1]
    if data_type == _BINARY_DATA:
        return bytes(payload[METADATA_LENGTH:])
    if data_type == _STRUCTURED_DATA:
        content = payload[METADATA_LENGTH:]
    elif data_type == _COMPRESSED_STRUCTURED_DATA:
        content = _decode_compressed_structured(payload)
    else:
        raise FiseError("INVALID_PAYLOAD", f"FISE: unknown data type {data_type}.")
    try:
        source = content.decode("utf-8", "strict")
    except UnicodeDecodeError as error:
        raise FiseError("INVALID_PAYLOAD", "FISE: structured payload is not valid UTF-8.", error) from error
    try:
        value = json.loads(
            source,
            parse_int=_parse_json_integer,
            parse_constant=_reject_json_constant,
        )
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        raise FiseError("INVALID_PAYLOAD", "FISE: structured payload is not valid JSON.", error) from error
    try:
        canonical = canonical_json(value, "restored payload")
    except FiseError as error:
        raise FiseError("INVALID_PAYLOAD", "FISE: restored JSON is outside the data contract.", error) from error
    if source != canonical:
        raise FiseError("INVALID_PAYLOAD", "FISE: structured payload is not canonical JSON.")
    return value


def assert_binary_payload_metadata(payload_prefix: bytes) -> None:
    _assert_payload_metadata(payload_prefix)
    if payload_prefix[1] != _BINARY_DATA:
        raise FiseError(
            "INVALID_PAYLOAD",
            "FISE: range and progressive restoration require a top-level binary envelope.",
        )


def prepare_context(context: object = None, *, omitted: bool = False) -> tuple[Context, bytes]:
    source_value: object = [] if omitted else context
    source = canonical_json(source_value, "context")
    if type(source_value) is not list:
        raise FiseError("INVALID_CONTEXT", "FISE: context must be a positional list.")
    values: list[ContextScalar] = []
    for index, value in enumerate(source_value):
        if value is None or type(value) in (bool, int, float, str):
            values.append(value)
        else:
            raise FiseError(
                "INVALID_CONTEXT",
                f"FISE: context[{index}] must be a JSON scalar.",
            )
    encoded_source = source.encode("utf-8")
    if len(encoded_source) > _MAX_CONTEXT_BYTES:
        raise FiseError(
            "INVALID_CONTEXT",
            f"FISE: canonical context exceeds {_MAX_CONTEXT_BYTES} bytes.",
        )
    encoded = base64.urlsafe_b64encode(encoded_source).rstrip(b"=")
    return tuple(values), encoded


def canonical_json(value: object, label: str = "value") -> str:
    ancestors: set[int] = set()
    return _encode_canonical(value, label, 0, ancestors)


def _encode_canonical(
    value: object,
    label: str,
    depth: int,
    ancestors: set[int],
) -> str:
    if depth > _MAX_NESTING_DEPTH:
        raise _invalid_value(label, f"nesting exceeds {_MAX_NESTING_DEPTH}")
    if value is None:
        return "null"
    if type(value) is str:
        _assert_unicode_scalar(value, label)
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if type(value) is bool:
        return "true" if value else "false"
    if type(value) in (int, float):
        return _serialize_number(value, label)
    if type(value) is bytes:
        raise _invalid_value(label, "may contain bytes only as the top-level input")
    if type(value) not in (list, dict):
        raise _invalid_value(label, "must contain only JSON-safe values")
    identity = id(value)
    if identity in ancestors:
        raise _invalid_value(label, "must not contain cycles")
    ancestors.add(identity)
    try:
        if type(value) is list:
            return "[" + ",".join(
                _encode_canonical(item, f"{label}[{index}]", depth + 1, ancestors)
                for index, item in enumerate(value)
            ) + "]"
        entries: list[str] = []
        for key in sorted(value, key=_utf16_sort_key):
            if type(key) is not str:
                raise _invalid_value(label, "object keys must be strings")
            _assert_unicode_scalar(key, f"{label} property name")
            encoded_key = json.dumps(key, ensure_ascii=False, separators=(",", ":"))
            entries.append(
                encoded_key
                + ":"
                + _encode_canonical(value[key], f"{label}.{key}", depth + 1, ancestors)
            )
        return "{" + ",".join(entries) + "}"
    finally:
        ancestors.remove(identity)


def _serialize_number(value: int | float, label: str) -> str:
    if type(value) is int:
        try:
            number = float(value)
        except OverflowError as error:
            raise _invalid_value(label, "integers must be exactly representable as binary64", error) from error
        if not math.isfinite(number) or int(number) != value:
            raise _invalid_value(label, "integers must be exactly representable as binary64")
    else:
        number = value
    if not math.isfinite(number) or (number == 0.0 and math.copysign(1.0, number) < 0):
        raise _invalid_value(label, "numbers must be finite and must not be negative zero")
    if number == 0:
        return "0"
    source = repr(number).lower()
    absolute = abs(number)
    if 1e-6 <= absolute < 1e21:
        fixed = format(Decimal(source), "f")
        if "." in fixed:
            fixed = fixed.rstrip("0").rstrip(".")
        return fixed
    if "e" not in source:
        source = format(number, ".17e")
    coefficient, exponent_source = source.split("e", 1)
    if coefficient.endswith(".0"):
        coefficient = coefficient[:-2]
    exponent = int(exponent_source)
    sign = "+" if exponent >= 0 else ""
    return f"{coefficient}e{sign}{exponent}"


def _utf16_sort_key(value: object) -> bytes:
    if type(value) is not str:
        raise _invalid_value("object", "object keys must be strings")
    _assert_unicode_scalar(value, "object property name")
    return value.encode("utf-16-be")


def _assert_unicode_scalar(value: str, label: str) -> None:
    for character in value:
        code_point = ord(character)
        if 0xD800 <= code_point <= 0xDFFF:
            raise _invalid_value(label, "strings must not contain unpaired UTF-16 surrogates")


def _assert_payload_metadata(payload: bytes) -> None:
    if type(payload) is not bytes or len(payload) < METADATA_LENGTH:
        raise FiseError("INVALID_PAYLOAD", "FISE: restored payload is missing metadata.")
    if payload[0] != _METADATA_VERSION:
        raise FiseError(
            "INVALID_PAYLOAD",
            f"FISE: unsupported payload metadata version {payload[0]}.",
        )


def _decode_compressed_structured(payload: bytes) -> bytes:
    if len(payload) < _COMPRESSED_HEADER_LENGTH + 1:
        raise FiseError("INVALID_PAYLOAD", "FISE: compressed structured payload is truncated.")
    original_length = int.from_bytes(payload[METADATA_LENGTH:_COMPRESSED_HEADER_LENGTH], "big")
    if original_length > _MAX_STRUCTURED_CONTENT_LENGTH:
        raise FiseError(
            "INVALID_PAYLOAD",
            f"FISE: restored structured payload exceeds {_MAX_STRUCTURED_CONTENT_LENGTH} bytes.",
        )
    compressed = payload[_COMPRESSED_HEADER_LENGTH:]
    if original_length > max(_MINIMUM_COMPRESSION_INPUT, len(compressed) * _MAX_COMPRESSION_RATIO):
        raise FiseError(
            "INVALID_PAYLOAD",
            "FISE: compressed structured payload exceeds the allowed expansion ratio.",
        )
    return decompress_lz4_block(compressed, original_length)


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"invalid JSON constant {value}")


def _parse_json_integer(source: str) -> int | float:
    integer = int(source)
    try:
        number = float(source)
    except (OverflowError, ValueError):
        return integer
    if (
        math.isfinite(number)
        and int(number) != integer
        and _serialize_number(number, "JSON number") == source
    ):
        return number
    return integer


def _invalid_value(
    label: str,
    reason: str,
    cause: BaseException | None = None,
) -> FiseError:
    code = "INVALID_CONTEXT" if label.startswith("context") else "INVALID_INPUT"
    return FiseError(code, f"FISE: {label} {reason}.", cause)

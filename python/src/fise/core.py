from __future__ import annotations

import base64
import binascii
import struct
import time
from dataclasses import dataclass
from typing import Any, Callable, Iterator

from ._codec import (
    METADATA_LENGTH,
    assert_binary_payload_metadata,
    decode_value,
    encode_value,
    prepare_context,
)
from .errors import FiseError
from .profile_runtime import Context, ContextState, Profile, ProfileLayout

_MAGIC = b"FISE"
_HEADER_LENGTH = 40
_MARKER_LENGTH = 4
_EDGE_FLAG = 1
_MAX_UINT32 = 0xFFFFFFFF
_MAX_UINT64 = 0xFFFFFFFFFFFFFFFF
_MAX_SAFE_INTEGER = 0x1FFFFFFFFFFFFF
_MAX_ENVELOPE_LENGTH = 512 * 1024 * 1024
_DEFAULT_EDGE_BYTES = 1024 * 1024
_DEFAULT_CHUNK_SIZE = 256 * 1024
_EXPIRY_PREFIX = b"\x00FISE-TTL\x01"
_EDGE_PREFIX = b"\x00FISE-EDGE\x01"
_BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
_OMITTED = object()


@dataclass(frozen=True, slots=True)
class _Coverage:
    mode: str
    edge_bytes: int


_FULL_COVERAGE = _Coverage("full", 0)


@dataclass(frozen=True, slots=True)
class _Operation:
    context: Context
    state: ContextState
    segment: bytes
    binding_length: int


@dataclass(frozen=True, slots=True)
class _ParsedHeader:
    transformed_length: int
    edge_bytes: int
    expires_at_seconds: int
    coverage: _Coverage


@dataclass(frozen=True, slots=True)
class _ValidatedEnvelope:
    envelope: bytes
    profile: Profile
    operation: _Operation
    transformed_length: int
    marker_offset: int
    coverage: _Coverage


@dataclass(frozen=True, slots=True)
class _BinaryEnvelope:
    validated: _ValidatedEnvelope
    content_length: int


class Fise:
    """FISE 2.0 runtime bound to one generated Profile."""

    __slots__ = (
        "_profile",
        "_strict",
        "_ttl_seconds",
        "_binary",
        "_edge_bytes",
        "_clock",
    )

    def __init__(
        self,
        profile: Profile,
        *,
        strict: bool = True,
        ttl_seconds: int | None = None,
        binary: str | None = None,
        edge_bytes: int | None = None,
    ) -> None:
        if type(profile) is not Profile:
            raise FiseError("INVALID_PROFILE", "FISE: a generated Profile instance is required.")
        if type(strict) is not bool:
            raise FiseError("INVALID_INPUT", "FISE: strict must be a boolean.")
        if ttl_seconds is not None and not _is_positive_uint32(ttl_seconds):
            raise FiseError("INVALID_INPUT", "FISE: ttl_seconds must be a positive uint32.")
        if binary is None:
            if edge_bytes is not None:
                raise FiseError("INVALID_INPUT", "FISE: edge_bytes requires binary='edges'.")
            resolved_edge_bytes = None
        elif binary == "edges":
            resolved_edge_bytes = _DEFAULT_EDGE_BYTES if edge_bytes is None else edge_bytes
            if not _is_positive_uint32(resolved_edge_bytes):
                raise FiseError("INVALID_INPUT", "FISE: edge_bytes must be a positive uint32.")
        else:
            raise FiseError("INVALID_INPUT", "FISE: binary must be omitted or 'edges'.")
        self._profile = profile
        self._strict = strict
        self._ttl_seconds = ttl_seconds
        self._binary = binary
        self._edge_bytes = resolved_edge_bytes
        self._clock: Callable[[], int] = _system_clock_milliseconds

    @property
    def profile(self) -> Profile:
        return self._profile

    @property
    def strict(self) -> bool:
        return self._strict

    @property
    def ttl_seconds(self) -> int | None:
        return self._ttl_seconds

    @property
    def binary(self) -> str | None:
        return self._binary

    @property
    def edge_bytes(self) -> int | None:
        return self._edge_bytes

    def encrypt(self, data: Any, context: object = _OMITTED) -> str | bytes | Any:
        try:
            binary_input = type(data) is bytes
            if binary_input:
                _assert_binary_content_envelope_capacity(len(data))
            payload = encode_value(data)
            coverage = _resolve_encrypt_coverage(
                self.edge_bytes,
                binary_input,
                len(payload) - METADATA_LENGTH,
            )
            expires_at_seconds = _capture_expiry(self.ttl_seconds, self._clock)
            envelope = _seal_payload(
                payload,
                self.profile,
                context,
                expires_at_seconds,
                coverage,
            )
            return envelope if binary_input else _encode_base64url(envelope)
        except FiseError as error:
            return _recover(self.strict, data, error)

    def decrypt(self, envelope: object, context: object = _OMITTED) -> Any:
        try:
            wire = _read_envelope(envelope)
            return decode_value(_open_payload(wire, self.profile, context, self._clock))
        except FiseError as error:
            return _recover(self.strict, envelope, error)

    def decrypt_range(
        self,
        envelope: bytes,
        start: int,
        end_exclusive: int,
        context: object = _OMITTED,
    ) -> bytes:
        owned = _own_binary_envelope(envelope, self.profile, context, self._clock)
        _assert_range(start, end_exclusive, owned.content_length)
        return _restore_binary_range(owned, start, end_exclusive)

    def decrypt_progressive(
        self,
        envelope: bytes,
        context: object = _OMITTED,
        *,
        chunk_size: int = _DEFAULT_CHUNK_SIZE,
    ) -> Iterator[bytes]:
        if not _is_positive_uint32(chunk_size):
            raise FiseError("INVALID_INPUT", "FISE: chunk_size must be a positive uint32.")
        owned = _own_binary_envelope(bytes(_assert_bytes(envelope)), self.profile, context, self._clock)

        def chunks() -> Iterator[bytes]:
            start = 0
            while start < owned.content_length:
                end = min(start + chunk_size, owned.content_length)
                yield _restore_binary_range(owned, start, end)
                start = end

        return chunks()


def _set_clock_for_testing(instance: Fise, clock: Callable[[], int]) -> None:
    if not isinstance(instance, Fise) or not callable(clock):
        raise FiseError("INVALID_INPUT", "FISE: test clock is invalid.")
    instance._clock = clock


def _seal_payload(
    payload: bytes,
    profile: Profile,
    context: object,
    expires_at_seconds: int,
    coverage: _Coverage,
) -> bytes:
    _assert_payload_length(len(payload))
    _checked_envelope_length(len(payload))
    operation = _own_operation(profile, context, expires_at_seconds, coverage)
    transformed = _run_covered_kernel(
        profile.forward,
        payload,
        0,
        len(payload),
        operation,
        coverage,
    )
    layout = ProfileLayout(len(payload), operation.binding_length, len(operation.segment))
    marker_offset = profile.offset(layout, operation.state, operation.segment, operation.context)
    marker = profile.marker(layout, operation.state, operation.segment, operation.context)
    flags = _EDGE_FLAG if coverage.mode == "edges" else 0
    header = struct.pack(
        ">4sBBBB16sIIQ",
        _MAGIC,
        2,
        0,
        _HEADER_LENGTH,
        flags,
        profile._fingerprint_bytes,
        len(payload),
        coverage.edge_bytes,
        expires_at_seconds,
    )
    return (
        header
        + transformed[:marker_offset]
        + marker.to_bytes(_MARKER_LENGTH, "big")
        + transformed[marker_offset:]
    )


def _open_payload(
    envelope: bytes,
    profile: Profile,
    context: object,
    clock: Callable[[], int],
) -> bytes:
    owned = _own_validated_envelope(envelope, profile, context, clock)
    transformed = _copy_transformed_range(owned, 0, owned.transformed_length)
    restored = _run_covered_kernel(
        profile.reverse,
        transformed,
        0,
        owned.transformed_length,
        owned.operation,
        owned.coverage,
    )
    if owned.coverage.mode == "edges":
        assert_binary_payload_metadata(restored[:METADATA_LENGTH])
    return restored


def _own_binary_envelope(
    envelope: bytes,
    profile: Profile,
    context: object,
    clock: Callable[[], int],
) -> _BinaryEnvelope:
    wire = bytes(_assert_bytes(envelope))
    owned = _own_validated_envelope(wire, profile, context, clock)
    metadata_length = min(METADATA_LENGTH, owned.transformed_length)
    metadata = _copy_transformed_range(owned, 0, metadata_length)
    metadata = profile.reverse(
        metadata,
        owned.operation.segment,
        owned.operation.state,
        0,
        owned.operation.context,
    )
    assert_binary_payload_metadata(metadata)
    return _BinaryEnvelope(owned, owned.transformed_length - METADATA_LENGTH)


def _own_validated_envelope(
    envelope: bytes,
    profile: Profile,
    context: object,
    clock: Callable[[], int],
) -> _ValidatedEnvelope:
    wire = bytes(_assert_bytes(envelope))
    if len(wire) > _MAX_ENVELOPE_LENGTH:
        raise FiseError("ENVELOPE_LIMIT", "FISE: envelope exceeds the runtime limit.")
    header = _parse_header(wire)
    if wire[8:24] != profile._fingerprint_bytes:
        raise FiseError("PROFILE_MISMATCH", "FISE: envelope belongs to a different profile.")
    expected_length = _checked_envelope_length(header.transformed_length)
    if len(wire) != expected_length:
        raise FiseError(
            "LENGTH_MISMATCH",
            f"FISE: envelope length {len(wire)} does not match declared length {expected_length}.",
        )
    operation = _own_operation(
        profile,
        context,
        header.expires_at_seconds,
        header.coverage,
    )
    layout = ProfileLayout(
        header.transformed_length,
        operation.binding_length,
        len(operation.segment),
    )
    marker_offset = profile.offset(layout, operation.state, operation.segment, operation.context)
    marker_position = _HEADER_LENGTH + marker_offset
    actual_marker = int.from_bytes(wire[marker_position:marker_position + _MARKER_LENGTH], "big")
    expected_marker = profile.marker(layout, operation.state, operation.segment, operation.context)
    if actual_marker != expected_marker:
        raise FiseError(
            "MARKER_MISMATCH",
            "FISE: envelope marker does not match the selected profile and context.",
        )
    _assert_fresh(header.expires_at_seconds, clock)
    return _ValidatedEnvelope(
        wire,
        profile,
        operation,
        header.transformed_length,
        marker_offset,
        header.coverage,
    )


def _own_operation(
    profile: Profile,
    context: object,
    expires_at_seconds: int,
    coverage: _Coverage,
) -> _Operation:
    prepared_context, encoded_context = prepare_context(
        None if context is _OMITTED else context,
        omitted=context is _OMITTED,
    )
    binding = _bind_operation(encoded_context, expires_at_seconds, coverage)
    state = profile.mix_context(binding, prepared_context)
    segment = profile.context_segment(binding)
    return _Operation(prepared_context, state, segment, len(binding))


def _parse_header(envelope: bytes) -> _ParsedHeader:
    if len(envelope) < _HEADER_LENGTH:
        raise FiseError("INVALID_ENVELOPE", "FISE: envelope is shorter than its header.")
    if envelope[:4] != _MAGIC:
        raise FiseError("INVALID_ENVELOPE", "FISE: envelope magic is missing.")
    if envelope[4] != 2 or envelope[5] != 0:
        raise FiseError(
            "UNSUPPORTED_VERSION",
            f"FISE: unsupported wire version {envelope[4]}.{envelope[5]}.",
        )
    flags = envelope[7]
    if envelope[6] != _HEADER_LENGTH or flags & ~_EDGE_FLAG:
        raise FiseError("INVALID_ENVELOPE", "FISE: invalid header length or flags.")
    transformed_length = int.from_bytes(envelope[24:28], "big")
    edge_bytes = int.from_bytes(envelope[28:32], "big")
    expires_at_seconds = int.from_bytes(envelope[32:40], "big")
    coverage = _parse_coverage(flags, edge_bytes, transformed_length)
    return _ParsedHeader(transformed_length, edge_bytes, expires_at_seconds, coverage)


def _parse_coverage(flags: int, edge_bytes: int, transformed_length: int) -> _Coverage:
    if flags & _EDGE_FLAG == 0:
        if edge_bytes != 0:
            raise FiseError(
                "INVALID_ENVELOPE",
                "FISE: full-coverage envelopes must not advertise edge bytes.",
            )
        return _FULL_COVERAGE
    content_length = transformed_length - METADATA_LENGTH
    if edge_bytes < 1 or content_length < 1 or edge_bytes * 2 >= content_length:
        raise FiseError(
            "INVALID_ENVELOPE",
            "FISE: binary edge coverage is invalid or non-canonical.",
        )
    return _Coverage("edges", edge_bytes)


def _bind_operation(
    encoded_context: bytes,
    expires_at_seconds: int,
    coverage: _Coverage,
) -> bytes:
    if not 0 <= expires_at_seconds <= _MAX_UINT64:
        raise FiseError("INVALID_ENVELOPE", "FISE: envelope expiry must fit uint64.")
    binding = encoded_context
    if expires_at_seconds != 0:
        binding += _EXPIRY_PREFIX + expires_at_seconds.to_bytes(8, "big")
    if coverage.mode == "edges":
        binding += _EDGE_PREFIX + coverage.edge_bytes.to_bytes(4, "big")
    return binding


def _run_covered_kernel(
    kernel: Callable[[bytes, bytes, ContextState, int, Context], bytes],
    data: bytes,
    absolute_offset: int,
    transformed_length: int,
    operation: _Operation,
    coverage: _Coverage,
) -> bytes:
    output = bytearray(data)
    for start, end_exclusive in _covered_intersections(
        absolute_offset,
        absolute_offset + len(data),
        transformed_length,
        coverage,
    ):
        relative_start = start - absolute_offset
        relative_end = end_exclusive - absolute_offset
        transformed = kernel(
            data[relative_start:relative_end],
            operation.segment,
            operation.state,
            start,
            operation.context,
        )
        output[relative_start:relative_end] = transformed
    return bytes(output)


def _covered_intersections(
    start: int,
    end_exclusive: int,
    transformed_length: int,
    coverage: _Coverage,
) -> list[tuple[int, int]]:
    if start == end_exclusive:
        return []
    if coverage.mode == "full":
        return [(start, end_exclusive)]
    prefix_end = METADATA_LENGTH + coverage.edge_bytes
    tail_start = transformed_length - coverage.edge_bytes
    segments: list[tuple[int, int]] = []
    selected_prefix_end = min(end_exclusive, prefix_end)
    if start < selected_prefix_end:
        segments.append((start, selected_prefix_end))
    selected_tail_start = max(start, tail_start)
    if selected_tail_start < end_exclusive:
        segments.append((selected_tail_start, end_exclusive))
    return segments


def _copy_transformed_range(
    owned: _ValidatedEnvelope,
    start: int,
    end_exclusive: int,
) -> bytes:
    if start < 0 or end_exclusive < start or end_exclusive > owned.transformed_length:
        raise FiseError("INVALID_RANGE", "FISE: transformed byte range is invalid.")
    if end_exclusive <= owned.marker_offset:
        return owned.envelope[_HEADER_LENGTH + start:_HEADER_LENGTH + end_exclusive]
    if start >= owned.marker_offset:
        physical_start = _HEADER_LENGTH + _MARKER_LENGTH + start
        return owned.envelope[physical_start:physical_start + end_exclusive - start]
    before = owned.envelope[
        _HEADER_LENGTH + start:_HEADER_LENGTH + owned.marker_offset
    ]
    after = owned.envelope[
        _HEADER_LENGTH + _MARKER_LENGTH + owned.marker_offset:
        _HEADER_LENGTH + _MARKER_LENGTH + end_exclusive
    ]
    return before + after


def _restore_binary_range(owned: _BinaryEnvelope, start: int, end_exclusive: int) -> bytes:
    if start == end_exclusive:
        return b""
    transformed_start = METADATA_LENGTH + start
    transformed_end = METADATA_LENGTH + end_exclusive
    selected = _copy_transformed_range(owned.validated, transformed_start, transformed_end)
    return _run_covered_kernel(
        owned.validated.profile.reverse,
        selected,
        transformed_start,
        owned.validated.transformed_length,
        owned.validated.operation,
        owned.validated.coverage,
    )


def _resolve_encrypt_coverage(
    configured_edge_bytes: int | None,
    binary_input: bool,
    content_length: int,
) -> _Coverage:
    if not binary_input or configured_edge_bytes is None:
        return _FULL_COVERAGE
    if configured_edge_bytes * 2 >= content_length:
        return _FULL_COVERAGE
    return _Coverage("edges", configured_edge_bytes)


def _capture_expiry(ttl_seconds: int | None, clock: Callable[[], int]) -> int:
    if ttl_seconds is None:
        return 0
    milliseconds = _read_clock(clock)
    expires_at_seconds = (milliseconds + 999) // 1000 + ttl_seconds
    if expires_at_seconds > _MAX_UINT64:
        raise FiseError("CLOCK_UNAVAILABLE", "FISE: envelope expiry exceeds uint64.")
    return expires_at_seconds


def _assert_fresh(expires_at_seconds: int, clock: Callable[[], int]) -> None:
    if expires_at_seconds == 0:
        return
    if _read_clock(clock) // 1000 >= expires_at_seconds:
        raise FiseError("ENVELOPE_EXPIRED", "FISE: envelope has expired.")


def _read_clock(clock: Callable[[], int]) -> int:
    try:
        milliseconds = clock()
    except BaseException as error:
        raise FiseError("CLOCK_UNAVAILABLE", "FISE: unable to read the system clock.", error) from error
    if type(milliseconds) is not int or milliseconds < 0 or milliseconds > _MAX_SAFE_INTEGER:
        raise FiseError("CLOCK_UNAVAILABLE", "FISE: system clock returned an invalid value.")
    return milliseconds


def _system_clock_milliseconds() -> int:
    return time.time_ns() // 1_000_000


def _read_envelope(value: object) -> bytes:
    if type(value) is bytes:
        if len(value) > _MAX_ENVELOPE_LENGTH:
            raise FiseError("ENVELOPE_LIMIT", "FISE: envelope exceeds the runtime limit.")
        return value
    if type(value) is str:
        return _decode_base64url(value)
    raise FiseError("INVALID_ENVELOPE", "FISE: envelope must be Base64URL text or bytes.")


def _encode_base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode_base64url(value: str) -> bytes:
    if type(value) is not str:
        raise _invalid_base64url()
    remainder = len(value) % 4
    if remainder == 1:
        raise _invalid_base64url()
    output_length = len(value) // 4 * 3 + (0 if remainder == 0 else remainder - 1)
    if output_length > _MAX_ENVELOPE_LENGTH:
        raise FiseError("ENVELOPE_LIMIT", "FISE: encoded envelope exceeds the runtime limit.")
    if any(character not in _BASE64URL_ALPHABET for character in value):
        raise _invalid_base64url()
    if remainder == 2 and _BASE64URL_ALPHABET.index(value[-1]) & 0x0F:
        raise _invalid_base64url()
    if remainder == 3 and _BASE64URL_ALPHABET.index(value[-1]) & 0x03:
        raise _invalid_base64url()
    try:
        decoded = base64.b64decode(
            value + "=" * ((4 - remainder) % 4),
            altchars=b"-_",
            validate=True,
        )
    except (ValueError, binascii.Error) as error:
        raise _invalid_base64url(error) from error
    if len(decoded) != output_length or _encode_base64url(decoded) != value:
        raise _invalid_base64url()
    return decoded


def _invalid_base64url(cause: BaseException | None = None) -> FiseError:
    return FiseError(
        "INVALID_ENVELOPE",
        "FISE: string envelopes must use canonical unpadded Base64URL.",
        cause,
    )


def _assert_range(start: int, end_exclusive: int, content_length: int) -> None:
    if (
        type(start) is not int
        or type(end_exclusive) is not int
        or start < 0
        or end_exclusive < start
        or end_exclusive > content_length
    ):
        raise FiseError("INVALID_RANGE", "FISE: binary range is invalid.")


def _assert_bytes(value: object) -> bytes:
    if type(value) is not bytes:
        raise FiseError("INVALID_ENVELOPE", "FISE: binary envelope must be bytes.")
    return value


def _assert_payload_length(length: int) -> None:
    if type(length) is not int or length < 0 or length > _MAX_UINT32:
        raise FiseError("ENVELOPE_LIMIT", "FISE: payload length must fit uint32.")


def _checked_envelope_length(transformed_length: int) -> int:
    _assert_payload_length(transformed_length)
    length = _HEADER_LENGTH + transformed_length + _MARKER_LENGTH
    if length > _MAX_ENVELOPE_LENGTH:
        raise FiseError("ENVELOPE_LIMIT", "FISE: envelope exceeds the runtime limit.")
    return length


def _assert_binary_content_envelope_capacity(content_length: int) -> None:
    if type(content_length) is not int or content_length < 0:
        raise FiseError("INVALID_INPUT", "FISE: binary input length is invalid.")
    _checked_envelope_length(METADATA_LENGTH + content_length)


def _is_positive_uint32(value: object) -> bool:
    return type(value) is int and 1 <= value <= _MAX_UINT32


def _recover(strict: bool, original: Any, error: FiseError) -> Any:
    if strict or error.code in ("ENVELOPE_EXPIRED", "CLOCK_UNAVAILABLE"):
        raise error
    return original

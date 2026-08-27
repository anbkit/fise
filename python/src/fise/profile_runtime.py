from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Sequence

from .errors import FiseError

ContextScalar = None | bool | int | float | str
Context = tuple[ContextScalar, ...]
ContextState = tuple[int, int, int, int]


@dataclass(frozen=True, slots=True)
class ProfileLayout:
    transformed_length: int
    operation_binding_length: int
    context_segment_length: int


MixContext = Callable[[bytes, Context], Sequence[int]]
LayoutFunction = Callable[[ProfileLayout, ContextState, bytes, Context], int]
Kernel = Callable[[bytes, bytes, ContextState, int, Context], bytes]


@dataclass(frozen=True, slots=True, init=False)
class Profile:
    fingerprint: str
    _fingerprint_bytes: bytes
    _context_segment_offset: int
    _context_segment_length: int
    _mix_context: MixContext
    _offset: LayoutFunction
    _marker: LayoutFunction
    _forward: Kernel
    _reverse: Kernel

    def __init__(self, *_args: object, **_kwargs: object) -> None:
        raise FiseError(
            "INVALID_PROFILE",
            "FISE: profiles must be created by the generated profile ABI.",
        )

    @classmethod
    def generated(
        cls,
        fingerprint: str,
        context_segment_offset: int,
        context_segment_length: int,
        mix_context: MixContext,
        offset: LayoutFunction,
        marker: LayoutFunction,
        forward: Kernel,
        reverse: Kernel,
    ) -> "Profile":
        if not isinstance(fingerprint, str) or len(fingerprint) != 32:
            raise FiseError("INVALID_PROFILE", "FISE: profile fingerprint must contain 16 bytes of hex.")
        try:
            fingerprint_bytes = bytes.fromhex(fingerprint)
        except ValueError as error:
            raise FiseError(
                "INVALID_PROFILE",
                "FISE: profile fingerprint must contain lowercase hexadecimal bytes.",
                error,
            ) from error
        if fingerprint != fingerprint.lower() or len(fingerprint_bytes) != 16:
            raise FiseError("INVALID_PROFILE", "FISE: profile fingerprint must contain lowercase hexadecimal bytes.")
        if not _is_uint32(context_segment_offset):
            raise FiseError("INVALID_PROFILE", "FISE: context segment offset must fit uint32.")
        if not isinstance(context_segment_length, int) or isinstance(context_segment_length, bool):
            raise FiseError("INVALID_PROFILE", "FISE: context segment length is invalid.")
        if context_segment_length < 8 or context_segment_length > 1024:
            raise FiseError("INVALID_PROFILE", "FISE: context segment length must be from 8 through 1024.")
        for callback in (mix_context, offset, marker, forward, reverse):
            if not callable(callback):
                raise FiseError("INVALID_PROFILE", "FISE: generated profile callbacks must be callable.")
        profile = object.__new__(cls)
        object.__setattr__(profile, "fingerprint", fingerprint)
        object.__setattr__(profile, "_fingerprint_bytes", fingerprint_bytes)
        object.__setattr__(profile, "_context_segment_offset", context_segment_offset)
        object.__setattr__(profile, "_context_segment_length", context_segment_length)
        object.__setattr__(profile, "_mix_context", mix_context)
        object.__setattr__(profile, "_offset", offset)
        object.__setattr__(profile, "_marker", marker)
        object.__setattr__(profile, "_forward", forward)
        object.__setattr__(profile, "_reverse", reverse)
        profile._validate()
        return profile

    def mix_context(self, operation_binding: bytes, context: Context) -> ContextState:
        try:
            result = self._mix_context(operation_binding, context)
        except FiseError:
            raise
        except BaseException as error:
            raise FiseError("INVALID_PROFILE", "FISE: generated context mixer failed.", error) from error
        if type(result) not in (tuple, list) or len(result) != 4:
            raise FiseError("INVALID_PROFILE", "FISE: context mixer must return four uint32 lanes.")
        lanes = tuple(result)
        if not all(_is_uint32(value) for value in lanes):
            raise FiseError("INVALID_PROFILE", "FISE: context mixer must return four uint32 lanes.")
        return lanes  # type: ignore[return-value]

    def context_segment(self, operation_binding: bytes) -> bytes:
        if not operation_binding:
            raise FiseError("INVALID_CONTEXT", "FISE: encoded operation binding must not be empty.")
        start = self._context_segment_offset % len(operation_binding)
        return bytes(
            operation_binding[(start + index) % len(operation_binding)]
            for index in range(self._context_segment_length)
        )

    def offset(
        self,
        layout: ProfileLayout,
        state: ContextState,
        segment: bytes,
        context: Context,
    ) -> int:
        value = self._call_layout(self._offset, "offset", layout, state, segment, context)
        if value < 0 or value > layout.transformed_length:
            raise FiseError("INVALID_PROFILE", "FISE: profile offset is outside transformed data.")
        return value

    def marker(
        self,
        layout: ProfileLayout,
        state: ContextState,
        segment: bytes,
        context: Context,
    ) -> int:
        return self._call_layout(self._marker, "marker", layout, state, segment, context)

    def forward(
        self,
        data: bytes,
        segment: bytes,
        state: ContextState,
        absolute_offset: int,
        context: Context,
    ) -> bytes:
        return self._call_kernel(self._forward, "forward", data, segment, state, absolute_offset, context)

    def reverse(
        self,
        data: bytes,
        segment: bytes,
        state: ContextState,
        absolute_offset: int,
        context: Context,
    ) -> bytes:
        return self._call_kernel(self._reverse, "reverse", data, segment, state, absolute_offset, context)

    def _call_layout(
        self,
        callback: LayoutFunction,
        label: str,
        layout: ProfileLayout,
        state: ContextState,
        segment: bytes,
        context: Context,
    ) -> int:
        try:
            value = callback(layout, state, segment, context)
        except FiseError:
            raise
        except BaseException as error:
            raise FiseError("INVALID_PROFILE", f"FISE: generated profile {label} failed.", error) from error
        if not _is_uint32(value):
            raise FiseError("INVALID_PROFILE", f"FISE: profile {label} must fit uint32.")
        return value

    def _call_kernel(
        self,
        callback: Kernel,
        label: str,
        data: bytes,
        segment: bytes,
        state: ContextState,
        absolute_offset: int,
        context: Context,
    ) -> bytes:
        try:
            output = callback(data, segment, state, absolute_offset, context)
        except FiseError:
            raise
        except BaseException as error:
            raise FiseError("INVALID_PROFILE", f"FISE: generated profile {label} kernel failed.", error) from error
        if type(output) is not bytes or len(output) != len(data):
            raise FiseError("INVALID_PROFILE", f"FISE: profile {label} kernel changed byte length or type.")
        return output

    def _validate(self) -> None:
        context: Context = ()
        operation_binding = b"W10"
        state = self.mix_context(operation_binding, context)
        segment = self.context_segment(operation_binding)
        sample = bytes((0, 1, 2, 127, 128, 254, 255))
        forward = self.forward(sample, segment, state, 0, context)
        if self.reverse(forward, segment, state, 0, context) != sample:
            raise FiseError("INVALID_PROFILE", "FISE: generated profile failed its inverse smoke test.")
        layout = ProfileLayout(len(sample), len(operation_binding), len(segment))
        self.offset(layout, state, segment, context)
        self.marker(layout, state, segment, context)


def _is_uint32(value: object) -> bool:
    return type(value) is int and 0 <= value <= 0xFFFFFFFF

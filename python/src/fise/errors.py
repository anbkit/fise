from __future__ import annotations


class FiseError(Exception):
    """Stable FISE failure with a machine-readable code."""

    __slots__ = ("code", "cause")

    def __init__(self, code: str, message: str, cause: BaseException | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.cause = cause

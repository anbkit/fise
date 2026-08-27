from __future__ import annotations

import importlib.util
import json
import pathlib
import sys
from typing import Any

from .core import Fise, _set_clock_for_testing
from ._codec import _parse_json_integer
from .errors import FiseError
from .profile_runtime import Profile

_MAX_PROFILE_SOURCE_BYTES = 2 * 1024 * 1024
_MAX_VERIFICATION_REQUEST_BYTES = 16 * 1024 * 1024
_GENERATED_PREFIX = "from fise.profile_runtime import Profile\n\n_U=4294967295\n"


def main() -> None:
    if len(sys.argv) != 3:
        raise FiseError(
            "INVALID_INPUT",
            "FISE Python verifier expects a profile path and request path.",
        )
    profile_path = pathlib.Path(sys.argv[1]).resolve()
    request_path = pathlib.Path(sys.argv[2]).resolve()
    source = profile_path.read_bytes()
    if len(source) > _MAX_PROFILE_SOURCE_BYTES:
        raise FiseError("INVALID_PROFILE", "FISE Python profile source exceeds 2 MiB.")
    try:
        text = source.decode("utf-8", "strict")
    except UnicodeDecodeError as error:
        raise FiseError("INVALID_PROFILE", "FISE Python profile source is not valid UTF-8.", error) from error
    if not text.startswith(_GENERATED_PREFIX) or "#" in text:
        raise FiseError("INVALID_PROFILE", "FISE Python profile is not a recognized generated module.")
    spec = importlib.util.spec_from_file_location("_fise_generated_profile", profile_path)
    if spec is None or spec.loader is None:
        raise FiseError("INVALID_PROFILE", "FISE Python profile cannot be loaded.")
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except BaseException as error:
        raise FiseError("INVALID_PROFILE", "FISE Python profile failed to load.", error) from error
    profile = getattr(module, "profile", None)
    if not isinstance(profile, Profile):
        raise FiseError("INVALID_PROFILE", "FISE Python module must export one Profile as 'profile'.")

    request_source = request_path.read_bytes()
    if len(request_source) > _MAX_VERIFICATION_REQUEST_BYTES:
        raise FiseError("INVALID_INPUT", "FISE Python verifier request exceeds 16 MiB.")
    try:
        request = json.loads(
            request_source.decode("utf-8", "strict"),
            parse_int=_parse_json_integer,
        )
    except (UnicodeDecodeError, ValueError, TypeError, json.JSONDecodeError) as error:
        raise FiseError("INVALID_INPUT", "FISE Python verifier request is invalid JSON.", error) from error
    if type(request) is not dict or type(request.get("cases")) is not list:
        raise FiseError("INVALID_INPUT", "FISE Python verifier request is invalid.")
    expected_fingerprint = request.get("expectedFingerprint")
    if expected_fingerprint is not None and expected_fingerprint != profile.fingerprint:
        raise FiseError("PROFILE_MISMATCH", "FISE Python Profile fingerprint does not match its pair.")

    checks: list[str] = []
    for case in request["cases"]:
        _verify_case(profile, case)
        checks.append(case["id"])
    json.dump(
        {
            "fingerprint": profile.fingerprint,
            "checks": checks,
        },
        sys.stdout,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    sys.stdout.write("\n")


def _verify_case(profile: Profile, case: object) -> None:
    if type(case) is not dict or type(case.get("id")) is not str:
        raise FiseError("INVALID_INPUT", "FISE Python verifier case is invalid.")
    kind = case.get("kind")
    if kind == "binary":
        input_value: Any = bytes.fromhex(case["inputHex"])
    elif kind == "json":
        input_value = case["input"]
    else:
        raise FiseError("INVALID_INPUT", f"FISE Python verifier case '{case['id']}' has invalid kind.")
    options = case.get("options", {})
    if type(options) is not dict:
        raise FiseError("INVALID_INPUT", "FISE Python verifier options are invalid.")
    binary_options = options.get("binary")
    if binary_options is None:
        binary = None
        edge_bytes = None
    elif type(binary_options) is dict and binary_options.get("mode") == "edges":
        binary = "edges"
        edge_bytes = binary_options.get("edgeBytes")
    else:
        raise FiseError("INVALID_INPUT", "FISE Python verifier binary options are invalid.")
    fise = Fise(
        profile,
        ttl_seconds=options.get("ttlSeconds"),
        binary=binary,
        edge_bytes=edge_bytes,
    )
    clock_milliseconds = case.get("clockMilliseconds")
    if clock_milliseconds is not None:
        _set_clock_for_testing(fise, lambda: clock_milliseconds)
    context_present = "context" in case
    context = case.get("context")
    envelope = fise.encrypt(input_value, context) if context_present else fise.encrypt(input_value)
    if kind == "binary":
        if type(envelope) is not bytes:
            raise AssertionError("binary encryption did not return bytes")
        expected_hex = case.get("wireHex")
        if expected_hex is not None and envelope.hex() != expected_hex:
            raise AssertionError(f"{case['id']} Python wire differs from JavaScript")
        supplied = bytes.fromhex(expected_hex) if expected_hex is not None else envelope
    else:
        if type(envelope) is not str:
            raise AssertionError("structured encryption did not return Base64URL text")
        expected_transport = case.get("expectedTransport")
        if expected_transport is not None and envelope != expected_transport:
            raise AssertionError(f"{case['id']} Python transport differs from JavaScript")
        supplied = expected_transport if expected_transport is not None else envelope
    restored = fise.decrypt(supplied, context) if context_present else fise.decrypt(supplied)
    if restored != input_value or type(restored) is not type(input_value):
        raise AssertionError(f"{case['id']} did not restore its input type and value")

    wrong_context = case.get("wrongContext")
    if wrong_context is not None:
        try:
            fise.decrypt(supplied, wrong_context)
        except FiseError as error:
            if error.code != "MARKER_MISMATCH":
                raise
        else:
            raise AssertionError(f"{case['id']} accepted the wrong context")

    if kind == "binary" and "range" in case:
        range_case = case["range"]
        selected = fise.decrypt_range(
            supplied,
            range_case["start"],
            range_case["endExclusive"],
            context,
        ) if context_present else fise.decrypt_range(
            supplied,
            range_case["start"],
            range_case["endExclusive"],
        )
        if selected.hex() != range_case["expectedHex"]:
            raise AssertionError(f"{case['id']} range restore differs")
    if kind == "binary" and "progressive" in case:
        progressive = case["progressive"]
        chunks = fise.decrypt_progressive(
            supplied,
            context,
            chunk_size=progressive["chunkSize"],
        ) if context_present else fise.decrypt_progressive(
            supplied,
            chunk_size=progressive["chunkSize"],
        )
        if [chunk.hex() for chunk in chunks] != progressive["expectedChunksHex"]:
            raise AssertionError(f"{case['id']} progressive restore differs")


if __name__ == "__main__":
    try:
        main()
    except FiseError as error:
        json.dump(
            {"code": error.code, "message": str(error)},
            sys.stderr,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        sys.stderr.write("\n")
        raise SystemExit(1)
    except BaseException as error:
        json.dump(
            {"code": "INVALID_PROFILE", "message": f"FISE Python verification failed: {error}"},
            sys.stderr,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        sys.stderr.write("\n")
        raise SystemExit(1)

from __future__ import annotations

import importlib.util
import pathlib
import unittest

from fise import Fise, FiseError, Profile
from fise._codec import METADATA_LENGTH
from fise.core import (
    _HEADER_LENGTH,
    _MAX_ENVELOPE_LENGTH,
    _MARKER_LENGTH,
    _assert_binary_content_envelope_capacity,
    _set_clock_for_testing,
)

REPOSITORY_ROOT = pathlib.Path(__file__).resolve().parents[2]
PROFILE_PATH = REPOSITORY_ROOT / "conformance/v2/profile_generated.py"
SPEC = importlib.util.spec_from_file_location("fise_runtime_profile", PROFILE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("unable to load runtime test Profile")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
PROFILE = MODULE.profile


class RuntimeTests(unittest.TestCase):
    def test_one_instance_preserves_text_structured_and_binary_types(self) -> None:
        fise = Fise(PROFILE)
        context = ["session_demo", "user_42", "orders", "v2", 7]
        for value in (
            "hello 🌐",
            {"message": "Xin chào", "values": [None, True, 7]},
            {"binary64": 9.999999999999999e20},
            bytes(range(64)),
        ):
            envelope = fise.encrypt(value, context)
            self.assertIs(type(envelope), bytes if type(value) is bytes else str)
            restored = fise.decrypt(envelope, context)
            self.assertIs(type(restored), type(value))
            self.assertEqual(restored, value)

    def test_raw_fallback_is_explicit_and_expiry_still_fails_closed(self) -> None:
        class Unsupported:
            pass

        raw = Unsupported()
        fallback = Fise(PROFILE, strict=False)
        self.assertIs(fallback.encrypt(raw), raw)
        self.assertIs(fallback.decrypt(raw), raw)
        context = ["session_demo", "user_42"]
        envelope = Fise(PROFILE).encrypt({"ok": True}, context)
        self.assertIs(fallback.decrypt(envelope, ["session_demo", "wrong"]), envelope)

        expiring = Fise(PROFILE, strict=False, ttl_seconds=1)
        _set_clock_for_testing(expiring, lambda: 1_800_000_000_000)
        envelope = expiring.encrypt({"ok": True})
        _set_clock_for_testing(expiring, lambda: 1_800_000_001_000)
        with self.assertRaises(FiseError) as raised:
            expiring.decrypt(envelope)
        self.assertEqual(raised.exception.code, "ENVELOPE_EXPIRED")

    def test_binary_edges_range_progressive_and_overlap_fallback(self) -> None:
        context = ["session_demo", "asset", 9]
        data = bytes((index * 31 + 7) & 0xFF for index in range(20_003))
        edges = Fise(PROFILE, binary="edges", edge_bytes=1024)
        envelope = edges.encrypt(data, context)
        self.assertEqual(edges.decrypt(envelope, context), data)
        self.assertEqual(edges.decrypt_range(envelope, 777, 18_002, context), data[777:18_002])
        self.assertEqual(
            b"".join(edges.decrypt_progressive(envelope, context, chunk_size=1111)),
            data,
        )

        overlapping = Fise(PROFILE, binary="edges", edge_bytes=20_000)
        full = Fise(PROFILE)
        self.assertEqual(overlapping.encrypt(data, context), full.encrypt(data, context))

    def test_python_values_must_fit_the_language_neutral_data_model(self) -> None:
        fise = Fise(PROFILE)
        invalid_values = (
            -0.0,
            float("nan"),
            float("inf"),
            9_007_199_254_740_993,
            (1, 2),
            {"nested": b"binary"},
            {1: "non-string key"},
            "\ud800",
        )
        for value in invalid_values:
            with self.subTest(value=repr(value)):
                with self.assertRaises(FiseError) as raised:
                    fise.encrypt(value)
                self.assertEqual(raised.exception.code, "INVALID_INPUT")

        invalid_contexts = (
            None,
            ("tuple",),
            [["nested"]],
            [9_007_199_254_740_993],
            ["\ud800"],
        )
        for context in invalid_contexts:
            with self.subTest(context=repr(context)):
                with self.assertRaises(FiseError) as raised:
                    fise.encrypt("value", context)
                self.assertEqual(raised.exception.code, "INVALID_CONTEXT")

    def test_options_and_binary_read_arguments_fail_closed(self) -> None:
        for options in (
            {"strict": 1},
            {"ttl_seconds": 0},
            {"ttl_seconds": 1.5},
            {"binary": "full"},
            {"edge_bytes": 1},
            {"binary": "edges", "edge_bytes": 0},
        ):
            with self.subTest(options=options):
                with self.assertRaises(FiseError):
                    Fise(PROFILE, **options)

        envelope = Fise(PROFILE).encrypt(bytes(range(32)))
        for start, end in ((-1, 1), (4, 3), (0, 33), (0.5, 1)):
            with self.subTest(start=start, end=end):
                with self.assertRaises(FiseError) as raised:
                    Fise(PROFILE).decrypt_range(envelope, start, end)
                self.assertEqual(raised.exception.code, "INVALID_RANGE")
        for chunk_size in (0, -1, 0.5, True):
            with self.subTest(chunk_size=chunk_size):
                with self.assertRaises(FiseError) as raised:
                    Fise(PROFILE).decrypt_progressive(envelope, chunk_size=chunk_size)
                self.assertEqual(raised.exception.code, "INVALID_INPUT")

    def test_instance_configuration_is_read_only(self) -> None:
        fise = Fise(PROFILE, strict=False, ttl_seconds=30, binary="edges")
        self.assertIs(fise.profile, PROFILE)
        self.assertIs(fise.strict, False)
        self.assertEqual(fise.ttl_seconds, 30)
        self.assertEqual(fise.binary, "edges")
        self.assertEqual(fise.edge_bytes, 1024 * 1024)
        for name, value in (
            ("profile", None),
            ("strict", True),
            ("ttl_seconds", 60),
            ("binary", None),
            ("edge_bytes", 1),
        ):
            with self.subTest(name=name):
                with self.assertRaises(AttributeError):
                    setattr(fise, name, value)

    def test_profile_construction_and_binary_capacity_fail_closed(self) -> None:
        with self.assertRaises(FiseError) as raised:
            Profile()
        self.assertEqual(raised.exception.code, "INVALID_PROFILE")

        maximum_content_length = (
            _MAX_ENVELOPE_LENGTH - _HEADER_LENGTH - _MARKER_LENGTH - METADATA_LENGTH
        )
        _assert_binary_content_envelope_capacity(maximum_content_length)
        with self.assertRaises(FiseError) as raised:
            _assert_binary_content_envelope_capacity(maximum_content_length + 1)
        self.assertEqual(raised.exception.code, "ENVELOPE_LIMIT")


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import base64
import importlib.util
import json
import pathlib
import struct
import unittest

from fise import Fise, FiseError
from fise._codec import (
    _parse_json_integer,
    canonical_json,
    decode_value,
    encode_value,
    prepare_context,
)
from fise._lz4 import compress_lz4_block, decompress_lz4_block
from fise.core import _set_clock_for_testing

REPOSITORY_ROOT = pathlib.Path(__file__).resolve().parents[2]
VECTORS = json.loads((REPOSITORY_ROOT / "conformance/v2/vectors.json").read_text("utf-8"))
PROFILE_PATH = REPOSITORY_ROOT / "conformance/v2/profile_generated.py"
SPEC = importlib.util.spec_from_file_location("fise_conformance_profile", PROFILE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("unable to load conformance Profile")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
PROFILE = MODULE.profile


class ConformanceTests(unittest.TestCase):
    def test_profile_fingerprint(self) -> None:
        self.assertEqual(PROFILE.fingerprint, VECTORS["profileFingerprint"])

    def test_canonical_json_utf8_and_binary64(self) -> None:
        for vector in VECTORS["canonicalJson"]:
            canonical = canonical_json(parse_interoperable_json(vector["inputJson"]))
            self.assertEqual(canonical, vector["canonicalJson"], vector["id"])
            self.assertEqual(canonical.encode("utf-8").hex(), vector["utf8Hex"], vector["id"])
        for vector in VECTORS["numberSerialization"]:
            value = struct.unpack(">d", bytes.fromhex(vector["ieee754Hex"]))[0]
            self.assertEqual(canonical_json(value), vector["canonicalJson"], vector["ieee754Hex"])

    def test_context_encoding(self) -> None:
        for vector in VECTORS["contexts"]:
            value, encoded = prepare_context(parse_interoperable_json(vector["inputJson"]))
            self.assertEqual(canonical_json(list(value)), vector["canonicalJson"], vector["id"])
            self.assertEqual(encoded.decode("ascii"), vector["encodedBase64Url"], vector["id"])

    def test_lz4_and_payload_bytes(self) -> None:
        for vector in VECTORS["lz4Blocks"]:
            source = bytes.fromhex(vector["inputHex"])
            compressed = compress_lz4_block(source)
            self.assertEqual(compressed.hex(), vector["compressedHex"], vector["id"])
            self.assertEqual(decompress_lz4_block(compressed, len(source)), source, vector["id"])
        for vector in VECTORS["invalidLz4Blocks"]:
            with self.assertRaises(FiseError) as raised:
                decompress_lz4_block(
                    bytes.fromhex(vector["compressedHex"]),
                    vector["expectedLength"],
                )
            self.assertEqual(raised.exception.code, vector["errorCode"], vector["id"])
        for vector in VECTORS["payloads"]:
            value = input_of(vector)
            payload = encode_value(value)
            self.assertEqual(payload.hex(), vector["payloadHex"], vector["id"])
            self.assertEqual(decode_value(payload), value, vector["id"])
            if "canonicalLength" in vector:
                self.assertEqual(
                    len(canonical_json(value).encode("utf-8")),
                    vector["canonicalLength"],
                    vector["id"],
                )
            if "payloadType" in vector:
                self.assertEqual(payload[1], vector["payloadType"], vector["id"])

    def test_accepted_envelopes_range_and_progressive(self) -> None:
        for vector in VECTORS["envelopes"]:
            fise = fise_for(vector)
            input_value = input_of(vector)
            envelope = call_with_context(fise.encrypt, input_value, vector)
            if vector["transport"] == "base64url":
                self.assertIs(type(envelope), str, vector["id"])
                self.assertEqual(envelope, vector["expectedTransport"], vector["id"])
                wire = decode_transport(envelope)
            else:
                self.assertIs(type(envelope), bytes, vector["id"])
                wire = envelope
            self.assertEqual(wire.hex(), vector["wireHex"], vector["id"])
            restored = call_with_context(fise.decrypt, envelope, vector)
            self.assertIs(type(restored), type(input_value), vector["id"])
            self.assertEqual(restored, input_value, vector["id"])

            if vector["kind"] == "binary":
                range_case = vector["range"]
                selected = call_range_with_context(fise, envelope, range_case, vector)
                self.assertEqual(selected.hex(), range_case["expectedHex"], vector["id"])
                progressive = vector["progressive"]
                chunks = call_progressive_with_context(fise, envelope, progressive, vector)
                self.assertEqual(
                    [chunk.hex() for chunk in chunks],
                    progressive["expectedChunksHex"],
                    vector["id"],
                )

    def test_freshness_transport_and_wire_failures(self) -> None:
        for vector in VECTORS["freshness"]:
            source = envelope_vector(vector["sourceEnvelope"])
            fise = Fise(PROFILE)
            _set_clock_for_testing(fise, lambda value=vector["clockMilliseconds"]: value)
            operation = lambda: call_with_context(
                fise.decrypt,
                bytes.fromhex(source["wireHex"]),
                source,
            )
            if vector.get("outcome") == "restored":
                self.assertEqual(operation(), input_of(source), vector["id"])
            else:
                assert_error(self, vector["errorCode"], operation, vector["id"])

        fise = Fise(PROFILE)
        for vector in VECTORS["invalidTransports"]:
            assert_error(
                self,
                vector["errorCode"],
                lambda value=vector["value"]: fise.decrypt(value),
                vector["id"],
            )
        for vector in VECTORS["invalidEnvelopes"]:
            source = envelope_vector(vector["sourceEnvelope"])
            wire = apply_mutation(bytes.fromhex(source["wireHex"]), vector.get("mutation"))
            fise = Fise(PROFILE)
            if "clockMilliseconds" in source:
                _set_clock_for_testing(fise, lambda value=source["clockMilliseconds"]: value)
            context = vector.get("context", source.get("context", _MISSING))
            operation = (
                (lambda wire=wire, fise=fise: fise.decrypt(wire))
                if context is _MISSING
                else (lambda wire=wire, fise=fise, context=context: fise.decrypt(wire, context))
            )
            assert_error(self, vector["errorCode"], operation, vector["id"])

    def test_malformed_payload_and_input_failures(self) -> None:
        fise = Fise(PROFILE)
        for vector in VECTORS["invalidPayloadEnvelopes"]:
            assert_error(
                self,
                vector["errorCode"],
                lambda wire=vector["wireHex"]: fise.decrypt(bytes.fromhex(wire)),
                vector["id"],
            )
        for vector in VECTORS["invalid"]:
            value = (
                struct.unpack(">d", bytes.fromhex(vector["ieee754Hex"]))[0]
                if vector["kind"] == "ieee754"
                else parse_interoperable_json(vector["inputJson"])
            )
            assert_error(
                self,
                vector["errorCode"],
                lambda value=value: canonical_json(value),
                vector["id"],
            )
        for vector in VECTORS["invalidContext"]:
            context = parse_interoperable_json(vector["inputJson"])
            assert_error(
                self,
                vector["errorCode"],
                lambda context=context: fise.encrypt("context validation", context),
                vector["id"],
            )


_MISSING = object()


def input_of(vector: dict) -> object:
    if "inputFromPayload" in vector:
        return input_of(next(item for item in VECTORS["payloads"] if item["id"] == vector["inputFromPayload"]))
    return parse_interoperable_json(vector["inputJson"]) if vector["kind"] == "json" else bytes.fromhex(vector["inputHex"])


def parse_interoperable_json(source: str):
    return json.loads(source, parse_int=_parse_json_integer)


def fise_for(vector: dict) -> Fise:
    options = vector.get("options", {})
    binary_options = options.get("binary")
    fise = Fise(
        PROFILE,
        ttl_seconds=options.get("ttlSeconds"),
        binary=None if binary_options is None else "edges",
        edge_bytes=None if binary_options is None else binary_options.get("edgeBytes"),
    )
    if "clockMilliseconds" in vector:
        _set_clock_for_testing(fise, lambda value=vector["clockMilliseconds"]: value)
    return fise


def call_with_context(function, value: object, vector: dict):
    return function(value) if "context" not in vector else function(value, vector["context"])


def call_range_with_context(fise: Fise, envelope: bytes, range_case: dict, vector: dict) -> bytes:
    arguments = (envelope, range_case["start"], range_case["endExclusive"])
    return fise.decrypt_range(*arguments) if "context" not in vector else fise.decrypt_range(*arguments, vector["context"])


def call_progressive_with_context(fise: Fise, envelope: bytes, progressive: dict, vector: dict):
    if "context" not in vector:
        return fise.decrypt_progressive(envelope, chunk_size=progressive["chunkSize"])
    return fise.decrypt_progressive(
        envelope,
        vector["context"],
        chunk_size=progressive["chunkSize"],
    )


def decode_transport(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * ((4 - len(value) % 4) % 4))


def envelope_vector(identifier: str) -> dict:
    return next(vector for vector in VECTORS["envelopes"] if vector["id"] == identifier)


def apply_mutation(source: bytes, mutation: dict | None) -> bytes:
    if mutation is None:
        return source
    kind = mutation["type"]
    if kind == "truncate":
        return source[:mutation["length"]]
    if kind == "truncate-tail":
        return source[:-mutation["bytes"]]
    if kind == "append":
        return source + bytes.fromhex(mutation["hex"])
    output = bytearray(source)
    if kind == "replace":
        replacement = bytes.fromhex(mutation["hex"])
        output[mutation["offset"]:mutation["offset"] + len(replacement)] = replacement
    elif kind == "xor":
        output[mutation["offset"]] ^= mutation["value"]
    else:
        raise AssertionError(f"unsupported mutation {kind}")
    return bytes(output)


def assert_error(test_case: unittest.TestCase, code: str, operation, label: str) -> None:
    with test_case.assertRaises(FiseError, msg=label) as raised:
        operation()
    test_case.assertEqual(raised.exception.code, code, label)


if __name__ == "__main__":
    unittest.main()

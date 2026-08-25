import json
from pathlib import Path
import unittest

from fise_v11_binary import (
    FiseReferenceError,
    canonical_manifest_json,
    decode_binary,
    encode_binary_with_salt,
    load_compiled_binary_profile,
)


FIXTURES = Path(__file__).with_name("fixtures")


class FiseBinaryReferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.artifact = json.loads(
            (FIXTURES / "compiled-binary-artifact.json").read_text(encoding="utf-8")
        )
        cls.vector = json.loads(
            (FIXTURES / "compiled-binary-vector.json").read_text(encoding="utf-8")
        )
        cls.profile = load_compiled_binary_profile(cls.artifact)

    def test_manifest_identity_matches_typescript_artifact(self) -> None:
        self.assertEqual(self.profile.digest, self.vector["digest"])
        self.assertEqual(self.profile.profile_id, self.vector["profileId"])
        self.assertEqual(
            canonical_manifest_json(self.artifact["manifest"]),
            self.vector["canonicalManifest"],
        )

    def test_typescript_vector_decodes_in_python(self) -> None:
        restored = decode_binary(
            bytes.fromhex(self.vector["envelopeHex"]),
            self.profile,
            self.vector["context"],
        )
        self.assertEqual(restored.hex(), self.vector["plaintextHex"])

    def test_python_encoder_reproduces_typescript_vector(self) -> None:
        envelope = encode_binary_with_salt(
            bytes.fromhex(self.vector["plaintextHex"]),
            bytes.fromhex(self.vector["saltHex"]),
            self.profile,
            self.vector["context"],
        )
        self.assertEqual(envelope.hex(), self.vector["envelopeHex"])

    def test_fail_closed_cases(self) -> None:
        envelope = bytes.fromhex(self.vector["envelopeHex"])

        with self.assertRaises(FiseReferenceError) as trailing:
            decode_binary(envelope + b"\x00", self.profile, self.vector["context"])
        self.assertEqual(trailing.exception.code, "LENGTH_MISMATCH")

        marker_changed = bytearray(envelope)
        header_length = 13 + marker_changed[6]
        transformed_length = int.from_bytes(marker_changed[9:13], "big")
        salt_length = int.from_bytes(marker_changed[7:9], "big")
        position = (transformed_length * 7 + 0) % (transformed_length or 1)
        marker_changed[header_length + position] ^= 0x01
        with self.assertRaises(FiseReferenceError) as marker:
            decode_binary(bytes(marker_changed), self.profile, self.vector["context"])
        self.assertEqual(marker.exception.code, "MARKER_MISMATCH")

        with self.assertRaises(FiseReferenceError) as context:
            decode_binary(envelope, self.profile, {"timestamp": 1, "metadata": {}})
        self.assertEqual(context.exception.code, "MARKER_MISMATCH")

        with self.assertRaises(FiseReferenceError) as invalid_context:
            decode_binary(envelope, self.profile, {"timestamp": None, "metadata": {}})
        self.assertEqual(invalid_context.exception.code, "INVALID_CONTEXT")


if __name__ == "__main__":
    unittest.main()

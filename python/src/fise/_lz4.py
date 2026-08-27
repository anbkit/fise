from __future__ import annotations

from .errors import FiseError

_MIN_MATCH = 4
_LAST_LITERALS = 5
_MATCH_FIND_LIMIT = 12
_MAX_DISTANCE = 0xFFFF
_HASH_SIZE = 1 << 16
_HASH_MULTIPLIER = 0x9E3779B1


def compress_lz4_block(data: bytes) -> bytes:
    positions = [-1] * _HASH_SIZE
    output = bytearray()
    cursor = 0
    anchor = 0
    match_find_limit = len(data) - _MATCH_FIND_LIMIT
    match_limit = len(data) - _LAST_LITERALS

    while cursor <= match_find_limit:
        sequence = _read_uint32(data, cursor)
        hash_value = ((sequence * _HASH_MULTIPLIER) & 0xFFFFFFFF) >> 16
        candidate = positions[hash_value]
        positions[hash_value] = cursor
        if (
            candidate < 0
            or cursor - candidate > _MAX_DISTANCE
            or _read_uint32(data, candidate) != sequence
        ):
            cursor += 1
            continue

        match_start = cursor
        candidate_cursor = candidate + _MIN_MATCH
        cursor += _MIN_MATCH
        while cursor < match_limit and data[cursor] == data[candidate_cursor]:
            cursor += 1
            candidate_cursor += 1
        literal_length = match_start - anchor
        match_length = cursor - match_start
        token_index = len(output)
        output.append(0)
        output[token_index] = (min(literal_length, 15) << 4) | min(match_length - _MIN_MATCH, 15)
        if literal_length >= 15:
            _write_extended_length(output, literal_length - 15)
        output.extend(data[anchor:match_start])
        distance = match_start - candidate
        output.append(distance & 0xFF)
        output.append(distance >> 8)
        encoded_match_length = match_length - _MIN_MATCH
        if encoded_match_length >= 15:
            _write_extended_length(output, encoded_match_length - 15)
        anchor = cursor

    literal_length = len(data) - anchor
    output.append(min(literal_length, 15) << 4)
    if literal_length >= 15:
        _write_extended_length(output, literal_length - 15)
    output.extend(data[anchor:])
    return bytes(output)


def decompress_lz4_block(data: bytes, expected_length: int) -> bytes:
    if type(expected_length) is not int or expected_length < 0:
        raise _invalid_block("declared output length is invalid")
    try:
        output = bytearray(expected_length)
    except (MemoryError, OverflowError) as error:
        raise _invalid_block("declared output length cannot be allocated", error) from error
    input_cursor = 0
    output_cursor = 0
    final_literal_length = -1
    last_match_start = -1

    while input_cursor < len(data):
        token = data[input_cursor]
        input_cursor += 1
        literal_length = token >> 4
        if literal_length == 15:
            literal_length, input_cursor = _read_extended_length(
                data,
                input_cursor,
                15,
                expected_length - output_cursor,
            )
        if (
            literal_length > expected_length - output_cursor
            or literal_length > len(data) - input_cursor
        ):
            raise _invalid_block("literal run exceeds its input or output boundary")
        output[output_cursor:output_cursor + literal_length] = data[
            input_cursor:input_cursor + literal_length
        ]
        input_cursor += literal_length
        output_cursor += literal_length

        if input_cursor == len(data):
            final_literal_length = literal_length
            break
        if len(data) - input_cursor < 2:
            raise _invalid_block("match offset is truncated")
        distance = data[input_cursor] | (data[input_cursor + 1] << 8)
        input_cursor += 2
        if distance == 0 or distance > output_cursor:
            raise _invalid_block("match offset points outside restored data")

        encoded_match_length = token & 0x0F
        if encoded_match_length == 15:
            encoded_match_length, input_cursor = _read_extended_length(
                data,
                input_cursor,
                15,
                expected_length - output_cursor - _MIN_MATCH,
            )
        match_length = encoded_match_length + _MIN_MATCH
        if match_length > expected_length - output_cursor:
            raise _invalid_block("match run exceeds the declared output length")
        last_match_start = output_cursor
        source_cursor = output_cursor - distance
        for index in range(match_length):
            output[output_cursor + index] = output[source_cursor + index]
        output_cursor += match_length

    if (
        input_cursor != len(data)
        or output_cursor != expected_length
        or final_literal_length < 0
    ):
        raise _invalid_block("block does not restore the declared output length")
    if last_match_start >= 0 and (
        final_literal_length < _LAST_LITERALS
        or last_match_start > expected_length - _MATCH_FIND_LIMIT
    ):
        raise _invalid_block("block violates the LZ4 terminal sequence boundary")
    return bytes(output)


def _read_uint32(data: bytes, offset: int) -> int:
    return (
        data[offset]
        | (data[offset + 1] << 8)
        | (data[offset + 2] << 16)
        | (data[offset + 3] << 24)
    )


def _write_extended_length(output: bytearray, length: int) -> None:
    while length >= 255:
        output.append(255)
        length -= 255
    output.append(length)


def _read_extended_length(
    data: bytes,
    offset: int,
    base: int,
    maximum: int,
) -> tuple[int, int]:
    length = base
    while True:
        if offset >= len(data):
            raise _invalid_block("extended length is truncated")
        value = data[offset]
        offset += 1
        if maximum < 0 or length > maximum - value:
            raise _invalid_block("extended length exceeds its boundary")
        length += value
        if value != 255:
            return length, offset


def _invalid_block(reason: str, cause: BaseException | None = None) -> FiseError:
    return FiseError(
        "INVALID_PAYLOAD",
        f"FISE: invalid compressed structured payload; {reason}.",
        cause,
    )

"""The animations this integration makes for the lamp's stored GIF.

A lamp keeps one GIF and plays it as the Stored GIF effect over LAN; putting
one there takes the Yeelight Matter commands (light_animations). The frames
live in www/lamp-animations.js (tools/generate_lamp_animations.py), which the
cards read for their previews: 20 x 5 frames as the viewer sees a lamp mounted
the default way, top row first.

The lamp lays a GIF out its own way: pixel n of the file (row order) is shown
at column n // 5, row n % 5 from the top. In the upright layout lamp_gif
writes the frames in that order, turned for the lamp's mount, so the viewer
sees them as drawn. In the app's layout (ANIMATION_LAYOUT_APP) it writes them
as the Yeelight app sends its own GIFs, a plain 20 x 5 picture, which the lamp
shows rearranged the same way as the app's.
"""
from __future__ import annotations

import base64
import functools
import json
from pathlib import Path

try:
    from .const import ANIMATION_LAYOUT_APP, DEVICE_ORIENTATION_TO_FLIP, ORIENTATION_FLIPPED
except ImportError:  # loaded standalone (tests use runpy.run_path, no package)
    import os
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from const import ANIMATION_LAYOUT_APP, DEVICE_ORIENTATION_TO_FLIP, ORIENTATION_FLIPPED

COLS, ROWS = 20, 5
DATA_FILE = Path(__file__).with_name("www") / "lamp-animations.js"
PIXELS = COLS * ROWS
# A GIF upload: 504 bytes a packet (the rest padded with 0x1a), each framed
# [SOH, n, 255 - n, data, CRC-16 hi, lo] from n = 1, then EOT.
GIF_CHUNK = 504
GIF_PACKET_SOH = 0x01
GIF_PACKET_EOT = 0x04
GIF_PAD = 0x1A


@functools.lru_cache(maxsize=1)
def _animations() -> dict:
    """The animations by key: name, delays (ms) and frames (top-first
    (r, g, b) lists)."""
    text = DATA_FILE.read_text(encoding="utf-8")
    data = json.loads(text[text.index("{"):text.rindex("}") + 1])
    animations = {}
    for key, entry in data.items():
        raw = base64.b64decode(entry["frames"])
        pixels = [tuple(raw[index:index + 3]) for index in range(0, len(raw), 3)]
        animations[key] = {
            "name": entry["name"],
            "delays": tuple(int(delay) for delay in entry["delays"]),
            "frames": tuple(
                tuple(pixels[start:start + PIXELS]) for start in range(0, len(pixels), PIXELS)
            ),
        }
    return animations


def animation_names() -> dict[str, str]:
    """Each animation's name by key, in their order."""
    return {key: entry["name"] for key, entry in _animations().items()}


def animation_frame_at(key: str, seconds: float) -> tuple:
    """The top-first frame an animation shows ``seconds`` after it started."""
    entry = _animations()[key]
    delays = entry["delays"]
    elapsed = int(max(0.0, seconds) * 1000) % sum(delays)
    for index, delay in enumerate(delays):
        if elapsed < delay:
            return entry["frames"][index]
        elapsed -= delay
    return entry["frames"][-1]


def lamp_order(frame, orientation: str | None) -> list:
    """A top-first viewer frame in lamp order (row 0 = the lamp's bottom
    row): the inverse of matrix_view.viewer_frame."""
    # Upside-down mounts (matrix_view.is_upside_down_mount) see it turned.
    upside_down = DEVICE_ORIENTATION_TO_FLIP.get(orientation) == ORIENTATION_FLIPPED
    top_first = list(frame)[::-1] if upside_down else list(frame)
    return [
        top_first[(ROWS - 1 - row) * COLS + column]
        for row in range(ROWS)
        for column in range(COLS)
    ]


def app_layout_order(frame) -> list:
    """What the lamp shows, in lamp order, for a top-first picture sent as
    the Yeelight app sends its GIFs (the file is the picture): file pixel n
    at column n // 5, row n % 5 from the top, whatever the mount."""
    return [
        frame[column * ROWS + (ROWS - 1 - row)]
        for row in range(ROWS)
        for column in range(COLS)
    ]


def animation_frame(
    key: str, seconds: float, orientation: str | None = None, layout: str | None = None,
) -> list:
    """The frame in lamp order, as the previews draw it, in ``layout``
    (ANIMATION_LAYOUTS; the upright one when None)."""
    if layout == ANIMATION_LAYOUT_APP:
        return app_layout_order(animation_frame_at(key, seconds))
    return lamp_order(animation_frame_at(key, seconds), orientation)


def gif_order(frame) -> list:
    """A lamp-order frame in the order the lamp reads a GIF: file pixel n is
    column n // 5, row n % 5 from the top."""
    return [
        frame[(ROWS - 1 - index % ROWS) * COLS + index // ROWS]
        for index in range(PIXELS)
    ]


def lamp_gif(key: str, orientation: str | None = None, layout: str | None = None) -> bytes:
    """The GIF a lamp stores for an animation: laid out for it and its
    mount (upright), or the picture as it is (the app's layout)."""
    entry = _animations()[key]
    if layout == ANIMATION_LAYOUT_APP:
        frames = [list(frame) for frame in entry["frames"]]
    else:
        frames = [gif_order(lamp_order(frame, orientation)) for frame in entry["frames"]]
    return lamp_safe(encode_gif(frames, entry["delays"]))


def lamp_safe(data: bytes) -> bytes:
    """``data`` arriving whole: the lamp drops the 0x1a bytes that end an
    upload block (GIF_CHUNK), its padding. A boundary inside the colour
    table cannot move: a 0x1a there becomes 0x1b, one step of one channel
    of one colour. Empty comment blocks after the table move the later
    boundaries until none ends in 0x1a."""
    at = 13 + 3 * 256  # after the header and the global colour table
    data = bytearray(data)
    for end in range(GIF_CHUNK, at + 1, GIF_CHUNK):
        if data[end - 1] == GIF_PAD:
            data[end - 1] = GIF_PAD + 1
    data = bytes(data)
    for pads in range(41):
        shifted = data[:at] + b"\x21\xfe\x01\x20\x00" * pads + data[at:]
        if all(
            shifted[end - 1] != GIF_PAD
            for end in range(GIF_CHUNK, len(shifted) + 1, GIF_CHUNK)
        ):
            return shifted
    raise ValueError("No layout of this GIF keeps the lamp from dropping bytes")


# ── GIF89a ───────────────────────────────────────────────────────────────
# As the lamp plays them: a 256-colour global table, full 20 x 5 frames, each
# kept until the next (disposal 1), looping forever.
def encode_gif(frames, delays) -> bytes:
    """A looping GIF of ``frames`` ((r, g, b) lists in file order, at most 256
    colours in all) with ``delays`` in milliseconds."""
    colours = sorted({tuple(pixel) for frame in frames for pixel in frame})
    if len(colours) > 256:
        raise ValueError("A GIF frame set has at most 256 colours")
    index = {colour: position for position, colour in enumerate(colours)}
    table = bytes(channel for colour in colours for channel in colour)
    table += bytes(3 * (256 - len(colours)))
    out = bytearray(b"GIF89a")
    out += COLS.to_bytes(2, "little") + ROWS.to_bytes(2, "little")
    out += bytes((0xF7, 0, 0))  # global table of 256, 8 bits per colour
    out += table
    out += b"\x21\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00"  # loop forever
    for frame, delay in zip(frames, delays):
        hundredths = max(2, round(delay / 10))
        out += b"\x21\xf9\x04" + bytes((0x04,)) + hundredths.to_bytes(2, "little") + b"\x00\x00"
        out += b"\x2c" + bytes(4) + COLS.to_bytes(2, "little") + ROWS.to_bytes(2, "little") + b"\x00"
        out += bytes((8,))  # LZW minimum code size
        data = _lzw([index[tuple(pixel)] for pixel in frame])
        for start in range(0, len(data), 255):
            block = data[start:start + 255]
            out += bytes((len(block),)) + block
        out += b"\x00"
    out += b"\x3b"
    return bytes(out)


def _lzw(indices: list[int]) -> bytes:
    """GIF LZW of 8-bit colour indices."""
    clear, end = 256, 257
    out = bytearray()
    bits = 0
    count = 0

    def emit(code: int, width: int) -> None:
        nonlocal bits, count
        bits |= code << count
        count += width
        while count >= 8:
            out.append(bits & 0xFF)
            bits >>= 8
            count -= 8

    width = 9
    table: dict[tuple[int, int], int] = {}
    next_code = end + 1
    emit(clear, width)
    prefix = indices[0]
    for value in indices[1:]:
        key = (prefix, value)
        if key in table:
            prefix = table[key]
            continue
        emit(prefix, width)
        if next_code < 4096:
            table[key] = next_code
            next_code += 1
            if next_code > (1 << width) and width < 12:
                width += 1
        else:
            emit(clear, width)
            table.clear()
            next_code = end + 1
            width = 9
        prefix = value
    emit(prefix, width)
    emit(end, width)
    if count:
        out.append(bits & 0xFF)
    return bytes(out)


# ── The upload ───────────────────────────────────────────────────────────
def _crc16(data: bytes) -> int:
    """CRC-16/CCITT-FALSE, as the lamp checks each packet."""
    crc = 0xFFFF
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def gif_packets(data: bytes) -> list[bytes]:
    """The packets a GIF is sent in (sendGifDataFragment), EOT last."""
    packets = []
    for number, start in enumerate(range(0, len(data), GIF_CHUNK), start=1):
        chunk = data[start:start + GIF_CHUNK].ljust(GIF_CHUNK, bytes((GIF_PAD,)))
        crc = _crc16(chunk)
        packets.append(
            bytes((GIF_PACKET_SOH, number & 0xFF, 255 - (number & 0xFF)))
            + chunk + bytes((crc >> 8, crc & 0xFF))
        )
    packets.append(bytes((GIF_PACKET_EOT,)))
    return packets

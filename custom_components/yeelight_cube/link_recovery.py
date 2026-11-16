"""Bring back a Cube Lite stuck with a misaligned internal link, over the LAN.

A stuck Cube Lite (it accepts connections but answers no command) reads every
command its network part passes on a fixed number of bytes too early (the
offset, R): none is ever whole, so none is answered. A command that is
exactly R bytes long on that link is read whole, and the lamp answers it.
R is not known and moves: about a multiple of 115 bytes plus a few (346,
117, 462, 345 and 229 measured on 2026-11-16).

req_ota [1, 1] is sent padded to each likely size in turn until one is
answered: the lamp then re-opens its link at once and restarts itself about
20 s later (filmed 2026-11-16: answered at 229 bytes, normal commands
answered 10 s later, a 0.5 s black restart at 18 s). Over TCP, one command at
a time.

The link size of a command (a TCP client and an id under 24): its JSON line
plus 46 bytes up to 253 characters, 47 from there (link_size). Spaces before
the final ``}`` lengthen it and change nothing else.
"""
from __future__ import annotations

import asyncio
import json
import logging

_LOGGER = logging.getLogger(__name__)

REALIGN_METHOD = "req_ota"
REALIGN_PARAMS = [1, 1]
# The offset grows in steps of about 115 bytes (one millisecond of the
# link), plus a few.
OFFSET_STEP = 115
OFFSET_STEPS = range(1, 9)
OFFSET_SPREAD = (0, 1, 2, 3, -1, -2, -3)
LONGEST_LINK_FRAME = 1023
# Seconds an attempt waits for the lamp's answer (the network part resends
# an unanswered command 3 times, 300 ms apart: one of them may be read).
ANSWER_WAIT = 1.3
CONNECT_TIMEOUT = 3.0
# Commands per TCP connection: the lamp takes about 30 a minute from one
# connection (54 a minute in all); at ANSWER_WAIT apart, 20 stay well within.
COMMANDS_PER_CONNECTION = 20
# Ids under 24 keep link_size exact (one byte in the link's header).
FIRST_ID, LAST_ID = 5, 23


def link_size(line: str) -> int:
    """Bytes a LAN command line takes on the lamp's internal link (a TCP
    client, an id under 24): an 8-byte header and the command in a small
    map, the line itself plus its 2-byte end."""
    text = len(line.encode("latin-1")) + 2
    header = 1 if text < 24 else 2 if text < 256 else 3
    return 8 + 34 + header + text


def padded_line(command_id: int, size: int) -> str | None:
    """REALIGN_METHOD as a line of exactly ``size`` link bytes (spaces before
    its final brace), or None when it cannot be that size."""
    line = json.dumps(
        {"id": command_id, "method": REALIGN_METHOD, "params": REALIGN_PARAMS},
        separators=(",", ":"),
    )
    for pad in range(LONGEST_LINK_FRAME):
        candidate = line[:-1] + " " * pad + "}"
        current = link_size(candidate)
        if current == size:
            return candidate
        if current > size:
            return None
    return None


def candidate_sizes() -> list[int]:
    """The likely offsets, step by step (each with its spread)."""
    smallest = _shortest()
    sizes = []
    for step in OFFSET_STEPS:
        for spread in OFFSET_SPREAD:
            size = OFFSET_STEP * step + spread
            if smallest <= size <= LONGEST_LINK_FRAME and size not in sizes:
                sizes.append(size)
    return sizes


def _shortest() -> int:
    return link_size(json.dumps(
        {"id": FIRST_ID, "method": REALIGN_METHOD, "params": REALIGN_PARAMS}, separators=(",", ":"),
    ))


async def realign(ip: str, port: int, *, answer_wait: float = ANSWER_WAIT) -> int | None:
    """Send REALIGN_METHOD at each candidate size until the lamp answers;
    the size it answered at, or None. Nothing else may be sent to the lamp
    meanwhile (the caller holds its lock)."""
    command_id = FIRST_ID
    connection = None
    sent = 0
    try:
        for size in candidate_sizes():
            line = padded_line(command_id, size)
            command_id = FIRST_ID if command_id >= LAST_ID else command_id + 1
            if line is None:
                continue
            for attempt in (1, 2):
                # A fresh connection every COMMANDS_PER_CONNECTION commands:
                # past its quota the network part refuses a connection's
                # commands itself ("client quota exceeded"), and they never
                # reach the lamp (2026-11-16 18:39: a sweep on one connection
                # was refused from its 30th command); and after the lamp
                # dropped one (18:47), the same size again on a new one.
                if connection is None or sent >= COMMANDS_PER_CONNECTION:
                    _close(connection)
                    connection = await asyncio.wait_for(asyncio.open_connection(ip, port), CONNECT_TIMEOUT)
                    sent = 0
                reader, writer = connection
                try:
                    writer.write((line + "\r\n").encode("latin-1"))
                    await writer.drain()
                    sent += 1
                    if await _answered(reader, answer_wait):
                        return size
                    break
                except OSError:
                    _close(connection)
                    connection = None
                    if attempt == 2:
                        raise
        return None
    finally:
        _close(connection)


def _close(connection) -> None:
    if connection is not None:
        connection[1].close()


async def _answered(reader: asyncio.StreamReader, wait: float) -> bool:
    """Whether the lamp answers a command with a result within ``wait``
    seconds: only an aligned command is (an error can be the network part's
    own, a quota)."""
    loop = asyncio.get_running_loop()
    end = loop.time() + wait
    while (left := end - loop.time()) > 0:
        try:
            line = await asyncio.wait_for(reader.readline(), left)
        except asyncio.TimeoutError:
            return False
        if not line:
            return False
        try:
            answer = json.loads(line.decode("latin-1"))
        except ValueError:
            continue
        if isinstance(answer, dict) and "result" in answer:
            return True
    return False

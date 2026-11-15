"""python-yeelight on a lamp that accepts a connection and closes it without
answering (a Cube Matrix whose LAN is stuck): the library alone reads the
closed connection forever; through lamp_client_bulb's guard (_GuardedBulb) the
command fails at once. Runs with the real library (the other tests stub it)."""
import socket
import threading
import time

import pytest
from yeelight import Bulb, BulbException

from custom_components.yeelight_cube.lamp_client import LampClient
from custom_components.yeelight_cube.lamp_client_bulb import _GuardedBulb

# A local port only (Home Assistant's test plugin blocks sockets otherwise).
pytestmark = pytest.mark.enable_socket


@pytest.fixture
def closing_lamp():
    """A LAN port that reads the command, then closes cleanly (FIN)."""
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(("127.0.0.1", 0))
    server.listen()
    stop = threading.Event()

    def serve():
        server.settimeout(0.2)
        while not stop.is_set():
            try:
                connection, _ = server.accept()
            except OSError:
                continue
            with connection:
                connection.settimeout(1)
                try:
                    connection.recv(1024)
                except OSError:
                    pass
                connection.shutdown(socket.SHUT_RDWR)

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    yield server.getsockname()[1]
    stop.set()
    thread.join(2)
    server.close()


def _command(bulb):
    """send_command in a thread: (finished, its outcome). A thread still
    reading is ended (its socket closed under it) before returning."""
    outcome = {}

    def run():
        try:
            outcome["answer"] = bulb.send_command("get_prop", ["cube_topology"])
        except BulbException as error:
            outcome["error"] = error

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    thread.join(3)
    finished = not thread.is_alive()
    if not finished:
        bulb._Bulb__socket.close()  # its next read fails: the library gives up
        thread.join(3)
    return finished, outcome


def test_the_library_alone_reads_a_closed_connection_forever(closing_lamp):
    # Why the guard exists: the plain library never returns.
    finished, _ = _command(Bulb("127.0.0.1", closing_lamp, auto_on=False))
    assert not finished


def test_the_guarded_library_fails_at_once(closing_lamp):
    started = time.monotonic()
    finished, outcome = _command(_GuardedBulb("127.0.0.1", closing_lamp, auto_on=False))
    assert finished
    assert "error" in outcome
    assert time.monotonic() - started < 2


def test_every_lamp_uses_the_guarded_library():
    assert isinstance(LampClient("127.0.0.1", 9).device, _GuardedBulb)

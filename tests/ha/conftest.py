"""Tests run inside Home Assistant (pytest-homeassistant-custom-component):
the config flow through Home Assistant's own flow manager.

    bash scripts/ha-tests.sh

(The other tests, in tests/, load the integration's code without Home
Assistant and run with unittest.)"""
from unittest.mock import AsyncMock, patch

import pytest

pytest_plugins = "pytest_homeassistant_custom_component"


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Let Home Assistant load custom_components/yeelight_cube."""
    yield


@pytest.fixture(autouse=True)
def no_network_discovery(mock_async_zeroconf):
    """The integration depends on zeroconf (manifest.json): Home Assistant
    sets it up first, here without opening a socket."""
    yield


@pytest.fixture(autouse=True)
def no_integration_setup():
    """A flow's entry is added without setting the lamp up (no network, no
    frontend): only the flow is under test here."""
    with patch(
        "custom_components.yeelight_cube.async_setup", new=AsyncMock(return_value=True)
    ), patch(
        "custom_components.yeelight_cube.async_setup_entry", new=AsyncMock(return_value=True)
    ):
        yield


@pytest.fixture
def lamp_answers():
    """The reachability probe: answers by default, `.side_effect = OSError()`
    for a lamp that does not."""
    with patch("custom_components.yeelight_cube.config_flow.check_tcp", new=AsyncMock()) as probe:
        yield probe

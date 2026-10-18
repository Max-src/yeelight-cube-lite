#!/usr/bin/env bash
# The tests that run inside Home Assistant (tests/ha): the config flow through
# Home Assistant's own flow manager, with its coverage enforced (quality scale:
# config-flow-test-coverage). Linux only (Home Assistant does not run on
# Windows): on Windows, `npm run check` runs this in WSL.
#
#   bash scripts/ha-tests.sh
#
# Uses a dev-only virtual environment, outside the repository (HA_TEST_VENV,
# default ~/.venvs/yeelight_cube_ha), created on first use with
# pytest-homeassistant-custom-component (which brings Home Assistant) and the
# integration's requirement. Nothing of it is shipped or installed in Home
# Assistant itself. CI installs the same packages directly.
set -euo pipefail
cd "$(dirname "$0")/.."

VENV="${HA_TEST_VENV:-$HOME/.venvs/yeelight_cube_ha}"
if [ -z "${CI:-}" ]; then
  if [ ! -x "$VENV/bin/python" ]; then
    python3 -m venv --without-pip "$VENV"
    curl -sSL https://bootstrap.pypa.io/get-pip.py | "$VENV/bin/python" - --quiet
  fi
  if ! "$VENV/bin/python" -c "import pytest_homeassistant_custom_component, yeelight" 2>/dev/null; then
    "$VENV/bin/python" -m pip install --quiet pytest-homeassistant-custom-component yeelight
  fi
  PYTHON="$VENV/bin/python"
else
  PYTHON=python
fi

# Run from a copy outside the Windows folder when it is mounted (/mnt/...):
# much faster, and no Windows __pycache__ mixed in.
if [[ "$PWD" == /mnt/* ]]; then
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
  mkdir -p "$WORK/tests"
  cp -r custom_components "$WORK/"
  cp -r tests/ha "$WORK/tests/"
  find "$WORK" -name __pycache__ -prune -exec rm -rf {} +
  cd "$WORK"
fi

"$PYTHON" -m pytest -c tests/ha/pytest.ini tests/ha -q -p no:cacheprovider \
  --cov=custom_components.yeelight_cube.config_flow --cov-report=term-missing \
  --cov-fail-under=100

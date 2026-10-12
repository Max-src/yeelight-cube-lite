#!/usr/bin/env bash
# The browser checks on Linux, like the Tests workflow on CI (Ubuntu,
# Playwright's Chromium, Linux fonts). Windows runs them in Edge, where
# font metrics and layout differ: a test can pass there and fail only on CI
# (e.g. Linux's wider monospace font put a text field under a drag test's
# press point). `npm run check` runs this through WSL when it is installed.
#
#   bash scripts/linux-browser-checks.sh           the checks
#   bash scripts/linux-browser-checks.sh --setup   one-time: the browser's
#                                                  system libraries and the
#                                                  fonts CI has (needs root)
set -uo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$HOME/.cache/yeelight-cube-linux-check"
NODE_VERSION=22.20.0
# Playwright only knows released Ubuntu versions; newer ones (WSL's default)
# run the CI runner's builds.
. /etc/os-release 2>/dev/null || true
case "${VERSION_ID:-}" in
  20.04 | 22.04 | 24.04) ;;
  *) export PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 ;;
esac

if [ "${1:-}" = "--setup" ]; then
  [ "$(id -u)" = 0 ] || { echo "Run --setup as root (wsl -u root ...)"; exit 1; }
  export DEBIAN_FRONTEND=noninteractive
  dpkg --configure -a
  apt-get update -qq
  # Each library under its current name (t64) or its older one.
  for pair in libnspr4 libnss3 libatk1.0-0t64:libatk1.0-0 \
    libatk-bridge2.0-0t64:libatk-bridge2.0-0 libcups2t64:libcups2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2t64:libasound2 libxfixes3 libdrm2 \
    libatspi2.0-0t64:libatspi2.0-0 libdbus-1-3 libx11-6 libxcb1 libxext6 \
    libglib2.0-0t64:libglib2.0-0 libexpat1 xz-utils curl \
    fonts-liberation fonts-noto-color-emoji fonts-ipafont-gothic \
    fonts-wqy-zenhei fonts-tlwg-loma-otf fonts-freefont-ttf xfonts-scalable; do
    installed=""
    for name in ${pair//:/ }; do
      apt-get install -y -qq "$name" > /dev/null 2>&1 && installed=$name && break
    done
    [ -n "$installed" ] || echo "could not install ${pair//:/ or }"
  done
  echo "Setup done."
  exit 0
fi

# Node: the system's if it is recent enough, else a private copy.
if ! command -v node > /dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  if [ ! -x "$HOME/.local/node$NODE_VERSION/bin/node" ]; then
    echo "Installing Node $NODE_VERSION in ~/.local ..."
    mkdir -p "$HOME/.local/node$NODE_VERSION"
    curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz" |
      tar -xJ -C "$HOME/.local/node$NODE_VERSION" --strip-components=1 || exit 1
  fi
  export PATH="$HOME/.local/node$NODE_VERSION/bin:$PATH"
fi

# A Linux copy of the sources: node_modules must hold Linux builds, and the
# Windows checkout's own node_modules stays untouched.
mkdir -p "$WORK"
(cd "$SRC" && tar --exclude=./node_modules --exclude=./.git --exclude=./.claude \
  --exclude=./.venv --exclude=./test-results -cf - .) | (cd "$WORK" && tar -xf -)
cd "$WORK"
if ! cmp -s package-lock.json node_modules/.package-lock.json 2>/dev/null; then
  npm ci --no-audit --no-fund > /tmp/yc-npm.log 2>&1 || { tail -20 /tmp/yc-npm.log; exit 1; }
fi
npx playwright install chromium > /tmp/yc-playwright.log 2>&1 || { tail -5 /tmp/yc-playwright.log; exit 1; }

status=0
for suite in card-events-browser card-sync-browser card-ui-parity; do
  if BROWSER_CHANNEL=chromium node "tests/$suite.cjs" > "/tmp/yc-$suite.log" 2>&1; then
    echo "PASS  $suite (Linux)"
  else
    status=1
    echo "FAIL  $suite (Linux):"
    if grep -q "error while loading shared libraries" "/tmp/yc-$suite.log"; then
      echo "      the browser's system libraries are missing; run once:"
      echo "      wsl -u root bash scripts/linux-browser-checks.sh --setup"
    else
      grep -E "AssertionError|Error:|FAIL" "/tmp/yc-$suite.log" | head -5 | sed 's/^/      /'
    fi
  fi
done
exit $status

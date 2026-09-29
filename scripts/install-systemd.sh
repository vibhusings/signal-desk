#!/usr/bin/env bash
set -euo pipefail

REPO="${SIGNAL_DESK_REPO:-/home/vibhusingh/gtm-workflow}"
UNIT_SOURCE="$REPO/deploy/signal-desk-runner.service"
ENV_SOURCE="${1:-}"

if [[ ! -f "$UNIT_SOURCE" ]]; then
  echo "Missing $UNIT_SOURCE" >&2
  exit 1
fi

sudo install -d -m 0755 /etc/signal-desk
if [[ -n "$ENV_SOURCE" ]]; then
  sudo install -m 0600 -o root -g root "$ENV_SOURCE" /etc/signal-desk/runner.env
fi
if [[ ! -f /etc/signal-desk/runner.env ]]; then
  echo "Missing /etc/signal-desk/runner.env; pass a prepared environment file as the first argument." >&2
  exit 1
fi

mkdir -p "$REPO/.runtime/bridge" "$HOME/.claude"
chmod 700 "$REPO/.runtime" "$REPO/.runtime/bridge" "$HOME/.claude"
sudo install -m 0644 "$UNIT_SOURCE" /etc/systemd/system/signal-desk-runner.service
sudo systemctl daemon-reload

echo "Installed signal-desk-runner.service without starting it."
echo "Start only after the Mac runner has stopped and runtime state has been copied."

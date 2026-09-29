#!/usr/bin/env bash
# Installs the Signal Desk runner as a systemd service for the current user.
#   bash scripts/install-systemd.sh path/to/runner.env
# Installs the environment file (root-only) and the unit, but does not start it.
# Default service: signal-desk-runner with /etc/signal-desk/runner.env. To run a second
# workspace's runner on the same machine, use its own clone and a different name:
#   SIGNAL_DESK_SERVICE=signal-desk-runner-2 bash scripts/install-systemd.sh runner-2.env
# (installs /etc/signal-desk/signal-desk-runner-2.env). See SETUP.md.
set -euo pipefail

REPO="${SIGNAL_DESK_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
UNIT_SOURCE="$REPO/deploy/signal-desk-runner.service"
ENV_SOURCE="${1:-}"
RUN_USER="$(id -un)"
RUN_GROUP="$(id -gn)"
NODE_BIN="$(command -v node || true)"
SERVICE="${SIGNAL_DESK_SERVICE:-signal-desk-runner}"
[[ "$SERVICE" =~ ^[a-z0-9-]+$ ]] || { echo "SIGNAL_DESK_SERVICE may contain only a-z, 0-9 and -." >&2; exit 1; }
if [[ "$SERVICE" == "signal-desk-runner" ]]; then ENV_TARGET=/etc/signal-desk/runner.env; else ENV_TARGET="/etc/signal-desk/$SERVICE.env"; fi

[[ -f "$UNIT_SOURCE" ]] || { echo "Missing $UNIT_SOURCE" >&2; exit 1; }
[[ -n "$NODE_BIN" ]] || { echo "Node.js 22+ must be installed and on PATH." >&2; exit 1; }
[[ -f "$REPO/.runtime/bridge-config.json" ]] || { echo "Missing $REPO/.runtime/bridge-config.json. Create it with scripts/setup-secrets.mjs (SETUP.md step 4)." >&2; exit 1; }

sudo install -d -m 0755 /etc/signal-desk
if [[ -n "$ENV_SOURCE" ]]; then
  sudo install -m 0600 -o root -g root "$ENV_SOURCE" "$ENV_TARGET"
fi
if ! sudo test -f "$ENV_TARGET"; then
  echo "Missing $ENV_TARGET; pass a prepared environment file as the first argument." >&2
  exit 1
fi

mkdir -p "$REPO/.runtime/bridge" "$HOME/.claude"
chmod 700 "$REPO/.runtime" "$REPO/.runtime/bridge" "$HOME/.claude"
sed -e "s#__USER__#$RUN_USER#g" -e "s#__GROUP__#$RUN_GROUP#g" -e "s#__HOME__#$HOME#g" \
    -e "s#__REPO__#$REPO#g" -e "s#__NODE__#$NODE_BIN#g" -e "s#__ENV_FILE__#$ENV_TARGET#g" "$UNIT_SOURCE" \
  | sudo tee "/etc/systemd/system/$SERVICE.service" >/dev/null
sudo systemctl daemon-reload

echo "Installed $SERVICE.service for $RUN_USER using $ENV_TARGET (not started)."
echo "Start it with: sudo systemctl enable --now $SERVICE.service"
echo "Never run two runners against the same site at once; they would claim the same jobs."

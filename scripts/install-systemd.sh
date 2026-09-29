#!/usr/bin/env bash
# Installs the Signal Desk runner as a systemd service for the current user.
#   bash scripts/install-systemd.sh path/to/runner.env
# Installs the environment file to /etc/signal-desk/runner.env (root-only) and the unit,
# but does not start it. See SETUP.md for the full sequence.
set -euo pipefail

REPO="${SIGNAL_DESK_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
UNIT_SOURCE="$REPO/deploy/signal-desk-runner.service"
ENV_SOURCE="${1:-}"
RUN_USER="$(id -un)"
RUN_GROUP="$(id -gn)"
NODE_BIN="$(command -v node || true)"

[[ -f "$UNIT_SOURCE" ]] || { echo "Missing $UNIT_SOURCE" >&2; exit 1; }
[[ -n "$NODE_BIN" ]] || { echo "Node.js 22+ must be installed and on PATH." >&2; exit 1; }
[[ -f "$REPO/.runtime/bridge-config.json" ]] || { echo "Missing $REPO/.runtime/bridge-config.json. Create it with scripts/setup-secrets.mjs (SETUP.md step 4)." >&2; exit 1; }

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
sed -e "s#__USER__#$RUN_USER#g" -e "s#__GROUP__#$RUN_GROUP#g" -e "s#__HOME__#$HOME#g" \
    -e "s#__REPO__#$REPO#g" -e "s#__NODE__#$NODE_BIN#g" "$UNIT_SOURCE" \
  | sudo tee /etc/systemd/system/signal-desk-runner.service >/dev/null
sudo systemctl daemon-reload

echo "Installed signal-desk-runner.service for $RUN_USER (not started)."
echo "Start it with: sudo systemctl enable --now signal-desk-runner.service"
echo "Never run two runners against the same site at once; they would claim the same jobs."

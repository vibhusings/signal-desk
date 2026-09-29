#!/usr/bin/env bash
# Install the scheduler as a user LaunchAgent.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"
INTERVAL="${1:-300}"   # seconds between runs; 300 = 5 min
LABEL="com.vibhu.gtm-workflow"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="$(command -v node)"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.gtm-workflow"

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$REPO/node_modules/.bin/tsx</string>
    <string>$REPO/src/main.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>StartInterval</key><integer>$INTERVAL</integer>
  <key>StandardOutPath</key><string>$HOME/.gtm-workflow/scheduler.log</string>
  <key>StandardErrorPath</key><string>$HOME/.gtm-workflow/scheduler.err.log</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
PL

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "loaded $LABEL, every ${INTERVAL}s"
echo "logs:      tail -f ~/.gtm-workflow/scheduler.log"
echo "heartbeat: cat ~/.gtm-workflow/heartbeat.json"
echo "stop:      launchctl unload $PLIST"

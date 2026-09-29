#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"
NODE="$(command -v node)"
LABEL="com.vibhu.signal-desk.runner"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$REPO/.runtime/bridge"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array><string>$NODE</string><string>--import</string><string>tsx</string><string>$REPO/src/bridge/runner.ts</string></array>
<key>WorkingDirectory</key><string>$REPO</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>$REPO/.runtime/bridge/runner.log</string>
<key>StandardErrorPath</key><string>$REPO/.runtime/bridge/runner.err.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Signal Desk runner installed. It processes only requests approved in the UI."

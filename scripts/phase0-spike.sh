#!/usr/bin/env bash
# Phase 0 — validate the send-leg linchpin before building phases 1-4.
#
# There are TWO independent auth dependencies in the `cron -> claude -p -> Slashy` path.
# Either can expire silently, which is the exact failure mode this project exists to kill:
#
#   A) Anthropic auth for `claude -p`   -> FIXABLE: `claude setup-token` (subscription, no
#                                          Keychain, 1yr) preferred; ANTHROPIC_API_KEY as fallback.
#   B) Slashy MCP OAuth 2.1 + PKCE      -> NOT fixable: Slashy has no API key. Needs a heartbeat.
#
# By default this sends NO email. Pass --send to do a real send to $TEST_RECIPIENT.

set -uo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] && set -a && . ./.env && set +a

CLAUDE_BIN="$(command -v claude || echo "$HOME/.local/bin/claude")"
LAUNCHD_PATH="/usr/bin:/bin:/usr/sbin:/sbin:$(dirname "$CLAUDE_BIN")"
SEND=0
[[ "${1:-}" == "--send" ]] && SEND=1

pass() { printf '  \033[32m✓ PASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31m✗ FAIL\033[0m  %s\n' "$1"; }
warn() { printf '  \033[33m! WARN\033[0m  %s\n' "$1"; }
info() { printf '  \033[2m→ %s\033[0m\n' "$1"; }
hdr()  { printf '\n\033[1m%s\033[0m\n' "$1"; }

RESULTS=(); record() { RESULTS+=("$1|$2|$3"); }

# Run claude in a launchd-like environment, carrying exactly one auth credential.
# CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) takes precedence when both are set,
# matching Claude Code's own precedence order and this project's preferred path.
headless() {
  local -a auth_env=()
  if [[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
    auth_env=(CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN")
  elif [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
    auth_env=(ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY")
  fi
  env -i HOME="$HOME" PATH="$LAUNCHD_PATH" USER="${USER:-$(id -un)}" \
      "${auth_env[@]+"${auth_env[@]}"}" \
      "$CLAUDE_BIN" "$@" </dev/null 2>&1
}

hdr "Level 0 — claude CLI present"
if [[ -x "$CLAUDE_BIN" ]]; then
  pass "$CLAUDE_BIN ($("$CLAUDE_BIN" --version 2>/dev/null | head -1))"
  record L0 ok "cli present"
else
  fail "claude binary not found"; exit 1
fi

hdr "Level 1 — Anthropic auth (dependency A)"
if [[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
  info "using CLAUDE_CODE_OAUTH_TOKEN (subscription auth via 'claude setup-token')"
elif [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  info "using ANTHROPIC_API_KEY (pay-per-token fallback)"
else
  warn "no CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY set — falling back to the interactive session"
  info "Preferred: run 'claude setup-token' (needs Pro/Max/Team/Enterprise) and put the"
  info "printed token in .env as CLAUDE_CODE_OAUTH_TOKEN. It's a plain env var, not Keychain-"
  info "backed, so it survives a stripped launchd env and doesn't add separate API billing."
  info "Fallback: set ANTHROPIC_API_KEY instead (pay-per-token, no subscription needed)."
fi
OUT=$(headless -p "Reply with exactly: SPIKE_OK")
if grep -q "SPIKE_OK" <<<"$OUT"; then
  pass "headless Anthropic auth works"; record L1 ok "anthropic auth"
else
  fail "headless Anthropic auth FAILED"; info "${OUT:0:200}"
  case "$OUT" in
    *"Not logged in"*)  info "DIAGNOSIS: Keychain unreachable from a stripped env. Run 'claude setup-token'." ;;
    *"expired"*)        info "DIAGNOSIS: stored OAuth expired and cannot self-refresh. Run 'claude setup-token', or re-run 'claude' and /login." ;;
  esac
  record L1 fail "anthropic auth"
  echo; echo "Stopping — fix Anthropic auth first ('claude setup-token' is the durable answer)."; exit 1
fi

hdr "Level 2 — Slashy MCP registered (dependency B)"
if "$CLAUDE_BIN" mcp list 2>&1 | grep -qi slashy; then
  pass "slashy present in \`claude mcp list\`"; record L2 ok "slashy registered"
else
  fail "slashy NOT registered"
  info "claude mcp add --transport http slashy https://slashy.ctrlcenter.ai/mcp"
  record L2 fail "slashy registered"
  echo; echo "Stopping — register Slashy and complete OAuth."; exit 1
fi

hdr "Level 3 — Slashy tool callable headlessly, launchd-like env  ← THE CRITICAL TEST"
OUT=$(headless -p "Use a Slashy tool to count the emails in my inbox. Reply exactly \
SLASHY_AUTH_OK if a Slashy tool succeeded, or SLASHY_AUTH_FAIL plus the error if not." \
  --allowedTools "mcp__slashy" --permission-mode acceptEdits)
if grep -q "SLASHY_AUTH_OK" <<<"$OUT"; then
  pass "Slashy OAuth survives a stripped env with no TTY"; record L3 ok "slashy headless"
else
  fail "Slashy unreachable headlessly — this invalidates the send path"
  info "${OUT:0:300}"
  info "FALLBACK: Slashy manual for first-touch, Gmail API for automated follow-ups."
  record L3 fail "slashy headless"
fi

if [[ $SEND -eq 1 ]]; then
  hdr "Level 4 — real send"
  : "${TEST_RECIPIENT:?set TEST_RECIPIENT in .env before using --send}"
  OUT=$(headless -p "Send a short plain email via Slashy to ${TEST_RECIPIENT}, subject \
'GTM spike $(date +%H:%M:%S)', one sentence saying this is an automated pipeline test. \
Reply SEND_OK when sent, else SEND_FAIL plus the error." \
    --allowedTools "mcp__slashy" --permission-mode acceptEdits)
  if grep -q "SEND_OK" <<<"$OUT"; then
    pass "sent to $TEST_RECIPIENT"; record L4 ok "real send"
  else
    fail "send failed"; info "${OUT:0:300}"; record L4 fail "real send"
  fi
fi

hdr "Summary"
GATE=ok
for r in "${RESULTS[@]}"; do
  IFS='|' read -r k v d <<<"$r"
  [[ "$v" == ok ]] && sym=$'\033[32mok  \033[0m' || { sym=$'\033[31mFAIL\033[0m'; GATE=fail; }
  printf '  %-3s %b %s\n' "$k" "$sym" "$d"
done
echo
if [[ "$GATE" == ok ]]; then
  echo "GATE PASSED — proceed to Phase 1."
  echo "Not yet proven: that this still works after ~48h idle. Re-run then (setup-token is"
  echo "valid for a year, but re-confirm the subprocess spawn path specifically)."
  echo "Slashy OAuth has no API-key escape hatch, so the heartbeat is mandatory regardless."
else
  echo "GATE FAILED — do not build phases 1-4 on this send path."
  exit 1
fi

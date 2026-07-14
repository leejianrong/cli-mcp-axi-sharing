#!/usr/bin/env bash
#
# demo.sh — the on-stage driver for the "CLI vs MCP vs AXI" live run.
#
# Four steps, each advanced by a single keypress (space). You drive the whole
# scripted run with the space bar — fewer live keystrokes, fewer mistakes. This
# is the primary path for slides 9–11; if anything hiccups, cut to the recording
# (see docs/live_demo_script.md §3). Everything here is OFFLINE.
#
# Usage:  cd ci-demo && ./demo.sh        (run `pnpm build` first, or let it build)

# Note: intentionally NOT `pipefail` — the `… | head -40` steps give the
# upstream process a SIGPIPE (exit 141), which pipefail would treat as fatal.
set -eu
cd "$(dirname "$0")"

# --- setup ------------------------------------------------------------------
if [[ ! -f dist/axi.js || ! -f dist/cli.js || ! -f dist/mcp-server.js ]]; then
  echo "Building first (dist/ missing)…"
  pnpm build
fi
mkdir -p out

# A step boundary: clear the screen, print the heading, wait for a keypress,
# then echo the command we're about to run so the room sees it.
step() {
  local heading="$1"
  clear
  printf '\n  \033[1;36m%s\033[0m\n\n' "$heading"
  printf '  \033[2m(space to run)\033[0m'
  read -rsn1 _
  printf '\r\033[K'
}

run() { printf '  \033[1;32m$ %s\033[0m\n\n' "$1"; eval "$1"; }

pause() { printf '\n  \033[2m(space for next)\033[0m'; read -rsn1 _; printf '\r\033[K\n'; }

# --- Step 1 — the CLI: verbose by default -----------------------------------
step "1/4  CLI — verbose by default"
run 'node dist/cli.js list --status failed | head -40'
printf '\n  \033[2m…and it keeps going. No summary, no next step — the agent reads all of it, every turn.\033[0m\n'
run 'node scripts/capture.mjs cli'
pause

# --- Step 2 — the MCP payload: the schema tax -------------------------------
step "2/4  MCP — the schema tax"
run 'node scripts/capture.mjs mcp'
run 'head -40 out/mcp-payload.json'
printf '\n  \033[2mSix tools, each a full schema — the whole menu is loaded into context, charged every turn.\033[0m\n'
pause

# --- Step 3 — the finished AXI command --------------------------------------
step "3/4  AXI — the finished command"
run 'node dist/axi.js list --status failed'
printf '\n  \033[2mSummary line (P4), four fields (P2), truncated logs (P3), TOON encoding (P1).\033[0m\n'
pause
run 'node dist/axi.js list --status failed --full'
printf '\n  \033[2m--full is the escape hatch: nothing hidden, just deferred.\033[0m\n'
run 'node dist/axi.js list --status failed > out/axi-output.txt'
pause

# --- Step 4 — the payoff: token diff ----------------------------------------
step "4/4  The payoff — token diff"
run 'node scripts/token-diff.mjs'
printf '\n  \033[2mPer-call payload, measured live with an approximate tokenizer — read the direction and magnitude.\033[0m\n'
printf '  \033[2mBut an agent never calls a tool just once… → slide 12 (recorded real-agent run).\033[0m\n\n'

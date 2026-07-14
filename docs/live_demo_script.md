# Live Demo Script — Running Three Interfaces on a CI App

**Goal on stage:** show the same task — _"list the pipeline runs that are failing"_ — through a **CLI**, an **MCP server**, and a **finished AXI** command. Prove the payload-token win with a tokenizer diff. **No live coding** — everything is prebuilt; you *run* it. The AXI "how" is on slide 8b as code snippets.

**Time budget:** ~9 minutes — a ~6 min live scripted run (Steps 1–4) + a ~2.5 min recorded real-agent run (Step 5, played from slide 12). **Risk posture:** all three interfaces + the tokenizer are prepped and rehearsed; the agent run is pre-recorded (never live). Primary path for Steps 1–4 is a live run; **if anything hiccups, cut to a pre-recorded screen capture** of the same run — do not debug on stage.

> This script is deliberately prescriptive: exact commands, exact expected output. Do a full dry run, **record it** (that recording *is* your fallback), and **fill in the real token numbers** in slide 11 before the talk.

---

## 0. What you build ahead of time (prep, NOT on stage)

A tiny Node/TypeScript workspace `ci-demo/` alongside the `axi` repo. Suggested layout:

```
ci-demo/
  data/runs.json            # ~8 seeded pipeline runs (verbose: jobs[], long log tail)
  src/core.ts               # loadRuns(), filterByStatus(), summarize()  — shared by all 3
  src/cli.ts                # `ci-cli`  → dumps verbose JSON (the "human" CLI)
  src/mcp-server.ts         # `ci-mcp`  → MCP server exposing ~6 tools with full schemas
  src/axi.ts                # `ci`      → the FINISHED AXI command (built ahead of time)
  scripts/token-diff.mjs    # tokenizer diff across the 3 payloads (gpt-tokenizer)
  scripts/capture.mjs       # writes cli-output.json, mcp-payload.json to /out for the diff
  out/                      # captured payloads (regenerated during the demo)
  recording/demo-run.mp4    # (or asciinema .cast) — full dry-run capture = your fallback
  recording/agent-run.mp4   # real agent (Claude) doing the task via each interface — PLAYED on slide 12
  scripts/agent-run.mjs     # drives a real agent 3× (once per interface) to PRODUCE agent-run.mp4
  package.json              # deps: axi-sdk-js (linked), @toon-format/toon, gpt-tokenizer,
                            #       @modelcontextprotocol/sdk
```

### Data shape (`data/runs.json`) — make JSON look heavy
Each run has enough fields that raw JSON is visibly bloated:
```jsonc
{
  "id": "run_8f2a",
  "status": "failed",              // success | failed | running | cancelled
  "branch": "feat/checkout-retry",
  "commit": { "sha": "a1b9c3d", "message": "retry flaky checkout step", "author": "priya" },
  "trigger": "push",
  "duration_seconds": 342,
  "created_at": "2026-07-13T09:21:04Z",
  "jobs": [ { "name": "lint", "status": "success", "duration": 22 },
            { "name": "unit", "status": "success", "duration": 118 },
            { "name": "e2e",  "status": "failed",  "duration": 202 } ],
  "logs": "…~1500 chars of log tail so truncation is meaningful…"
}
```
Seed ~8 runs: mix of `failed` (3), `running` (2), `success` (3). This makes the aggregate line interesting and the "failing runs" filter non-trivial.

### The three interfaces (prepped)
- **CLI (`src/cli.ts`)** — `ci-cli list --status failed` prints `JSON.stringify(runs, null, 2)` of the full objects. Deliberately verbose. Action/observation split: no summary, no next-step hint.
- **MCP (`src/mcp-server.ts`)** — exposes ~6 tools so the schema tax is visible: `list_runs`, `get_run`, `list_jobs`, `get_logs`, `retry_run`, `cancel_run`. Each with a full JSON-schema `inputSchema` + descriptions. For the demo you don't need a live agent — you need the **payload the model would read**: the concatenated tool schemas + one tool result. `scripts/capture.mjs` serializes that to `out/mcp-payload.json`.
- **AXI (`src/axi.ts`)** — the **finished** command, built ahead of time. You only *run* it on stage. The four transformations that produced it are shown as code snippets on **slide 8b** (before/after), so the audience sees the "how" without you typing.

### `src/axi.ts` — the finished command (built ahead; shown as snippets on slide 8b)
This is what ships and what you run on stage. The commented principle labels map 1:1 to the slide-8b snippets:
```ts
import { renderOutput } from "axi-sdk-js";          // TOON encode under the hood
import { loadRuns, filterByStatus, summarize } from "./core.js";

const status = getFlag("--status");                 // e.g. "failed"
const full = hasFlag("--full");
const runs = status ? filterByStatus(loadRuns(), status) : loadRuns();

// Principle 5: definitive empty state
if (runs.length === 0) { console.log(renderOutput({ summary: "0 runs", runs: [] })); process.exit(0); }

const output = {
  // Principle 4: pre-computed aggregates up front — no extra round-trip
  summary: summarize(loadRuns()),                   // "12 runs · 3 failed · 2 running · 7 passed"
  // Principle 2: minimal default schema — 4 fields, not 10+
  runs: runs.map(r => ({
    id: r.id,
    status: r.status,
    branch: r.branch,
    // Principle 3: content truncation with a --full escape hatch + size hint
    logs: full ? r.logs : truncate(r.logs, 120),    // "…(1500 chars, use --full)"
  })),
  // Principle 9 (freebie to mention): contextual next step
  next: "ci get <id> --full   # for full logs",
};
console.log(renderOutput(output));                  // Principle 1: TOON, ~40% smaller than JSON
```

### The real-agent recording (`recording/agent-run.mp4`) — produce ahead, play on slide 12
This is the "genuine agent on screen" moment. Produce it once, offline of the talk, and play it from the deck.
- **What it shows:** a real agent (Claude — e.g. via the Agent SDK or Claude Code) completing _"list the failing runs"_ **three times**, once per interface (CLI, MCP, AXI), with **turns · total tokens · cost** captured for each. `scripts/agent-run.mjs` runs the three and prints/records the metrics; screen-capture it (or capture the terminal + overlay the numbers in post).
- **Same task, same model, same app** — only the interface changes. That's the whole point: the interface is the independent variable.
- **Why recorded, not live:** deterministic numbers, fully offline on stage, no API/network/latency risk. State this out loud on slide 12 so it's not mistaken for sleight of hand.
- **Capture the three numbers** into slide 12's summary table (turns / tokens / cost per interface) so the point survives even if the video won't play.

---

## 1. Prerequisites checklist (verify morning-of)

- [ ] Node ≥ 20 and `pnpm` installed; `pnpm install` already run in `ci-demo/` (no install lag on stage).
- [ ] `axi-sdk-js` built and linked (`pnpm --filter axi-sdk-js build`, then linked into `ci-demo`).
- [ ] Dependencies present: `@toon-format/toon`, `gpt-tokenizer`, `@modelcontextprotocol/sdk`.
- [ ] All three interfaces run clean: `ci-cli list --status failed`, `ci-mcp` capture, and `ci list --status failed`.
- [ ] `scripts/capture.mjs` and `scripts/token-diff.mjs` run clean and produce numbers.
- [ ] **Recording of the full run captured** (`recording/demo-run.mp4` or asciinema) and it plays without network — this is your fallback.
- [ ] **Real-agent run recorded** (`recording/agent-run.mp4`): a genuine agent (Claude) completing the task via CLI, MCP, and AXI, with **turns · tokens · cost** visible on screen. This plays on **slide 12** and is always from the recording (no live agent on stage).
- [ ] Slide 12 summary table filled with the agent-run numbers; slide 8b code snippets match the shipped `src/axi.ts` (same lines).
- [ ] Terminal prepped per the **UI/terminal optimizations** section below (no editor needed).
- [ ] Dry-run done end to end; slide 11 numbers filled in from the real `token-diff` output.

---

## 2. Demo steps (on stage)

### Step 1 — The CLI: verbose by default (~1.5 min)
**Type:**
```bash
ci-cli list --status failed
```
**Audience sees:** a wall of pretty-printed JSON — 3 full run objects, nested `jobs`, huge `logs`. Scrolls off screen.

**Say:** "This is a normal CLI — built for a human who'll skim it. The agent has to read *all* of this, every turn. Notice there's no summary and no hint of what to do next — if it wants counts, that's another command, another turn."

**Then capture it for the diff:**
```bash
node scripts/capture.mjs cli     # writes out/cli-output.json
```

### Step 2 — The MCP payload: the schema tax (~2 min)
**Type:**
```bash
node scripts/capture.mjs mcp     # writes out/mcp-payload.json (6 tool schemas + one result)
cat out/mcp-payload.json | head -40
```
**Audience sees:** the tool definitions — six tools, each with a JSON schema, descriptions, parameter types — followed by the result.

**Say:** "MCP gives the agent structure and discoverability, which is genuinely useful. But *this whole menu* gets loaded into context — and it's charged every turn. Six tools here; real servers ship thirty. This is the schema tax."

> If you prefer, show the schemas in the editor instead of `cat` — whichever reads bigger on the projector.

### Step 3 — Run the finished AXI command (~1.5 min)
No editing — just run it. Keep slide 8b (the four before/after snippets) visible or one click away so you can point at the code that produced this output.

**Type:**
```bash
ci list --status failed          # compact TOON output
ci list --status failed --full   # same, but full logs — the escape hatch
```
**Audience sees:** a tight TOON block — a `summary` aggregate line, then the failing runs with just `id`, `status`, `branch`, and a truncated `logs` field with a size hint. The `--full` run shows the logs expand.

**Say, pointing back to slide 8b:** "Same data, same task — but this is the four principles doing their job. One line: the encoding is TOON, ~40% smaller than JSON _(P1)_. Four fields instead of ten _(P2)_. A pre-computed summary so the agent doesn't burn a turn counting _(P4)_. And logs truncated with a `--full` escape hatch — nothing hidden, just deferred _(P3)_."

**Capture for the diff:**
```bash
ci list --status failed > out/axi-output.txt
```

### Step 4 — The payoff: live token diff (~1 min)
**Type:**
```bash
node scripts/token-diff.mjs
```
**Audience sees** (illustrative — replace with your real dry-run numbers):
```
Payload tokens for "list failing runs" (gpt-tokenizer, approx):
  MCP  (6 schemas + result) ......  4,120   (baseline)
  CLI  (verbose JSON) ............  1,780   -57% vs MCP
  AXI  (TOON, 4 fields, trunc) ....   410   -90% vs MCP,  -77% vs CLI
```
**Say the honest line:** "This is the *per-call payload* difference, measured live with an approximate tokenizer — so read the *direction and magnitude*, not the third digit. But an agent never calls a tool just once…" → advance to slide 12.

### Step 5 — Play the recorded real-agent run (~2.5 min) [slide 12, from video]
Leave the terminal; this beat is **played from the deck**, not run live.
**Do:** play `recording/agent-run.mp4`. It shows a real agent completing the task via CLI, MCP, then AXI, with **turns · tokens · cost** on screen.
**Say:** "Same model, same task, same app — only the interface changes. This is recorded so the numbers are stable, but it's a genuine agent. Watch what compounds: MCP re-reads that big schema *every turn* and takes more turns; AXI finishes in fewer turns with a fraction of the tokens. The one-payload gap from a second ago multiplies across the whole task."
**Then:** advance to slide 13 (published benchmark) — "and here's that same pattern across hundreds of runs."
**Fallback:** if the video won't play, show slide 12's static summary table (turns/tokens/cost per interface) and narrate it. Never troubleshoot playback live.

---

## 3. Fallback plan (if the live run misbehaves)

**Trigger:** any command errors, hangs > ~5s, or produces unexpected output. Since there's no live coding, the only failure modes are environment/tooling — don't try to fix them on stage.

**Primary recovery — cut to the recording (rehearse the switch):**
1. Say: "Let me switch to a capture of this exact run so we don't waste your time." — no apology spiral, just pivot.
2. Play `recording/demo-run.mp4` (or the asciinema cast) from the pre-noted timestamp for the step that failed. **Know the timestamps** for: CLI output, MCP payload, AXI output, token diff.
3. Narrate over it exactly as you would live, then advance to slide 11 (results).

**Second-layer fallback (if even the recording won't play):** have static assets ready — a screenshot of each command's output and of the `token-diff.mjs` result. Show those and speak to slide 11. Never let a tooling failure eat more than 30 seconds.

**Pre-mortem quick fixes (fix during setup, not on stage):**
- Import fails → confirm `axi-sdk-js` is built + linked (Prereqs). Backup wiring: import `encode` from `@toon-format/toon` directly and `console.log(encode(output))`.
- `ci` / `ci-cli` not found → have the exact working invocation on a sticky note (`node dist/axi.js …` or `pnpm ci …`).
- Any doubt about the machine → just run from the recording start to finish; a clean recording beats a shaky live run every time.

---

## 4. Token-saving & UI/terminal optimizations

**Legibility (projector-friendly):**
- Terminal font ≥ 20pt; high-contrast dark theme; window maximized. (No editor on screen — code lives on slide 8b.)
- **Clear scrollback before each step** (`clear` or `Cmd/Ctrl-K`) so only the current output shows.
- Turn on a **thick cursor** and, if available, a keystroke/HUD overlay so the room sees what you run.

**Keep payloads readable, not overwhelming:**
- Pipe verbose output through `| head -40` so the JSON/schema wall is *representative*, not endless — say "…and it continues" rather than scrolling forever.
- Pre-write shell **aliases** so every command is short and typo-proof (you're running, not typing much):
  ```bash
  alias k='clear'
  alias t='node scripts/token-diff.mjs'
  alias cap='node scripts/capture.mjs'
  ```
- Consider a **`demo.sh`** that runs each step on keypress (e.g. `read -n1` between commands) so you drive the whole run with the space bar — fewer live keystrokes, fewer mistakes.

**Reliability:**
- Run everything **offline** — no network calls anywhere in the path (data is local JSON; tokenizer is local).
- **Pre-warm**: `pnpm install`, build, and one full pass *before* the audience arrives so nothing cold-starts on stage.
- **Record that pre-warm pass** — it doubles as your fallback (`recording/demo-run.mp4`). Note the timestamp of each step.
- Silence notifications / Slack / email; enable Do-Not-Disturb.
- Keep a second terminal pane pre-`cd`'d into `ci-demo/` in case one hangs.

**"Token-saving" in the AXI sense (the thing you're teaching, embodied in the demo):**
- The whole point of Steps 3–4 is that AXI's output is the token-thrifty one. If you *do* end up driving a real agent (not planned, but if asked), keep its context small: one tool, minimal schema, `--full` only when needed — exactly the principles on screen.

---

## 5. Post-demo

- Reset for a possible re-run: `rm -f out/*` so the next run regenerates the captured payloads cleanly. (No code to reset — nothing was edited on stage.)
- Have the repo + `discovery_notes.md` sources ready to share for anyone who wants to reproduce the numbers.

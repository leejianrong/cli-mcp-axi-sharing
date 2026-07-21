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
  src/mcp-server.ts         # `ci-mcp`  → MCP server exposing ~21 tools with full schemas
  src/axi.ts                # `ci`      → the FINISHED AXI command (built ahead of time)
  scripts/token-diff.mjs    # tokenizer diff across the 3 payloads (gpt-tokenizer)
  scripts/capture.mjs       # writes cli-output.json, mcp-payload.json to /out for the diff
  out/                      # captured payloads (regenerated during the demo)
  recording/demo-run.mp4    # (or asciinema .cast) — full dry-run capture = your fallback
  recording/agent-run.mp4   # real agent (gpt-4o-mini) doing the task via each interface — PLAYED on slide 12
  scripts/agent-run.mjs     # drives a real agent 3× (once per interface) to PRODUCE agent-run.mp4
  vendor/axi-sdk-js/        # committed build of axi-sdk-js (see its README for provenance)
  package.json              # deps: axi-sdk-js (file:./vendor/axi-sdk-js), @toon-format/toon,
                            #       gpt-tokenizer, @modelcontextprotocol/sdk
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
- **MCP (`src/mcp-server.ts`)** — exposes a realistic **~21-tool** CI surface so the schema tax is visible: `list_runs`, `get_run`, `list_jobs`, `get_logs`, `search_logs`, `get_job_logs`, `get_run_annotations`, `list_artifacts`, `list_workflows`, `trigger_workflow`, `list_branches`, `get_pipeline_metrics`, `list_deployments`, … Each with a full JSON-schema `inputSchema` + descriptions. Crucially, `list_runs` returns lightweight **summaries** (no logs) — as real list endpoints do — so answering "why did it fail" requires drilling in per run. For the tokenizer diff you don't need a live agent — you need the **payload the model would read**: the concatenated tool schemas + one tool result. `scripts/capture.mjs` serializes that to `out/mcp-payload.json`.
- **AXI (`src/axi.ts`)** — the **finished** command, built ahead of time. You only *run* it on stage. Two subcommands: `ci list [--status]` (the compact list) and `ci failures` (the multi-step task — each failing run's failing job + a flaky-vs-regression verdict — answered in ONE compact call). The four transformations that produced the list output are shown as code snippets on **slide 8b** (before/after), so the audience sees the "how" without you typing.

### `src/axi.ts` — the finished command (built ahead; shown as snippets on slide 8b)
This is what ships and what you run on stage. The commented principle labels map 1:1 to the slide-8b snippets:
```ts
import { renderOutput } from "axi-sdk-js";          // TOON encode under the hood
import { loadRuns, filterByStatus, summarize, truncate } from "./core.js";

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
- **What it shows:** a real agent (gpt-4o and gpt-4o-mini) completing the **multi-step task** — _"for each failing run, which job failed, and is it flaky/infra or a real regression?"_ — **three times per model**, once per interface (CLI, MCP, AXI), with **turns · token buckets · cost** captured for each. `scripts/agent-run.mjs` runs the three and prints the table; screen-capture it (or capture the terminal + overlay the numbers in post).
- **How it runs (the fair harness):** the script uses a **minimal shared system prompt** and gives each condition **only its own tools** (one thin run-command tool for CLI/AXI; the full 21-tool catalog for MCP) — so the tokens measured belong to the interface, not to a harness baseline. It's **multi-provider** (`--provider`, else auto-detected):
  - `anthropic-cli` — uses your **Claude Code subscription, no API key** (`claude` CLI with a minimal `--system-prompt` + `--exclude-dynamic-system-prompt-sections` so it's fair). Cost is the CLI's estimate. **This is the default when no API key is set.**
  - `openai` — raw `fetch` to Chat Completions; needs `OPENAI_API_KEY`; default `gpt-4o-mini`. Cheap dev testing (and the tokenizer diff is exact for it).
  - `anthropic-api` — raw `fetch` to the Messages API; needs `ANTHROPIC_API_KEY` (pay-as-you-go); exact, order-independent cost, no prompt caching.

  Run `pnpm build && node scripts/agent-run.mjs` (add `--provider …` and/or `--repeats 3`). No credentials → prints a TODO table and exits, spending nothing. _(A normal app would use each provider's official SDK; this repo stays dependency-free/offline, so the API providers use `fetch`.)_
- **Same task, same model, same app** — only the interface changes. That's the whole point: the interface is the independent variable.
- **Why recorded, not live:** deterministic numbers, fully offline on stage, no API/network/latency risk. State this out loud on slide 12 so it's not mistaken for sleight of hand.
- **Capture the numbers** into slide 12's summary table (turns / tokens / cost per interface) so the point survives even if the video won't play.

---

## 1. Prerequisites checklist (verify morning-of)

- [ ] Node ≥ 20 and `pnpm` installed (via `corepack enable pnpm`); `pnpm install` already run in `ci-demo/` (no install lag on stage).
- [ ] `pnpm build` run so `dist/` exists. `axi-sdk-js` is **vendored** (`ci-demo/vendor/axi-sdk-js`), so there's no separate SDK build/link step — `pnpm install` links it via `file:`.
- [ ] Dependencies present: `@toon-format/toon`, `gpt-tokenizer`, `@modelcontextprotocol/sdk`.
- [ ] All three interfaces run clean: `ci-cli list --status failed`, `ci-mcp` capture, and `ci list --status failed`.
- [ ] `scripts/capture.mjs` and `scripts/token-diff.mjs` run clean and produce numbers.
- [ ] **Recording of the full run captured** (`recording/demo-run.mp4` or asciinema) and it plays without network — this is your fallback.
- [ ] **Real-agent run recorded** (`recording/agent-run.mp4`): `node scripts/agent-run.mjs --provider openai` — a genuine agent completes the multi-step task via CLI, MCP, and AXI, with **turns · tokens · cost** visible. **Slide 12 shows both gpt-4o and gpt-4o-mini** (`--provider openai --model gpt-4o` and `--model gpt-4o-mini`, one recorded run each); the harness also runs on your Claude Code subscription (the default, no key) or `anthropic-api`. Plays on **slide 12**, always from the recording (no live agent on stage).
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
**Audience sees:** the tool definitions — the full ~21-tool catalog, each with a JSON schema, descriptions, parameter types — followed by the result.

**Say:** "MCP gives the agent structure and discoverability, which is genuinely useful. But *this whole menu* gets loaded into context — and it's charged every turn. Twenty-one tools here, and real servers ship even more. This is the schema tax."

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
**Audience sees** (the real numbers from the dry run, on the seeded data):
```
Payload tokens for "list failing runs" (gpt-tokenizer, approx):
  MCP  (21 tool schemas + result)  3,897   (baseline)
  CLI  (verbose JSON) ...........    264   -93% vs MCP
  AXI  (TOON, 4 fields, trunc) ..    236   -94% vs MCP,  -11% vs CLI
```
**Say the honest line:** "This is the *per-call payload* difference, measured live with an approximate tokenizer — so read the *direction and magnitude*, not the third digit. But an agent never calls a tool just once…" → advance to slide 12.

> Note MCP dwarfs the other two — roughly 15× the CLI's payload — because 21 tool schemas ride in context every turn. A realistic CI surface, not padding; a bigger server pushes MCP higher, a leaner one narrows it. CLI and AXI land close on this single call (both return a summary; AXI's −11% edge is TOON plus a free summary line, log preview, and next hint) — the AXI win *compounds* across the task, which is the next slide. Say that out loud if a lead asks about the spread.

### Step 5 — Play the recorded real-agent run (~2.5 min) [slide 12, from video]
Leave the terminal; this beat is **played from the deck**, not run live.
**Do:** play `recording/agent-run.mp4`. It shows a real agent completing the **multi-step task** (classify each failing run) via CLI, MCP, then AXI, with **turns · tokens · cost** on screen.
**Say:** "Same task, same app — only the interface changes, and the harness is fair (shared minimal prompt, each interface's own tools, no caching). This is recorded so the numbers are stable, but it's a genuine agent. Watch what compounds: MCP's list returns summaries, so the agent drills in per run — and every one of those turns re-reads all 21 schemas. AXI answers in one compact `ci failures` call. And run it on a weaker model — gpt-4o-mini — and the blunt CLI makes it thrash for ten turns; AXI's affordances keep the small model on rails. The one-payload gap from a second ago multiplies across the whole task."
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

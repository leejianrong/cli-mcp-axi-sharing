# Discovery Notes — "CLI vs MCP vs AXI" Talk + Live Demo

_Captured 2026-07-14. Source of truth for the two deliverables (`presentation_outline.md`, `live_demo_script.md`)._

## The talk

| Dimension | Decision |
|---|---|
| **Topic** | CLI vs MCP vs AXI — a **neutral survey** of the three ways to give an AI agent tools. |
| **Core takeaway** | The real variable isn't the protocol (CLI vs MCP) — it's **design discipline**. A principled, agent-native interface wins on tokens, cost, reliability, and speed. Audience leaves able to decide what fits their situation. |
| **Audience** | Mixed technical (devs + leads/PMs). Concepts and demo must land; keep code light and explain jargon. |
| **Duration** | ~20–30 min including the live demo (+ Q&A buffer). |
| **Slide tool** | Tool-agnostic outline for now (Markdown outline + speaker notes + timings). Decide rendering later. |
| **Venue** | Internal team / company talk. Forgiving audience, decent network — but demo still built to run **fully offline** for safety. |

## The live demo

**Arc:** one lightweight, offline app → exposed three ways (CLI, MCP, AXI) → the AXI layer is built **live on stage** → prove the win with a live tokenizer diff.

| Element | Decision |
|---|---|
| **App domain** | **CI/CD pipeline runs** (`ci` tool). Verbose JSON, obvious aggregates (pass/fail counts), long logs to truncate, and something agents genuinely query. |
| **Prepped beforehand** | **All three interfaces** — the app + **CLI** + **MCP server** (~6 tools so schema bloat is visible) + the finished **AXI** layer. Nothing is built on stage. |
| **~~Built live~~ → No live coding** | _Decision revised: no live coding._ The **4 marquee principles** — (1) token-efficient TOON output, (2) minimal default schema, (4) pre-computed aggregates, (3) content truncation — are now shown as **before/after code snippets on the slides**, and their effect is visible when the finished AXI command runs. |
| **Live demo = a scripted RUN** | On stage you *run* the three prepped interfaces on the same task and show the output shrink, then run the tokenizer diff. Try it live; **a pre-recorded screen capture of the full run is an acceptable fallback.** |
| **Fallback** | Primary: run live. Backup: play the pre-recorded run (asciinema/screen capture) + saved `token-diff` output. Never debug on stage. |
| **Proving the win — two layers** | (a) **Pre-recorded real-agent run** — one genuine agent (Claude) doing the task through each interface, with **turns + tokens + cost** visible. Always played from the recording (deterministic, no live-agent risk). Then (b) **live tokenizer diff** of the three payloads for the deterministic on-stage "wow." Honest framing (see below); the published benchmark shows it holds at scale. |
| **Measured task** | "List the pipeline runs that are failing." Hits verbose output + aggregates + truncation at once. |

## Locked defaults

1. **Toy app in TypeScript/Node** — so the finished AXI layer (and the code snippets on the slides) use `axi-sdk-js` directly (authentic, real APIs).
2. **Live tokenizer = `gpt-tokenizer`** (pure-JS, offline), clearly labeled as a **close approximation** of Claude's tokenizer — fine because we show *relative* differences.
3. **Measured task = "list the pipeline runs that are failing."**

## Honesty framing (important — internal audience will scrutinize)

- The repo's **headline benchmark numbers** come from *real agent runs* — `usage.input_tokens` reported by the Agent SDK across hundreds of runs (`bench-github/src/usage.ts`, `reporter.ts`).
- Our **on-stage tokenizer diff** measures something narrower: the token size of the **per-call payloads** (CLI text vs. MCP schema+result vs. AXI output). It is a proxy, not a full agent-loop measurement.
- The **pre-recorded real-agent run** is the bridge between the two: a genuine agent on *our* app, showing turns/tokens/cost — proof the per-call payload difference compounds into a real end-to-end gap, before we cite the large-scale published benchmark.
- Script says exactly this: _"Live, I'll show the per-call payload difference. Here's a recorded agent run where that compounds across turns on our own app. And here's the published benchmark showing it holds across hundreds of runs."_

## Grounded facts from the repo (`/home/jian/projects/axi-demo/axi`)

- TOON output is real and offline: `packages/axi-sdk-js/src/output.ts` → `renderOutput()` calls `encode()` from `@toon-format/toon` (dependency already present).
- Usable SDK exports: `renderOutput`, `renderError`, `errorOutput`, `mergeOutput`, `homeHeaderOutput`, plus the CLI helpers in `cli.ts`.
- Principles are defined once in `principles.yaml`; full spec in `.agents/skills/axi/SKILL.md`.
- Published results: `bench-github/published-results/STUDY.md` and the README tables (browser + github benchmarks).

## Published numbers to cite (do not re-run live)

**GitHub benchmark (85 runs/condition, Claude Sonnet, `openclaw/openclaw`):**

| Condition | Success | Cost/task | Duration | Turns | Avg input tokens |
|---|---|---|---|---|---|
| **AXI** | **100%** | **$0.050** | **15.7s** | **3** | **46K** |
| CLI | 86% | $0.054 | 17.4s | 3 | 47K |
| MCP (eager) | 87% | $0.148 | 34.2s | 6 | 175K |
| MCP (ToolSearch) | 82% | $0.147 | 41.1s | 8 | 153K |
| Code-mode | 84% | $0.101 | 43.4s | 7 | — |

**Browser benchmark (490 runs, Claude Sonnet 4.6):** `chrome-devtools-axi` 100% success, $0.074/task, 21.5s, 4.5 turns — vs `chrome-devtools-mcp` variants at higher cost/turns.

## Sources
- https://axi.md/
- https://github.com/kunchenguid/axi (+ `bench-github/published-results/STUDY.md`)
- https://github.com/kunchenguid/gh-axi, https://github.com/kunchenguid/chrome-devtools-axi

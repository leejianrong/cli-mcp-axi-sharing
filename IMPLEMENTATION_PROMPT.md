# Paste this into a new chat

---

I'm building an internal ~25–30 min talk called **"CLI vs MCP vs AXI"** plus a live demo. The planning is done — three spec docs already exist. Your job is to **implement everything the docs describe** and then update the docs with the real results.

## Read these first (they are the source of truth — follow them, don't reinvent)
- `/home/jian/projects/axi-demo/cli-mcp-axi-sharing/docs/discovery_notes.md` — the aligned plan, locked defaults, honesty framing.
- `/home/jian/projects/axi-demo/cli-mcp-axi-sharing/docs/presentation_outline.md` — 16-slide deck (note **Slide 8b** code snippets, **Slide 10** demo run, **Slide 11** results table).
- `/home/jian/projects/axi-demo/cli-mcp-axi-sharing/docs/live_demo_script.md` — the demo runbook. **Section 0 fully specifies the `ci-demo/` workspace** — build exactly that.
- The real AXI project is cloned at `/home/jian/projects/axi-demo/axi`. Skim its `README.md`, `principles.yaml`, and `packages/axi-sdk-js/src/{output.ts,cli.ts}` so you use the genuine SDK APIs (esp. `renderOutput`, which TOON-encodes via `@toon-format/toon`).

## Locked defaults (from discovery_notes.md — do not change without asking)
- **App domain:** a local, offline **CI/CD pipeline-runs** service (`ci`). Seed ~8 runs (3 failed / 2 running / 3 success), verbose fields, long log tails.
- **Three interfaces, all prebuilt** (no live coding on stage): **CLI** (verbose JSON), **MCP server** (~6 tools with full schemas so the schema tax shows), **AXI** (the finished command).
- **AXI showcases 4 principles:** P1 token-efficient TOON output (via `axi-sdk-js` `renderOutput`), P2 minimal 4-field schema, P4 pre-computed aggregate summary line, P3 log truncation with a `--full` escape hatch.
- **Stack:** TypeScript / Node ≥ 20, `pnpm`. Depend on the local `axi-sdk-js` (build it: `pnpm --filter axi-sdk-js build`, then link or `file:` reference it — it's not on npm).
- **Tokenizer for the diff:** `gpt-tokenizer` (pure-JS, offline). Label its output as an *approximation* of Claude's tokenizer — we show relative differences only.
- **Measured task everywhere:** _"list the pipeline runs that are failing"_ (`--status failed`).
- Everything must run **fully offline** — no network calls in any path.

## Build in this order (check each off as you go)

**Phase 0 — Orient.** Read the four sources above. Confirm the `ci-demo/` layout in live_demo_script.md §0, then briefly tell me your plan before writing code.

**Phase 1 — Scaffold.** Create `/home/jian/projects/axi-demo/cli-mcp-axi-sharing/ci-demo/` with `package.json`, `tsconfig.json`, deps (`axi-sdk-js` local, `@toon-format/toon`, `gpt-tokenizer`, `@modelcontextprotocol/sdk`). Build/link `axi-sdk-js` first and confirm the import resolves.

**Phase 2 — Data + shared core.** `data/runs.json` (~8 seeded runs per the shape in §0) and `src/core.ts` exporting `loadRuns()`, `filterByStatus()`, `summarize()` (→ `"8 runs · 3 failed · 2 running · 3 passed"`), and `truncate()`. All three interfaces import this.

**Phase 3 — CLI.** `src/cli.ts` → `ci-cli list --status failed` prints full pretty JSON (deliberately verbose; no summary, no next-step hint). Verify it runs.

**Phase 4 — MCP server.** `src/mcp-server.ts` exposing ~6 tools (`list_runs`, `get_run`, `list_jobs`, `get_logs`, `retry_run`, `cancel_run`) with full JSON-schema `inputSchema` + descriptions. Verify it starts.

**Phase 5 — AXI command.** `src/axi.ts` → `ci list --status failed`, the finished version implementing P1–P4 exactly as in live_demo_script.md §0 (use `renderOutput`; support `--full`; definitive empty state). Verify both `--status failed` and `--full` outputs look right.

**Phase 6 — Measurement tooling.** `scripts/capture.mjs` (writes `out/cli-output.json` and `out/mcp-payload.json` = the 6 tool schemas + one result) and `scripts/token-diff.mjs` (uses `gpt-tokenizer` to count tokens of the CLI / MCP / AXI payloads for the task and prints a comparison table with % savings). Verify it produces numbers.

**Phase 6b — Real-agent runner (for the recording).** `scripts/agent-run.mjs` drives a genuine agent (Claude — Agent SDK or Claude Code) to complete "list the failing runs" **three times, once per interface** (CLI, MCP, AXI), capturing **turns · total tokens · cost** for each. Print a clean summary table. This produces the numbers + on-screen content for `recording/agent-run.mp4`, which is **played on slide 12** (never run live on stage). See live_demo_script.md §0 "The real-agent recording" and Step 5. Requires API access — this is the one part that isn't offline, but it runs *before* the talk, not on stage.

**Phase 7 — Demo runner.** A `demo.sh` that advances through the four run-steps on keypress (space bar), plus the shell aliases from §4. This is what you drive on stage.

**Phase 8 — Dry run + real numbers.** Run the full sequence end to end. Capture the **actual token counts** from `token-diff.mjs` AND the **agent-run metrics** (turns/tokens/cost per interface) from `scripts/agent-run.mjs`. If anything in the docs' assumptions turns out wrong, note it. (If API access isn't available in your environment, still wire `agent-run.mjs` fully and leave clearly-marked `TODO` placeholders for the numbers so I can run it myself.)

**Phase 9 — Sync the docs with reality.** Update `presentation_outline.md` **Slide 11** and `live_demo_script.md` **Step 4** with the real token numbers; fill **Slide 12**'s summary table with the agent-run metrics (turns/tokens/cost). Update **Slide 8b** so its before/after snippets match the shipped `src/axi.ts` line-for-line.

**Phase 10 — (Optional, ask me first) Render the deck.** If I say yes, turn `presentation_outline.md` into actual slides (recommend Marp or Slidev, Markdown-based) with the code snippets and results baked in. Leave a placeholder for the recorded-demo fallback video.

**Phase 11 — Verify & hand back.** Do a clean end-to-end run from scratch (fresh `pnpm install`, build, run `demo.sh`) to prove it works offline. Give me: the final token numbers, a one-paragraph "how to run the demo" note, and a checklist of what's left for me (record the dry-run video, fill any slide media).

## Working rules
- Keep the app **tiny and readable** — it's a teaching prop, not production. Prioritize output that looks dramatically different across the three interfaces.
- Match the code snippets to the docs (or update the docs) so the deck and the running code never disagree.
- Don't touch anything inside `/home/jian/projects/axi-demo/axi` except to build the SDK. All new code goes under `cli-mcp-axi-sharing/ci-demo/`.
- Verify each phase actually runs before moving on. Show me the real output at Phase 8 and Phase 11.

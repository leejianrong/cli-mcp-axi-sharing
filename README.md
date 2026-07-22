# Apps Agents Love: CLI vs MCP vs AXI

An internal ~30-minute talk and live demo about the interface you put between an AI
agent and your system. That choice, not the protocol behind it, quietly decides the
agent's token bill, its speed, and how often it gets the answer right. One tiny
offline CI/CD app is exposed three ways: a verbose CLI, an MCP server, and a
principled AXI command. We run the same task through each, watch the per-call payload
shrink, and then watch the gap compound across a whole task.

- **Slides:** <https://leejianrong.github.io/cli-mcp-axi-sharing/>
- **Interactive demo:** <https://leejianrong.github.io/cli-mcp-axi-sharing/viz/>
- **Read-off script (for presenting):** [`docs/presentation_script.md`](docs/presentation_script.md).
- **Planning docs** (the thinking behind the talk, archived): [`docs/planning/`](docs/planning/) has the
  discovery notes, slide outline, and demo runbook.

## Where the numbers come from

The talk shows three kinds of numbers, and they are not the same kind of measurement.
Keeping them straight is the point of this section.

**Real measured runs (the slides and the demo).** `scripts/agent-run.mjs` drives a
genuine agent through the task once per interface and records every turn with the real
`input`/`output` token counts the model API reports, plus turns, tool calls, and cost.
Those recordings live in [`ci-demo/recordings/`](ci-demo/recordings/) and are what the
slides and the interactive demo display. Two are committed: `openai-gpt-4o.json` (a
capable model) and `openai-gpt-4o-mini.json` (a weaker one). For gpt-4o:

| Interface | First call (input tok) | Whole task (input tok) |
| --- | --- | --- |
| MCP (21 tool schemas) | 2,188 | 10,855 |
| CLI (1 tool) | 184 | 4,063 |
| AXI (1 tool) | 181 | 2,217 |

On the first call MCP already carries all 21 tool schemas, so it reads 2,188 tokens
against 184 for CLI and 181 for AXI, which each expose a single tool. Per call, CLI
and AXI are level; the gap is MCP's schema tax. Across the whole task the leaner
outputs and fewer drill-ins compound, and AXI ends up well below both.

**A gpt-tokenizer approximation (a dev check, not the slides).** `make token-diff`
(via `scripts/token-diff.mjs`) counts the per-call payloads offline with
`gpt-tokenizer`. It is a rough stand-in, not the model's real tokenizer, and the
comparison is loose on purpose: the MCP figure includes the tool schemas while the
CLI and AXI figures are just command output. Treat it as a quick sanity check you can
run with no API key. It reports different numbers (MCP 3,897 / CLI 264 / AXI 236), and
that is fine, because it is a different measurement. The slide numbers come from the
real runs above.

**An external published benchmark (the "holds at scale" slide).** That slide cites the
AXI author's own benchmark (85 runs per condition, Claude Sonnet, `openclaw/openclaw`),
transcribed from [`docs/planning/discovery_notes.md`](docs/planning/discovery_notes.md). We did not
measure those, and the talk says so out loud.

## Quick start

Everything runs from a `make` target at the repo root. It is all offline (local JSON
data, a local tokenizer, no network in any on-stage path); the one exception is
`make agent-run`, described below. You need Node ≥ 20 and pnpm (`corepack enable pnpm`).

```bash
make install   # frozen, offline install; links the vendored axi-sdk-js
make build
make test      # vitest, no infra
make viz       # serve the interactive demo at http://localhost:5173/viz/
make check     # what CI runs: build + test + token-diff smoke
make           # list every target
```

To run the three interfaces by hand on the same task:

```bash
cd ci-demo
node dist/cli.js list --status failed         # verbose JSON, the human baseline
node dist/axi.js list --status failed         # compact TOON, the AXI command
node dist/axi.js list --status failed --full  # the escape hatch: full logs
node dist/axi.js failures                      # the multi-step task, answered in one call
```

## The one online step

`make agent-run` is the only part that touches the network, and it runs before the
talk, never on stage. It drives a real agent through the multi-step task, _"for each
failing run, which job failed, and is it flaky/infra or a real regression?"_, once per
interface, and writes a recording to `ci-demo/recordings/`. With no credentials it
prints a TODO table and spends nothing.

The comparison is kept fair: a minimal shared system prompt, each interface gets only
its own tools (one run-command tool for CLI and AXI, the full 21-tool catalog for MCP),
and no prompt caching, so the tokens belong to the interface rather than to the
harness. Refresh the two committed recordings like this:

```bash
make agent-run ARGS="--provider openai --model gpt-4o --record"
make agent-run ARGS="--provider openai --model gpt-4o-mini --record"
```

Pick the provider with `--provider`, or let it auto-detect:

| `--provider` | Auth | Default model |
| --- | --- | --- |
| `anthropic-cli` _(default)_ | your Claude Code subscription, no key | `claude-sonnet-5` |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` |
| `anthropic-api` | `ANTHROPIC_API_KEY` | `claude-sonnet-5` |

For a key-based provider, copy [`ci-demo/.env.example`](ci-demo/.env.example) to
`ci-demo/.env` (gitignored) and add the key; `agent-run` loads it automatically.
Validate any recording with `make validate-recording REC=recordings/openai-gpt-4o.json`.

## Running it on stage

The interactive demo is the main event. Open it (or run `make viz`), press play, and
the recorded run replays through all three interfaces side by side, with per-lane
counters for turns, tool calls, and tokens, and a clear finish badge on each. Switch
the exhibit to gpt-4o-mini to show how a blunt interface makes a weaker model thrash.

Before that, `ci-demo/demo.sh` drives the live command steps on the space bar (the CLI
wall, the MCP schema tax, and the AXI output with `--full`); run `source aliases.sh`
first for the short commands. If anything hiccups, cut to the demo rather than
debugging on stage. The full runbook and fallback plan are in
[`docs/planning/live_demo_script.md`](docs/planning/live_demo_script.md).

## Layout

```text
Makefile               one task interface for everything below
ci-demo/
  data/runs.json       8 seeded pipeline runs (3 failed / 2 running / 3 success)
  src/core.ts          shared helpers: loadRuns, filterByStatus, summarize,
                       truncate, runSummary, failingJobs, classifyFailure
  src/cli.ts           ci-cli:  verbose JSON (the human baseline)
  src/mcp-server.ts    ci-mcp:  ~21 fully-schema'd tools (list_runs returns summaries)
  src/axi.ts           ci:      the AXI command - list (P1-P4), get, failures
  scripts/             capture, token-diff (approximation), agent-run, validate-recording
  recordings/          real agent runs (gpt-4o, gpt-4o-mini) for the demo + slides
  demo.sh, aliases.sh  the on-stage command driver
  vendor/axi-sdk-js/   committed build of the real SDK (see its README)
viz/                   the interactive demo (static, offline; served at /viz/)
slides/                the deck (index.html, served by Pages)
docs/                  the plan, outline, runbook, and script
```

See [`CLAUDE.md`](CLAUDE.md) for the full agent brief and conventions.

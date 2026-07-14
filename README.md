# Apps Agents Love: CLI vs MCP vs AXI

An internal ~30-minute talk and live demo about the interface you put between an AI
agent and your system — and why that choice, not the protocol, quietly decides the
agent's token bill, speed, and reliability. One tiny offline CI/CD app is exposed
three ways (a verbose **CLI**, an **MCP** server, and a principled **AXI** command),
and we watch the same task's payload shrink across them.

**Slides:** https://leejianrong.github.io/cli-mcp-axi-sharing/
**Talk plan:** [`docs/`](docs/) — [discovery notes](docs/discovery_notes.md), [slide outline](docs/presentation_outline.md), [demo runbook](docs/live_demo_script.md), [read-off script](docs/presentation_script.md).

## The measured result

The per-call payload for one task — _"list the pipeline runs that are failing"_ —
counted with `gpt-tokenizer` (an approximation of Claude's tokenizer, so read the
gaps, not the exact digits):

| Interface | Payload tokens | vs MCP |
|---|---|---|
| MCP (6 tool schemas + one result) | 2,655 | baseline |
| CLI (verbose JSON) | 1,358 | −49% |
| **AXI** (TOON, 4 fields, truncated) | **236** | **−91%** (−83% vs CLI) |

The CLI sits at about half of MCP here only because this server ships six tools; the
schema tax scales with tool count, so a thirty-tool server pushes MCP much higher
while AXI barely moves.

## Quick start

Everything lives in [`ci-demo/`](ci-demo/) and runs fully offline (local JSON data,
a local tokenizer — no network in any demo path). Node ≥ 20 and pnpm (via
`corepack enable pnpm`).

```bash
cd ci-demo
pnpm install
pnpm build
pnpm test           # fast, no infra

# the same task through each interface
node dist/cli.js list --status failed      # verbose JSON (the human baseline)
node dist/axi.js list --status failed      # compact TOON (the AXI command)
node dist/axi.js list --status failed --full   # the escape hatch

node scripts/token-diff.mjs                # the payload token comparison
```

## Running the demo on stage

From `ci-demo/`, `./demo.sh` drives the four live steps on the space bar — CLI wall,
MCP schema tax, AXI output (plus `--full`), then the token diff. `source aliases.sh`
first if you want the short commands (`ci`, `ci-cli`, `cap`, `t`). If anything
hiccups, cut to the recording rather than debugging; the full runbook and fallback
plan are in [`docs/live_demo_script.md`](docs/live_demo_script.md).

## The one online step

`scripts/agent-run.mjs` drives a genuine Claude agent through the task once per
interface, capturing turns, tokens, and cost for the slide-12 recording. It's the
only part that touches the network, and it runs **before** the talk, never on stage.
With no credentials it prints a TODO table instead of failing.

```bash
node scripts/agent-run.mjs        # needs `claude` logged in or ANTHROPIC_API_KEY
```

## Layout

```
ci-demo/
  data/runs.json        8 seeded pipeline runs (3 failed / 2 running / 3 success)
  src/core.ts           shared loadRuns · filterByStatus · summarize · truncate
  src/cli.ts            ci-cli  — verbose JSON
  src/mcp-server.ts     ci-mcp  — 6 fully-schema'd tools
  src/axi.ts            ci      — the finished AXI command (P1–P4)
  scripts/              capture · token-diff · agent-run
  demo.sh, aliases.sh   the on-stage driver
  vendor/axi-sdk-js/    committed build of the real SDK (see its README)
slides/                 the deck (index.html served by Pages)
docs/                   the plan, outline, runbook, and script
```

See [`CLAUDE.md`](CLAUDE.md) for the full agent brief and conventions.

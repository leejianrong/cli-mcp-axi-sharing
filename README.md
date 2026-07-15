# Apps Agents Love: CLI vs MCP vs AXI

An internal ~30-minute talk and live demo about the interface you put between an AI
agent and your system. That choice, not the protocol behind it, quietly decides the
agent's token bill, speed, and reliability. One tiny offline CI/CD app gets exposed
three ways: a verbose CLI, an MCP server, and a principled AXI command. We run the
same task through each and watch the payload shrink.

**Slides:** https://leejianrong.github.io/cli-mcp-axi-sharing/
**Talk plan:** [`docs/`](docs/): [discovery notes](docs/discovery_notes.md), [slide outline](docs/presentation_outline.md), [demo runbook](docs/live_demo_script.md), [read-off script](docs/presentation_script.md).

## The measured result

The per-call payload for one task, _"list the pipeline runs that are failing"_,
counted with `gpt-tokenizer`. That tokenizer approximates Claude's, so read the
gaps, not the exact digits:

| Interface | Payload tokens | vs MCP |
|---|---|---|
| MCP (21 tool schemas + one result) | 3,897 | baseline |
| CLI (verbose JSON) | 1,358 | −65% |
| **AXI** (TOON, 4 fields, truncated) | **236** | **−94%** (−83% vs CLI) |

The MCP payload is nearly 3× the CLI's verbose dump because this server exposes a
realistic ~21-tool CI surface (runs, jobs, logs, artifacts, workflows, deployments,
…), and every schema rides in context on _every_ turn. That gap widens with a bigger
server and narrows with a leaner one; AXI barely moves either way.

## Quick start

Everything lives in [`ci-demo/`](ci-demo/) and runs fully offline (local JSON data,
a local tokenizer, no network in any demo path). Node ≥ 20 and pnpm (via
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
node dist/axi.js failures                  # multi-step task, answered in one call

node scripts/token-diff.mjs                # the payload token comparison
```

## Running the demo on stage

From `ci-demo/`, `./demo.sh` drives the four live steps on the space bar: the CLI
wall, the MCP schema tax, AXI output (plus `--full`), then the token diff. Run
`source aliases.sh` first if you want the short commands (`ci`, `ci-cli`, `cap`,
`t`). If anything hiccups, cut to the recording rather than debugging. The full
runbook and fallback plan are in [`docs/live_demo_script.md`](docs/live_demo_script.md).

## The one online step

`scripts/agent-run.mjs` drives a genuine agent through a **multi-step** task —
_"for each failing run, which job failed, and is it flaky/infra or a real
regression?"_ — once per interface, capturing turns, tokens, and cost for the
slide-12 recording. It's the only part that touches the network, runs **before** the
talk (never on stage), and prints a TODO table if it finds no credentials.

The comparison is fair: a minimal shared system prompt, each interface gets only its
own tools (one run-command tool for CLI/AXI; the full 21-tool catalog for MCP), and —
for the API providers — no prompt caching, so tokens are attributable to the
interface. It's **multi-provider** (`--provider`, else auto-detected):

```bash
pnpm agent-run                                   # default: your Claude Code
                                                 # subscription (no key), auto-loads .env
pnpm agent-run -- --provider openai --repeats 3  # gpt-4o-mini (cheap dev testing)
pnpm agent-run -- --provider anthropic-api       # pay-as-you-go Messages API
```

| `--provider` | Auth | Default model |
|---|---|---|
| `anthropic-cli` _(default)_ | your Claude Code subscription — no key | `claude-sonnet-5` |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` |
| `anthropic-api` | `ANTHROPIC_API_KEY` | `claude-sonnet-5` |

For a key-based provider, copy [`ci-demo/.env.example`](ci-demo/.env.example) to
`ci-demo/.env` (gitignored) and fill in the key — `pnpm agent-run` loads it
automatically. For the slide-12 recording, prefer `anthropic-cli` (Claude) so the
numbers match the talk's benchmark; `gpt-4o-mini` is for cheap iteration.

## Layout

```
ci-demo/
  data/runs.json        8 seeded pipeline runs (3 failed / 2 running / 3 success)
  src/core.ts           shared helpers: loadRuns · filterByStatus · summarize ·
                        truncate · runSummary · failingJobs · classifyFailure
  src/cli.ts            ci-cli  — verbose JSON
  src/mcp-server.ts     ci-mcp  — ~21 fully-schema'd tools (list_runs → summaries)
  src/axi.ts            ci      — the AXI command: `list` (P1–P4) + `failures`
  scripts/              capture · token-diff · agent-run (multi-provider)
  demo.sh, aliases.sh   the on-stage driver
  .env.example          keys for agent-run's key-based providers (copy to .env)
  vendor/axi-sdk-js/    committed build of the real SDK (see its README)
slides/                 the deck (index.html served by Pages)
docs/                   the plan, outline, runbook, and script
```

See [`CLAUDE.md`](CLAUDE.md) for the full agent brief and conventions.

# CLAUDE.md — agent brief for the "CLI vs MCP vs AXI" talk + demo

This repo builds an internal ~25–30 min talk and a live demo. The teaching prop
is one tiny **offline CI/CD pipeline-runs** app exposed three ways — a verbose
**CLI**, an **MCP server**, and a principled **AXI** command — so an audience can
watch the per-call payload shrink across the three, then see it compound in a
recorded real-agent run. Everything runs **fully offline**; there are no network
calls in any demo path.

Trust the code over any prose. If a command below disagrees with what you see,
the running code wins — fix the doc.

## Docs map

The live presentation artifact is `docs/presentation_script.md` (the read-off script),
and the deck itself is `slides/` (deployed to GitHub Pages). The original planning docs
are archived under `docs/planning/` for background — the repo is built, so trust the code
and the slides over these:

- `docs/planning/discovery_notes.md` — the aligned plan, locked defaults, honesty framing.
- `docs/planning/presentation_outline.md` — the slide-by-slide outline.
- `docs/planning/live_demo_script.md` — the demo runbook. **§0 specifies `ci-demo/`.**
- `IMPLEMENTATION_PROMPT.md` — the phased build order the initial build followed.

The real AXI project is cloned **outside this repo** at
`/home/jian/projects/axi-demo/axi` (its SDK is vendored in — see below). Skim its
`README.md`, `principles.yaml`, and `packages/axi-sdk-js/src/output.ts` for the
genuine APIs, but don't depend on that path from code.

## Build status (honest, as of Wave 0)

Done and verified:

- `ci-demo/` scaffold: `package.json`, `tsconfig.json` (NodeNext, strict), pnpm.
- `ci-demo/data/runs.json` — 8 seeded runs (3 failed / 2 running / 3 success).
- `ci-demo/src/core.ts` — the shared domain core, with a passing vitest suite
  (7 tests). Now also exports drill-down helpers: `runSummary`, `jobRollup`,
  `failingJobs`, `classifyFailure` (used by the multi-step task).
- All three interfaces: `src/cli.ts` (verbose JSON), `src/mcp-server.ts`
  (**~21 realistic CI tools**; `list_runs` returns summaries; exports `callTool`),
  `src/axi.ts` (`ci list` + a one-call `ci failures` affordance).
- Measurement: `scripts/capture.mjs`, `scripts/token-diff.mjs`, and the **fair,
  multi-provider** `scripts/agent-run.mjs` (minimal shared prompt, per-interface
  tools, token buckets, `--repeats`). Providers via `--provider` / auto-detect:
  `anthropic-cli` (Claude Code subscription, no key — default), `openai`
  (`OPENAI_API_KEY`, gpt-4o-mini), `anthropic-api` (`ANTHROPIC_API_KEY`). Keys
  go in a gitignored `.env` (see `.env.example`), auto-loaded by `pnpm agent-run`.
- Vendored `axi-sdk-js` (see below); `import { renderOutput } from "axi-sdk-js"`
  resolves and TOON-encodes.
- `.github/workflows/ci.yml` — build + test on push/PR.

Not built yet:

- `demo.sh`, the slides *site* (only the Markdown deck/outline + spoken script
  exist under `docs/`), the two recordings under `recording/`.
- The slide-12 agent-run numbers — run `agent-run.mjs` with `ANTHROPIC_API_KEY`
  to fill them in (needs API access this build env lacks).

## Commands

Everything runs from `ci-demo/`. Node ≥ 20 (24 in use); pnpm 11 via corepack
(`corepack enable pnpm`).

```bash
cd ci-demo
pnpm install            # frozen, offline; links the vendored SDK
pnpm build              # tsc → dist/
pnpm test               # vitest (fast, no infra)

pnpm cli  -- list --status failed   # verbose JSON dump
pnpm mcp                            # stdio MCP server (~21 tools)
pnpm axi  -- list --status failed   # compact TOON list
node dist/axi.js failures           # multi-step task, one compact call
node dist/axi.js list --status failed --full
node scripts/token-diff.mjs         # offline per-call payload diff

# real-agent run (slide 12). Defaults to your Claude Code subscription (no key).
pnpm agent-run                              # auto-loads .env, auto-detects provider
pnpm agent-run -- --provider openai --repeats 3   # gpt-4o-mini via OPENAI_API_KEY (.env)
cp .env.example .env                        # then add OPENAI_API_KEY for the openai path
```

## The shared core contract — do NOT change these signatures

All three interfaces import from `src/core.ts`. It is deliberately
interface-agnostic: no printing, no TOON, no schemas live there. Build the
interfaces on top of it; if you think the core needs a change, stop and raise it
with the orchestrator rather than editing it under a parallel task.

```ts
loadRuns(): Run[]                               // reads data/runs.json, offline
filterByStatus(runs: Run[], status: string): Run[]
summarize(runs: Run[]): string                  // "8 runs · 3 failed · 2 running · 3 passed"
truncate(text: string, max: number): string     // "<max chars>…(N chars, use --full)"
// drill-down helpers (added for the multi-step task — additive, safe to use):
runSummary(run: Run): RunSummary                // list-endpoint shape (no logs/jobs[])
jobRollup(run: Run): string                     // "3 jobs · 2 ok · 1 failed"
failingJobs(run: Run): string[]                 // names of jobs with status "failed"
classifyFailure(run: Run): FailureVerdict       // { classification, evidence } from logs
```

Types exported: `Run`, `Job`, `Commit`, `RunStatus`, `JobStatus`, `RunSummary`,
`FailureVerdict`, `FailureClass`. A `Run` has `id, status, branch,
commit{sha,message,author}, trigger, duration_seconds, created_at, jobs[], logs`.

Two measured tasks: the **tokenizer diff** uses the single call "list failing
runs" (`--status failed` → `run_8f2a, run_3d71, run_b90c`); the **agent run**
uses the multi-step "classify each failing run" task. For a fair comparison every
interface takes the same **list + get-per-run** path (CLI `list`→`get`, MCP
`list_runs`→`get_run`/`get_logs`, AXI `ci list`→`ci get`); the one-call
`ci failures` is showcased separately as the AXI affordance payoff, not the
measured harness path.

## What each interface must be

- **CLI (`src/cli.ts`, bin `ci-cli`)** — `list --status failed` prints
  `JSON.stringify(..., null, 2)` of a **summary projection** (same list-endpoint
  shape as MCP/AXI — no inline logs, jobs as a rollup string), so classifying a
  failure requires drilling in via `ci-cli get <id>`. Deliberately verbose *in
  format* (pretty JSON, no summary line, no next-step hint) — the human-shaped
  baseline. Handles errors honestly: `--help` to stdout; unknown command / bad id
  / stray args → message to stderr + exit 1 + a "run --help" pointer (no silent
  fallback dump).
- **MCP (`src/mcp-server.ts`, bin `ci-mcp`)** — a stdio `@modelcontextprotocol/sdk`
  server exposing a realistic **~21-tool** CI surface (runs, jobs, logs, search,
  annotations, artifacts, workflows, branches, metrics, deployments, …), each
  with a full JSON-schema `inputSchema`, so the schema tax is visible.
  `list_runs` returns lightweight **summaries** (no logs) — real list-endpoint
  behavior — so classifying a failure requires drilling in (extra turns).
  Exports `callTool(name, args)` so `agent-run.mjs` can dispatch in-process.
- **AXI (`src/axi.ts`, bin `ci`)** — the finished command. `ci --help` lists the
  subcommands:
  - `ci list [--status] [--full]` — implements four principles exactly as
    `docs/planning/live_demo_script.md` §0 shows: P1 TOON via `renderOutput`, P2 minimal
    4-field schema, P4 a pre-computed `summary` line, P3 `truncate` + `--full`.
    Plus a definitive empty state and a `next` hint. Keep it line-for-line
    consistent with the slide-8b snippets — if they drift, fix one.
  - `ci get <id> [--full]` — the drill-down for one run (the fair counterpart to
    `ci-cli get` / MCP's `get_run`), so the list+get path is consistent across all
    three interfaces.
  - `ci failures` — answers the multi-step task in ONE compact call: each failing
    run's failing job(s) + a flaky-vs-regression verdict (P4 taken to its end).
    This is the AXI *affordance payoff* beat, separate from the fair list+get path.

## Conventions

- **Offline always.** Data is local JSON; the tokenizer (`gpt-tokenizer`) is local.
  No `fetch`, no network in any demo path. The one exception is
  `scripts/agent-run.mjs`, which calls a real agent — it runs *before* the talk,
  never on stage, and is clearly fenced off.
- **ES modules, NodeNext.** Use explicit `.js` extensions in relative imports
  (e.g. `import { loadRuns } from "./core.js"`), even from `.ts` files.
- **Keep it tiny and readable.** This is a teaching prop, not production. Favor
  output that looks dramatically different across the three interfaces over
  cleverness. No frameworks; hand-rolled flag parsing is fine.
- **Test the seams that matter.** `core.ts` has a fast vitest suite. Add a small
  test when you add shared logic; don't chase coverage on throwaway glue.
- **Prose, docs, and slide copy** follow the `natural-writing` skill; the slides
  artifact follows `frontend-design`. Engineering practice follows `dev-playbook`.

## Git / CI / deploy

- Public GitHub repo, `main` is the trunk. **CI (`.github/workflows/ci.yml`) runs
  build + test on every push and PR**, frozen installs, cached, cancel-in-progress.
- **Parallel agents don't commit or push.** Each writes its own disjoint file(s)
  and verifies them locally (`pnpm build`, run the interface). The orchestrator
  reviews and lands the work so `main` stays reviewable — this is the
  dev-playbook "parallelize implementation, serialize the landing" rule.
- The slides site will deploy to **GitHub Pages** via a separate workflow once it
  exists (Phase 10a).

## The vendored SDK

`ci-demo/vendor/axi-sdk-js/` is a committed build of the real `axi-sdk-js`
(v0.1.8), depended on via `file:./vendor/axi-sdk-js`, so the repo is
self-contained and CI needs no sibling checkout. It carries one source change
from upstream — a re-export of `output.js` so `renderOutput` is public. Full
provenance is in that folder's `README.md`. Use the genuine API (`renderOutput`);
don't reach for `@toon-format/toon` directly.

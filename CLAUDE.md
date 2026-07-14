# CLAUDE.md — agent brief for the "CLI vs MCP vs AXI" talk + demo

This repo builds an internal ~25–30 min talk and a live demo. The teaching prop
is one tiny **offline CI/CD pipeline-runs** app exposed three ways — a verbose
**CLI**, an **MCP server**, and a principled **AXI** command — so an audience can
watch the per-call payload shrink across the three, then see it compound in a
recorded real-agent run. Everything runs **fully offline**; there are no network
calls in any demo path.

Trust the code over any prose. If a command below disagrees with what you see,
the running code wins — fix the doc.

## Source of truth (read before building)

The plan is already locked in three spec docs under `docs/`. Follow them; don't
reinvent the design.

- `docs/discovery_notes.md` — the aligned plan, locked defaults, honesty framing.
- `docs/presentation_outline.md` — the 17-slide deck (note **Slide 8b** code
  snippets, **Slide 11** results table, **Slide 12** agent-run table).
- `docs/live_demo_script.md` — the runbook. **§0 fully specifies `ci-demo/`.**
- `IMPLEMENTATION_PROMPT.md` — the phased build order this work follows.

The real AXI project is cloned **outside this repo** at
`/home/jian/projects/axi-demo/axi` (its SDK is vendored in — see below). Skim its
`README.md`, `principles.yaml`, and `packages/axi-sdk-js/src/output.ts` for the
genuine APIs, but don't depend on that path from code.

## Build status (honest, as of Wave 0)

Done and verified:

- `ci-demo/` scaffold: `package.json`, `tsconfig.json` (NodeNext, strict), pnpm.
- `ci-demo/data/runs.json` — 8 seeded runs (3 failed / 2 running / 3 success).
- `ci-demo/src/core.ts` — the shared domain core, with a passing vitest suite.
- Vendored `axi-sdk-js` (see below); `import { renderOutput } from "axi-sdk-js"`
  resolves and TOON-encodes.
- `.github/workflows/ci.yml` — build + test on push/PR.

Not built yet (the parallel work):

- `src/cli.ts`, `src/mcp-server.ts`, `src/axi.ts` (the three interfaces).
- `scripts/capture.mjs`, `scripts/token-diff.mjs`, `scripts/agent-run.mjs`.
- `demo.sh`, the slides site, the presentation script.

## Commands

Everything runs from `ci-demo/`. Node ≥ 20 (24 in use); pnpm 11 via corepack
(`corepack enable pnpm`).

```bash
cd ci-demo
pnpm install            # frozen, offline; links the vendored SDK
pnpm build              # tsc → dist/
pnpm test               # vitest (fast, no infra)

pnpm cli  -- list --status failed   # once src/cli.ts exists
pnpm mcp                            # once src/mcp-server.ts exists
pnpm axi  -- list --status failed   # once src/axi.ts exists
node dist/axi.js list --status failed --full
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
```

Types exported: `Run`, `Job`, `Commit`, `RunStatus`, `JobStatus`. A `Run` has
`id, status, branch, commit{sha,message,author}, trigger, duration_seconds,
created_at, jobs[], logs`.

The measured task everywhere is **"list the pipeline runs that are failing"**
(`--status failed`), which returns `run_8f2a, run_3d71, run_b90c`.

## What each interface must be

- **CLI (`src/cli.ts`, bin `ci-cli`)** — `list --status failed` prints
  `JSON.stringify(runs, null, 2)` of the full objects. Deliberately verbose: no
  summary line, no next-step hint. This is the human-shaped baseline.
- **MCP (`src/mcp-server.ts`, bin `ci-mcp`)** — a stdio `@modelcontextprotocol/sdk`
  server exposing ~6 tools (`list_runs`, `get_run`, `list_jobs`, `get_logs`,
  `retry_run`, `cancel_run`), each with a full JSON-schema `inputSchema` and
  description, so the schema tax is visible.
- **AXI (`src/axi.ts`, bin `ci`)** — the finished command. Implements four
  principles exactly as `docs/live_demo_script.md` §0 shows: P1 TOON output via
  `renderOutput`, P2 minimal 4-field schema (`id, status, branch, logs`), P4 a
  pre-computed `summary` line, P3 `truncate` with a `--full` escape hatch. Plus a
  definitive empty state and a `next` hint. Keep it line-for-line consistent with
  the slide-8b snippets in `docs/presentation_outline.md` — if they drift, fix one.

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

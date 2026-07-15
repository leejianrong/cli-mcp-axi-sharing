import { renderOutput } from "axi-sdk-js"; // TOON encode under the hood
import {
  loadRuns,
  filterByStatus,
  summarize,
  truncate,
  failingJobs,
  classifyFailure,
} from "./core.js";

/**
 * AXI interface (`ci`) — the finished, agent-native command and the payoff of
 * the demo. Same shared core as the CLI and MCP server; the only difference is
 * how the output is shaped and encoded. Four principles do the work here:
 *   P1 token-efficient output  — renderOutput() emits TOON, ~40% smaller than JSON
 *   P2 minimal default schema   — 4 fields per run (id, status, branch, logs)
 *   P4 pre-computed aggregate    — a summary line up front, no extra round-trip
 *   P3 content truncation        — logs clipped with a --full escape hatch
 * Plus a definitive empty state (P5) and a contextual next-step hint (P9).
 *
 * Two subcommands:
 *   ci list [--status <s>] [--full]   the compact run list (the baseline demo)
 *   ci failures                        the multi-step task, answered in ONE call:
 *                                      each failing run's failing job + a
 *                                      flaky-vs-regression classification. This
 *                                      is P4 taken to its conclusion — the
 *                                      interface does the agent's drill-down for
 *                                      it, so what costs MCP several turns costs
 *                                      AXI one.
 */

// Tiny hand-rolled flag parsing over process.argv — no framework needed.
function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

/** `ci list` — the compact run list. */
function runList(): void {
  const status = getFlag("--status"); // e.g. "failed"
  const full = hasFlag("--full");
  const runs = status ? filterByStatus(loadRuns(), status) : loadRuns();

  // Principle 5: definitive empty state — "0 runs", never silence.
  if (runs.length === 0) {
    console.log(renderOutput({ summary: "0 runs", runs: [] }));
    return;
  }

  const output = {
    // Principle 4: pre-computed aggregate up front — no extra round-trip.
    // Summarizes ALL runs (for context), not just the filtered subset.
    summary: summarize(loadRuns()), // "8 runs · 3 failed · 2 running · 3 passed"
    // Principle 2: minimal default schema — 4 fields, not 10+.
    runs: runs.map((r) => ({
      id: r.id,
      status: r.status,
      branch: r.branch,
      // Principle 3: content truncation with a --full escape hatch + size hint.
      logs: full ? r.logs : truncate(r.logs, 120), // "…(1500 chars, use --full)"
    })),
    // Principle 9 (freebie to mention): contextual next step.
    next: "ci get <id> --full   # for full logs",
  };
  console.log(renderOutput(output)); // Principle 1: TOON, ~40% smaller than JSON
}

/** `ci failures` — the multi-step task answered in a single compact call. */
function runFailures(): void {
  const full = hasFlag("--full");
  const failed = filterByStatus(loadRuns(), "failed");

  // Principle 5: definitive empty state.
  if (failed.length === 0) {
    console.log(renderOutput({ summary: summarize(loadRuns()), failures: [] }));
    return;
  }

  const output = {
    // Principle 4: the aggregate the agent would otherwise assemble by hand,
    // pre-computed — failing job(s) + a flaky-vs-regression verdict + evidence.
    summary: summarize(loadRuns()),
    failures: failed.map((r) => {
      const verdict = classifyFailure(r);
      return {
        id: r.id,
        branch: r.branch,
        failing_jobs: failingJobs(r).join(", ") || "—",
        classification: verdict.classification,
        // Principle 3: one line of evidence, truncated; --full for the log tail.
        evidence: full ? r.logs : truncate(verdict.evidence, 100),
      };
    }),
    next: "ci get <id> --full   # for the full log tail",
  };
  console.log(renderOutput(output)); // Principle 1: TOON
}

const command = process.argv[2];
switch (command) {
  case "failures":
    runFailures();
    break;
  case "list":
  default:
    runList();
    break;
}

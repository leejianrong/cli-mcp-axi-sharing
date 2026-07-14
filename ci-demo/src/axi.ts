import { renderOutput } from "axi-sdk-js"; // TOON encode under the hood
import { loadRuns, filterByStatus, summarize, truncate } from "./core.js";

/**
 * AXI interface (`ci`) — the finished, agent-native command and the payoff of
 * the demo. Same shared core as the CLI and MCP server; the only difference is
 * how the output is shaped and encoded. Four principles do the work here:
 *   P1 token-efficient output  — renderOutput() emits TOON, ~40% smaller than JSON
 *   P2 minimal default schema   — 4 fields per run (id, status, branch, logs)
 *   P4 pre-computed aggregate    — a summary line up front, no extra round-trip
 *   P3 content truncation        — logs clipped with a --full escape hatch
 * Plus a definitive empty state (P5) and a contextual next-step hint (P9).
 */

// Tiny hand-rolled flag parsing over process.argv — no framework needed.
function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

const status = getFlag("--status"); // e.g. "failed"
const full = hasFlag("--full");
const runs = status ? filterByStatus(loadRuns(), status) : loadRuns();

// Principle 5: definitive empty state — "0 runs", never silence.
if (runs.length === 0) {
  console.log(renderOutput({ summary: "0 runs", runs: [] }));
  process.exit(0);
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

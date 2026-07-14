import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Shared domain core for the CI demo. All three interfaces — CLI, MCP, AXI —
 * import from this module, so the ONLY thing that differs between them is how
 * they shape and encode the output. Keep this file interface-agnostic: no
 * printing, no TOON, no schemas here.
 */

export type RunStatus = "success" | "failed" | "running" | "cancelled";
export type JobStatus = RunStatus | "skipped" | "pending";

export interface Job {
  name: string;
  status: JobStatus;
  duration: number;
}

export interface Commit {
  sha: string;
  message: string;
  author: string;
}

export interface Run {
  id: string;
  status: RunStatus;
  branch: string;
  commit: Commit;
  trigger: string;
  duration_seconds: number;
  created_at: string;
  jobs: Job[];
  logs: string;
}

/** Absolute path to the seeded data, resolved relative to this module so it
 *  works whether run from `dist/` (compiled) or `src/` (tsx). */
const DATA_PATH = fileURLToPath(new URL("../data/runs.json", import.meta.url));

/** Load all seeded pipeline runs from disk. Fully offline — no network. */
export function loadRuns(): Run[] {
  return JSON.parse(readFileSync(DATA_PATH, "utf8")) as Run[];
}

/** Filter runs by their top-level status (e.g. "failed"). */
export function filterByStatus(runs: Run[], status: string): Run[] {
  return runs.filter((run) => run.status === status);
}

/**
 * One-line aggregate over the runs, e.g.
 *   "8 runs · 3 failed · 2 running · 3 passed"
 * "success" is reported as "passed". A "cancelled" segment is appended only
 * when at least one run carries that status, so the common line stays clean.
 */
export function summarize(runs: Run[]): string {
  const count = (status: RunStatus) =>
    runs.filter((run) => run.status === status).length;

  const segments = [
    `${count("failed")} failed`,
    `${count("running")} running`,
    `${count("success")} passed`,
  ];
  const cancelled = count("cancelled");
  if (cancelled > 0) segments.push(`${cancelled} cancelled`);

  return `${runs.length} runs · ${segments.join(" · ")}`;
}

/**
 * Truncate long text to `max` characters, appending a size hint that points at
 * the escape hatch, e.g. "…(1500 chars, use --full)". Short text is returned
 * untouched. This is what makes AXI's log field small without hiding anything.
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…(${text.length} chars, use --full)`;
}

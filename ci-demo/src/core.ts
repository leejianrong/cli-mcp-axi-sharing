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

// ---------------------------------------------------------------------------
// Drill-down helpers — used by the multi-step task ("for each failing run,
// which job failed and is it flaky/infra or a real regression?"). These let the
// AXI command answer the whole question in ONE compact call (P4: pre-computed
// aggregates), while a realistic MCP client must list, then fetch logs per run.
// ---------------------------------------------------------------------------

/** A compact one-line rollup of a run's jobs, e.g. "3 jobs · 2 ok · 1 failed". */
export function jobRollup(run: Run): string {
  const total = run.jobs.length;
  const ok = run.jobs.filter((j) => j.status === "success").length;
  const failed = run.jobs.filter((j) => j.status === "failed").length;
  const segments = [`${total} jobs`, `${ok} ok`];
  if (failed > 0) segments.push(`${failed} failed`);
  const other = total - ok - failed;
  if (other > 0) segments.push(`${other} other`);
  return segments.join(" · ");
}

/** A lightweight run summary — the shape a realistic list endpoint returns.
 *  Deliberately omits the full jobs[] array and the log tail: to inspect a
 *  failure you have to drill in (get_logs / list_jobs). This is what forces the
 *  multi-turn pattern for MCP, exactly as a real CI API would. */
export interface RunSummary {
  id: string;
  status: RunStatus;
  branch: string;
  trigger: string;
  duration_seconds: number;
  created_at: string;
  jobs: string;
}

/** Project a full Run down to its list-endpoint summary. */
export function runSummary(run: Run): RunSummary {
  return {
    id: run.id,
    status: run.status,
    branch: run.branch,
    trigger: run.trigger,
    duration_seconds: run.duration_seconds,
    created_at: run.created_at,
    jobs: jobRollup(run),
  };
}

/** The names of the jobs that failed in a run (status === "failed"). */
export function failingJobs(run: Run): string[] {
  return run.jobs.filter((j) => j.status === "failed").map((j) => j.name);
}

export type FailureClass = "flaky/infra" | "regression" | "unknown";

/** A classification of why a run failed, plus the log evidence that decided it. */
export interface FailureVerdict {
  classification: FailureClass;
  evidence: string;
}

// Signals that a failure is environmental/flaky rather than a code defect…
const FLAKY_SIGNALS: RegExp[] = [
  /flaky/i,
  /timeout(error)?/i,
  /\b50[234]\b/, // 502 / 503 / 504 from an upstream/sandbox
  /sandbox/i,
  /econnreset|etimedout|network|socket hang up/i,
  /rate.?limit/i,
];

// …versus signals that point at a real code/config regression.
const REGRESSION_SIGNALS: RegExp[] = [
  /assertion(error)?/i,
  /expected .* to (be|equal)/i,
  /eslint|lint (job )?failed|\berror\b\s+'/i,
  /type(script)? error|ts\d{3,}/i,
  /compil(e|ation) (error|failed)/i,
];

/** First capture of the earliest matching signal, trimmed for display. */
function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  let best: { index: number; snippet: string } | undefined;
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && (best === undefined || m.index < best.index)) {
      // Grab the line the match sits on, so the evidence reads sensibly.
      const start = text.lastIndexOf("\n", m.index) + 1;
      const end = text.indexOf("\n", m.index);
      best = {
        index: m.index,
        snippet: text.slice(start, end === -1 ? undefined : end).trim(),
      };
    }
  }
  return best?.snippet;
}

/**
 * Classify a failed run as flaky/infra vs a real regression by scanning its log
 * tail. Flaky signals win ties (a timeout against a 502 sandbox is flaky even if
 * an assertion also appears downstream). Non-failed runs classify as "unknown".
 * Heuristic and deliberately simple — it is a teaching prop, not a real triager.
 */
export function classifyFailure(run: Run): FailureVerdict {
  if (run.status !== "failed") {
    return { classification: "unknown", evidence: "" };
  }
  const flaky = firstMatch(run.logs, FLAKY_SIGNALS);
  if (flaky) return { classification: "flaky/infra", evidence: flaky };
  const regression = firstMatch(run.logs, REGRESSION_SIGNALS);
  if (regression) return { classification: "regression", evidence: regression };
  return { classification: "unknown", evidence: "" };
}

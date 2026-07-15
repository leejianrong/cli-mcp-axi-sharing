import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Run } from "./core.js";
import { loadRuns, filterByStatus, runSummary, failingJobs } from "./core.js";

/**
 * MCP server for the offline CI demo (`ci-mcp`).
 *
 * This is the "MCP" corner of the CLI vs MCP vs AXI comparison. It exposes a
 * realistic CI/CD tool surface — ~18 tools, each carrying a deliberately full,
 * verbose JSON-schema `inputSchema` plus a rich human-readable description. That
 * is the whole point: the concatenated tool definitions are heavy, and an MCP
 * client pays that "schema tax" in context on EVERY turn. A real CI server (runs,
 * jobs, logs, artifacts, workflows, branches, deployments, checks, metrics…)
 * easily reaches this many; this is not padding, it is representative.
 *
 * `list_runs` returns lightweight SUMMARIES (no logs, no full jobs[]) — exactly
 * as a real list endpoint does — so answering anything about *why* a run failed
 * requires drilling in (get_logs / list_jobs / search_logs) over several turns.
 * That multi-turn drill-down is where the per-turn schema tax compounds.
 *
 * Everything is offline — tool results are backed by the shared `core.ts`
 * helpers reading `data/runs.json`. Mutating / external tools (retry, cancel,
 * trigger, approve…) never touch disk; they return a plausible acknowledgement.
 */

/** A single MCP tool definition: name, human description, and JSON Schema. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * The full tool catalog. Exported so `scripts/capture.mjs` can import and
 * serialize the schemas directly, without spawning the stdio server. This array
 * is the single source of truth for both the `tools/list` response and the
 * offline capture.
 */
export const TOOLS: ToolDefinition[] = [
  {
    name: "list_runs",
    description:
      "List CI/CD pipeline runs, most recent first. Supports optional filtering " +
      "by run status, source branch, and a maximum number of results. Returns an " +
      "array of lightweight run SUMMARIES (id, status, branch, trigger, duration, " +
      "created_at, and a one-line job rollup) — NOT the logs or full job details. " +
      "Call this first to discover run ids, then use get_run, list_jobs, " +
      "get_logs, or search_logs to inspect a specific run.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: {
          type: "string",
          description:
            "Only return runs whose top-level status matches this value. Omit to " +
            "return runs of every status.",
          enum: ["success", "failed", "running", "cancelled"],
        },
        branch: {
          type: "string",
          description:
            "Only return runs triggered on this exact git branch name, e.g. " +
            "'main' or 'feat/checkout-retry'. Matched case-sensitively.",
        },
        limit: {
          type: "integer",
          description:
            "Maximum number of runs to return after all other filters are " +
            "applied. Useful for keeping the response small.",
          minimum: 1,
          maximum: 100,
          default: 20,
        },
      },
      required: [],
    },
  },
  {
    name: "get_run",
    description:
      "Fetch one pipeline run by its id and return the complete run object, " +
      "including status, branch, commit {sha, message, author}, trigger, total " +
      "duration in seconds, creation timestamp, the full jobs[] array, and the " +
      "entire captured log tail. Use this when you already know the run id and " +
      "want every field for that run.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        run_id: {
          type: "string",
          description:
            "The unique identifier of the run to fetch, e.g. 'run_8f2a'. Obtain " +
            "these from list_runs.",
        },
      },
      required: ["run_id"],
    },
  },
  {
    name: "list_jobs",
    description:
      "List the individual jobs that make up a single pipeline run. Returns the " +
      "run's jobs[] array, where each job carries its name (e.g. 'lint', 'unit', " +
      "'e2e'), its status, and its duration in seconds. Use this to see which " +
      "specific stage of a run passed, failed, was skipped, or is still pending.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        run_id: {
          type: "string",
          description:
            "The unique identifier of the run whose jobs should be listed, e.g. " +
            "'run_8f2a'.",
        },
      },
      required: ["run_id"],
    },
  },
  {
    name: "get_logs",
    description:
      "Retrieve the captured console log tail for a single pipeline run. By " +
      "default the entire stored log is returned; pass tail_lines to return only " +
      "the last N lines, which is the usual way to inspect a failure without " +
      "pulling the whole buffer into context.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        run_id: {
          type: "string",
          description:
            "The unique identifier of the run whose logs should be fetched, e.g. " +
            "'run_8f2a'.",
        },
        tail_lines: {
          type: "integer",
          description:
            "If provided, return only the last N lines of the log instead of the " +
            "full buffer. Omit to return the complete log.",
          minimum: 1,
          maximum: 10000,
        },
      },
      required: ["run_id"],
    },
  },
  {
    name: "retry_run",
    description:
      "Request a retry of a pipeline run. By default the entire run is re-queued " +
      "from the start; set only_failed_jobs to re-run just the jobs that did not " +
      "succeed. This is an offline demo, so no state is mutated on disk — the " +
      "tool returns a plausible acknowledgement describing the retry that would " +
      "have been enqueued.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        run_id: {
          type: "string",
          description:
            "The unique identifier of the run to retry, e.g. 'run_8f2a'.",
        },
        only_failed_jobs: {
          type: "boolean",
          description:
            "When true, re-run only the jobs that failed in the original run " +
            "rather than the entire pipeline.",
          default: false,
        },
      },
      required: ["run_id"],
    },
  },
  {
    name: "cancel_run",
    description:
      "Request cancellation of a pipeline run that is currently in progress. An " +
      "optional human-readable reason can be attached for the audit trail. This " +
      "is an offline demo, so no state is mutated on disk — the tool returns a " +
      "plausible acknowledgement describing the cancellation that would have been " +
      "issued.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        run_id: {
          type: "string",
          description:
            "The unique identifier of the run to cancel, e.g. 'run_4c88'.",
        },
        reason: {
          type: "string",
          description:
            "Optional free-text explanation recorded alongside the cancellation, " +
            "e.g. 'superseded by newer push'.",
        },
      },
      required: ["run_id"],
    },
  },
  {
    name: "search_logs",
    description:
      "Search the captured log tail of a single run for a substring or regular " +
      "expression, returning only the matching lines (with optional surrounding " +
      "context). Use this to locate a specific error, assertion, or stack frame " +
      "without pulling the entire log buffer into context.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        run_id: {
          type: "string",
          description: "The run whose logs to search, e.g. 'run_8f2a'.",
        },
        query: {
          type: "string",
          description:
            "Substring or regular expression to match against each log line.",
        },
        is_regex: {
          type: "boolean",
          description: "Treat `query` as a regular expression rather than a literal substring.",
          default: false,
        },
        context_lines: {
          type: "integer",
          description: "Number of lines of context to include around each match.",
          minimum: 0,
          maximum: 20,
          default: 0,
        },
      },
      required: ["run_id", "query"],
    },
  },
  {
    name: "get_job_logs",
    description:
      "Retrieve the log output scoped to a single named job (e.g. 'lint', 'unit', " +
      "'e2e') within a run, rather than the whole-run buffer. Use when you already " +
      "know which job failed and want just that job's output.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        run_id: { type: "string", description: "The run id, e.g. 'run_3d71'." },
        job_name: {
          type: "string",
          description: "The job whose logs to fetch, e.g. 'unit'.",
        },
      },
      required: ["run_id", "job_name"],
    },
  },
  {
    name: "get_run_annotations",
    description:
      "Return the structured error/warning annotations extracted from a run's logs " +
      "(the '::error::' / '::warning::' markers CI emits), each with its message. " +
      "A compact way to see what a run flagged without reading the full log tail.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        run_id: { type: "string", description: "The run id to read annotations for." },
        level: {
          type: "string",
          description: "Filter to a single annotation level.",
          enum: ["error", "warning", "notice"],
        },
      },
      required: ["run_id"],
    },
  },
  {
    name: "rerun_failed_jobs",
    description:
      "Re-run only the failed jobs of a pipeline run, leaving successful jobs " +
      "untouched. Offline demo — returns a plausible acknowledgement; no state is " +
      "mutated on disk.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        run_id: { type: "string", description: "The run whose failed jobs to re-run." },
      },
      required: ["run_id"],
    },
  },
  {
    name: "list_artifacts",
    description:
      "List the build artifacts produced by a run — name, size in bytes, content " +
      "type, and an expiry timestamp. Artifacts are things like coverage reports, " +
      "export samples, and captured HAR files. Use before download_artifact.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        run_id: { type: "string", description: "The run whose artifacts to list." },
      },
      required: ["run_id"],
    },
  },
  {
    name: "get_artifact_metadata",
    description:
      "Fetch metadata for a single artifact by id: name, byte size, content type, " +
      "sha256 digest, and expiry. Does not download the bytes — use " +
      "download_artifact for that.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        run_id: { type: "string", description: "The run the artifact belongs to." },
        artifact_id: { type: "string", description: "The artifact id, e.g. 'art_1'." },
      },
      required: ["run_id", "artifact_id"],
    },
  },
  {
    name: "download_artifact",
    description:
      "Request a time-limited download URL for a run artifact. Offline demo — " +
      "returns a plausible signed-URL acknowledgement rather than bytes.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        run_id: { type: "string", description: "The run the artifact belongs to." },
        artifact_id: { type: "string", description: "The artifact id to download." },
      },
      required: ["run_id", "artifact_id"],
    },
  },
  {
    name: "list_workflows",
    description:
      "List the CI/CD workflows defined for the repository — id, name, the file " +
      "that defines them, and their enabled state. Workflows are the pipelines " +
      "that runs are instances of.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled_only: {
          type: "boolean",
          description: "Return only workflows that are currently enabled.",
          default: false,
        },
      },
      required: [],
    },
  },
  {
    name: "get_workflow",
    description:
      "Fetch a single workflow by id, including its name, defining file, triggers, " +
      "and enabled state.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        workflow_id: { type: "string", description: "The workflow id, e.g. 'wf_ci'." },
      },
      required: ["workflow_id"],
    },
  },
  {
    name: "trigger_workflow",
    description:
      "Manually trigger a workflow run on a given git ref, optionally passing " +
      "workflow inputs. Offline demo — returns an acknowledgement describing the " +
      "run that would have been enqueued.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        workflow_id: { type: "string", description: "The workflow to trigger." },
        ref: {
          type: "string",
          description: "The git ref (branch, tag, or SHA) to run against, e.g. 'main'.",
        },
        inputs: {
          type: "object",
          description: "Optional key/value workflow inputs.",
          additionalProperties: { type: "string" },
        },
      },
      required: ["workflow_id", "ref"],
    },
  },
  {
    name: "list_branches",
    description:
      "List the git branches that have at least one pipeline run, with the id and " +
      "status of their most recent run. Useful for finding which branches are " +
      "currently red.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: {
          type: "string",
          description: "Only include branches whose most recent run has this status.",
          enum: ["success", "failed", "running", "cancelled"],
        },
      },
      required: [],
    },
  },
  {
    name: "get_pipeline_metrics",
    description:
      "Return aggregate pipeline health metrics over all known runs: total runs, " +
      "counts by status, pass rate, and average run duration in seconds. A " +
      "dashboard-style summary computed server-side.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        branch: {
          type: "string",
          description: "Restrict the metrics to a single branch.",
        },
      },
      required: [],
    },
  },
  {
    name: "list_pull_request_checks",
    description:
      "List the CI checks associated with a pull request number, deriving them " +
      "from runs triggered by that PR. Returns each run's id, branch, and status.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        pr_number: {
          type: "integer",
          description: "The pull request number whose checks to list.",
          minimum: 1,
        },
      },
      required: ["pr_number"],
    },
  },
  {
    name: "list_deployments",
    description:
      "List recent deployments across environments — id, environment, the run that " +
      "produced them, version, and state (queued, in_progress, active, failed). " +
      "Offline demo — deployments are synthesized from the run history.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        environment: {
          type: "string",
          description: "Filter to a single environment, e.g. 'staging' or 'production'.",
          enum: ["staging", "production", "preview"],
        },
      },
      required: [],
    },
  },
  {
    name: "approve_deployment",
    description:
      "Approve a deployment that is waiting on a required review gate. Offline " +
      "demo — returns an acknowledgement rather than mutating state.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        deployment_id: {
          type: "string",
          description: "The deployment awaiting approval, e.g. 'dep_2'.",
        },
        comment: {
          type: "string",
          description: "Optional approval comment recorded on the audit trail.",
        },
      },
      required: ["deployment_id"],
    },
  },
];

/** Wrap any JSON-serializable value as a standard MCP text-content result. */
function textResult(result: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}

/** Look up a run by id, throwing a clear error if it does not exist. */
function requireRun(runId: unknown) {
  if (typeof runId !== "string" || runId.length === 0) {
    throw new Error("run_id is required and must be a non-empty string");
  }
  const run = loadRuns().find((r) => r.id === runId);
  if (!run) throw new Error(`No run found with id '${runId}'`);
  return run;
}

/** Parse the CI-style annotation markers (`::error::…`) out of a log tail. */
function parseAnnotations(logs: string): { level: string; message: string }[] {
  const out: { level: string; message: string }[] = [];
  for (const line of logs.split("\n")) {
    const m = /::(error|warning|notice)::(.*)/.exec(line);
    if (m) out.push({ level: m[1], message: m[2].trim() });
  }
  return out;
}

/** Synthesize a plausible artifact list for a run from its shape. Offline. */
function artifactsFor(run: Run): {
  artifact_id: string;
  name: string;
  size_bytes: number;
  content_type: string;
}[] {
  const items = [
    { name: "run-logs.txt", size_bytes: run.logs.length, content_type: "text/plain" },
  ];
  if (run.jobs.some((j) => j.name === "unit")) {
    items.push({ name: "coverage.lcov", size_bytes: 48_213, content_type: "text/plain" });
  }
  if (run.jobs.some((j) => j.name === "e2e")) {
    items.push({ name: "network.har", size_bytes: 1_204_882, content_type: "application/json" });
  }
  return items.map((a, i) => ({ artifact_id: `art_${i + 1}`, ...a }));
}

/** The static workflow catalog the runs are instances of. Offline. */
const WORKFLOWS = [
  { workflow_id: "wf_ci", name: "CI", file: ".github/workflows/ci.yml", triggers: ["push", "pull_request"], enabled: true },
  { workflow_id: "wf_nightly", name: "Nightly", file: ".github/workflows/nightly.yml", triggers: ["schedule"], enabled: true },
  { workflow_id: "wf_release", name: "Release", file: ".github/workflows/release.yml", triggers: ["workflow_dispatch"], enabled: false },
];

/** Dispatch a single tool call to its backing implementation. Exported so the
 *  fair agent-run harness can call tools in-process (no stdio) — the MCP
 *  transport adds no tokens, so in-process dispatch measures the same schemas +
 *  results a real client would see. */
export function callTool(name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case "list_runs": {
      let runs = loadRuns();
      if (typeof args.status === "string") {
        runs = filterByStatus(runs, args.status);
      }
      if (typeof args.branch === "string") {
        runs = runs.filter((r) => r.branch === args.branch);
      }
      if (typeof args.limit === "number") {
        runs = runs.slice(0, args.limit);
      }
      // Realistic list endpoint: SUMMARIES only, no logs/full jobs. Drilling in
      // (get_run / get_logs / list_jobs) is a separate, per-run call.
      return runs.map(runSummary);
    }
    case "get_run":
      return requireRun(args.run_id);
    case "list_jobs":
      return requireRun(args.run_id).jobs;
    case "get_logs": {
      const run = requireRun(args.run_id);
      if (typeof args.tail_lines === "number") {
        const lines = run.logs.split("\n");
        return { run_id: run.id, logs: lines.slice(-args.tail_lines).join("\n") };
      }
      return { run_id: run.id, logs: run.logs };
    }
    case "search_logs": {
      const run = requireRun(args.run_id);
      const query = String(args.query ?? "");
      const ctx = typeof args.context_lines === "number" ? args.context_lines : 0;
      const lines = run.logs.split("\n");
      const test =
        args.is_regex === true
          ? (line: string) => new RegExp(query).test(line)
          : (line: string) => line.includes(query);
      const hits: { line: number; text: string }[] = [];
      lines.forEach((line, i) => {
        if (test(line)) {
          const from = Math.max(0, i - ctx);
          const to = Math.min(lines.length - 1, i + ctx);
          for (let j = from; j <= to; j++) hits.push({ line: j + 1, text: lines[j] });
        }
      });
      return { run_id: run.id, query, matches: hits };
    }
    case "get_job_logs": {
      const run = requireRun(args.run_id);
      const jobName = String(args.job_name ?? "");
      const job = run.jobs.find((j) => j.name === jobName);
      if (!job) throw new Error(`No job '${jobName}' in run '${run.id}'`);
      // Only run-level logs are stored in this demo; return them scoped by label.
      return { run_id: run.id, job: job.name, status: job.status, logs: run.logs };
    }
    case "get_run_annotations": {
      const run = requireRun(args.run_id);
      let annotations = parseAnnotations(run.logs);
      if (typeof args.level === "string") {
        annotations = annotations.filter((a) => a.level === args.level);
      }
      return { run_id: run.id, annotations };
    }
    case "rerun_failed_jobs": {
      const run = requireRun(args.run_id);
      return {
        acknowledged: true,
        action: "rerun_failed_jobs",
        run_id: run.id,
        rerun_jobs: failingJobs(run),
        new_run_id: `${run.id}_rerun`,
        status: "queued",
        message: `Failed jobs re-queued for ${run.id} (offline demo — no state changed).`,
      };
    }
    case "list_artifacts": {
      const run = requireRun(args.run_id);
      return { run_id: run.id, artifacts: artifactsFor(run) };
    }
    case "get_artifact_metadata": {
      const run = requireRun(args.run_id);
      const artifactId = String(args.artifact_id ?? "");
      const artifact = artifactsFor(run).find((a) => a.artifact_id === artifactId);
      if (!artifact) throw new Error(`No artifact '${artifactId}' for run '${run.id}'`);
      return {
        ...artifact,
        run_id: run.id,
        sha256: `sha256:${run.commit.sha}${artifact.artifact_id}`,
        expires_at: "2026-08-13T00:00:00Z",
      };
    }
    case "download_artifact": {
      const run = requireRun(args.run_id);
      const artifactId = String(args.artifact_id ?? "");
      return {
        acknowledged: true,
        run_id: run.id,
        artifact_id: artifactId,
        url: `https://artifacts.internal/${run.id}/${artifactId}?sig=demo`,
        expires_in_seconds: 900,
        message: "Signed URL issued (offline demo — not downloadable).",
      };
    }
    case "list_workflows": {
      const workflows = args.enabled_only === true ? WORKFLOWS.filter((w) => w.enabled) : WORKFLOWS;
      return { workflows };
    }
    case "get_workflow": {
      const id = String(args.workflow_id ?? "");
      const wf = WORKFLOWS.find((w) => w.workflow_id === id);
      if (!wf) throw new Error(`No workflow with id '${id}'`);
      return wf;
    }
    case "trigger_workflow": {
      const id = String(args.workflow_id ?? "");
      const wf = WORKFLOWS.find((w) => w.workflow_id === id);
      if (!wf) throw new Error(`No workflow with id '${id}'`);
      return {
        acknowledged: true,
        action: "trigger_workflow",
        workflow_id: wf.workflow_id,
        ref: typeof args.ref === "string" ? args.ref : null,
        inputs: (args.inputs as Record<string, unknown>) ?? {},
        new_run_id: "run_dispatch",
        status: "queued",
        message: `Workflow ${wf.name} triggered (offline demo — no state changed).`,
      };
    }
    case "list_branches": {
      const runs = loadRuns();
      const byBranch = new Map<string, Run>();
      for (const run of runs) {
        // runs are seeded most-recent-first per branch; keep the first seen.
        if (!byBranch.has(run.branch)) byBranch.set(run.branch, run);
      }
      let branches = [...byBranch.entries()].map(([branch, run]) => ({
        branch,
        latest_run_id: run.id,
        latest_status: run.status,
      }));
      if (typeof args.status === "string") {
        branches = branches.filter((b) => b.latest_status === args.status);
      }
      return { branches };
    }
    case "get_pipeline_metrics": {
      let runs = loadRuns();
      if (typeof args.branch === "string") {
        runs = runs.filter((r) => r.branch === args.branch);
      }
      const by = (s: string) => runs.filter((r) => r.status === s).length;
      const finished = by("success") + by("failed");
      const avg =
        runs.length > 0
          ? Math.round(runs.reduce((n, r) => n + r.duration_seconds, 0) / runs.length)
          : 0;
      return {
        total_runs: runs.length,
        by_status: {
          success: by("success"),
          failed: by("failed"),
          running: by("running"),
          cancelled: by("cancelled"),
        },
        pass_rate: finished > 0 ? Number((by("success") / finished).toFixed(3)) : null,
        avg_duration_seconds: avg,
      };
    }
    case "list_pull_request_checks": {
      const prNumber = typeof args.pr_number === "number" ? args.pr_number : null;
      const checks = loadRuns()
        .filter((r) => r.trigger === "pull_request")
        .map((r) => ({ run_id: r.id, branch: r.branch, status: r.status }));
      return { pr_number: prNumber, checks };
    }
    case "list_deployments": {
      // Synthesize deployments from successful runs on deployable branches.
      const deployable = loadRuns().filter((r) => r.status === "success");
      let deployments = deployable.map((r, i) => ({
        deployment_id: `dep_${i + 1}`,
        environment: r.branch === "main" ? "production" : "staging",
        run_id: r.id,
        version: r.commit.sha,
        state: "active",
      }));
      if (typeof args.environment === "string") {
        deployments = deployments.filter((d) => d.environment === args.environment);
      }
      return { deployments };
    }
    case "approve_deployment": {
      const id = String(args.deployment_id ?? "");
      return {
        acknowledged: true,
        action: "approve_deployment",
        deployment_id: id,
        comment: typeof args.comment === "string" ? args.comment : null,
        state: "approved",
        message: `Deployment ${id} approved (offline demo — no state changed).`,
      };
    }
    case "retry_run": {
      const run = requireRun(args.run_id);
      const onlyFailed = args.only_failed_jobs === true;
      return {
        acknowledged: true,
        action: "retry",
        run_id: run.id,
        only_failed_jobs: onlyFailed,
        retried_jobs: onlyFailed
          ? run.jobs.filter((j) => j.status === "failed").map((j) => j.name)
          : run.jobs.map((j) => j.name),
        new_run_id: `${run.id}_retry`,
        status: "queued",
        message: `Retry queued for ${run.id} (offline demo — no state changed).`,
      };
    }
    case "cancel_run": {
      const run = requireRun(args.run_id);
      return {
        acknowledged: true,
        action: "cancel",
        run_id: run.id,
        reason: typeof args.reason === "string" ? args.reason : null,
        previous_status: run.status,
        status: "cancelled",
        message: `Cancellation issued for ${run.id} (offline demo — no state changed).`,
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/** Build the configured MCP server with both request handlers registered. */
export function createServer(): Server {
  const server = new Server(
    { name: "ci-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      return textResult(callTool(name, args ?? {}));
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  });

  return server;
}

/** Connect the server to stdio. Only runs when invoked as the entry point. */
async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // A friendly note on stderr so a human running `pnpm mcp` sees signs of life
  // without polluting the stdout JSON-RPC channel.
  console.error("ci-mcp server running on stdio");
}

// Guard: only auto-start when this module is the process entry point, so that
// `scripts/capture.mjs` can import TOOLS without spawning the transport.
const isEntry =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntry) {
  main().catch((err) => {
    console.error("Fatal error in ci-mcp server:", err);
    process.exit(1);
  });
}

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadRuns, filterByStatus } from "./core.js";

/**
 * MCP server for the offline CI demo (`ci-mcp`).
 *
 * This is the "MCP" corner of the CLI vs MCP vs AXI comparison. It exposes six
 * tools, each carrying a deliberately full, verbose JSON-schema `inputSchema`
 * plus a rich human-readable description. That is the whole point: the
 * concatenated tool definitions are heavy, and an MCP client pays that "schema
 * tax" in context on every turn. Real servers ship 30 of these; six is enough
 * to make the weight obvious.
 *
 * Everything is offline — tool results are backed by the shared `core.ts`
 * helpers reading `data/runs.json`. The two mutating tools (`retry_run`,
 * `cancel_run`) never touch disk; they return a plausible acknowledgement.
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
      "array of full run objects, each including commit metadata, the job " +
      "breakdown, timing, and the captured log tail. Call this first to discover " +
      "run ids before drilling into a specific run.",
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

/** Dispatch a single tool call to its backing implementation. */
function callTool(name: string, args: Record<string, unknown>): unknown {
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
      return runs;
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

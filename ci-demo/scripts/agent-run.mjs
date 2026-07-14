#!/usr/bin/env node
// @ts-check
/**
 * scripts/agent-run.mjs — the real-agent measurement harness.
 *
 * Drives a GENUINE agent (Claude, via the installed Claude Code CLI in headless
 * mode) to complete ONE task — "list the pipeline runs that are failing" —
 * THREE times, once per interface (CLI, MCP, AXI), and captures
 * turns · total tokens · cost for each. It then prints a clean summary table.
 *
 * This produces the numbers and on-screen content for `recording/agent-run.mp4`
 * (played on slide 12 of the talk). Per the demo script it runs BEFORE the talk,
 * never on stage — it is the ONE non-offline part of the whole repo, and is
 * fenced off here accordingly.
 *
 *   Same task, same model — ONLY the interface changes. That is the whole point:
 *   the interface is the independent variable.
 *     - CLI: agent has shell access, told to use `node dist/cli.js` (bin ci-cli).
 *     - MCP: agent connects to the ci-mcp stdio server via --mcp-config and is
 *            told to use its tools.
 *     - AXI: agent has shell access, told to use `node dist/axi.js` (bin ci).
 *
 * APPROACH: we shell out to the installed Claude Code CLI (`claude -p ...
 * --output-format json`) rather than taking a hard dependency on the Agent SDK
 * (`@anthropic-ai/claude-agent-sdk`). Reasons:
 *   - `claude` is already on PATH and reports turns/usage/cost in its JSON result
 *     (num_turns, usage{...}, total_cost_usd), so no extra parsing layer.
 *   - It keeps the repo OFFLINE-INSTALLABLE: nothing here is imported at module
 *     load, so `pnpm install` never needs a network dependency for this script.
 *   - Passing an --mcp-config for the MCP condition is a first-class CLI feature.
 *
 * NO API ACCESS in this build environment (no ANTHROPIC_API_KEY, and the CLI may
 * not be authenticated). So this script DETECTS the absence of API access up
 * front (see hasApiAccess()) and, instead of crashing or hanging on the network,
 * prints a clear explanation plus the summary table with `TODO` placeholders in
 * every metric cell, then exits 0. Wire it, guard it, run it later with creds.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Paths & constants
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// scripts/ lives directly under the ci-demo package root.
const PKG_ROOT = resolve(SCRIPT_DIR, "..");
const DIST = join(PKG_ROOT, "dist");
const OUT_DIR = join(PKG_ROOT, "out");

/** The measured task — identical across all three interfaces. */
const TASK = "List the pipeline runs that are failing.";

/**
 * Model is configurable via `--model <id>` or the CI_DEMO_MODEL env var.
 * Default: a current Sonnet. The published benchmark (see docs/discovery_notes.md)
 * used Claude Sonnet, so we default to the current Sonnet — `claude-sonnet-5`.
 * NOTE for the orchestrator to double-check: `claude-sonnet-5` is the current
 * Sonnet model ID as of this writing; the Claude Code CLI also accepts the alias
 * "sonnet". Override with --model / CI_DEMO_MODEL if a newer Sonnet ships.
 */
const DEFAULT_MODEL = "claude-sonnet-5";

/** The dist entry points behind each bin (see package.json "bin"). */
const CLI_ENTRY = join(DIST, "cli.js"); // bin: ci-cli
const MCP_ENTRY = join(DIST, "mcp-server.js"); // bin: ci-mcp
const AXI_ENTRY = join(DIST, "axi.js"); // bin: ci

/** The six tools exposed by the ci-mcp server (kept in sync with src/mcp-server.ts). */
const MCP_SERVER_NAME = "ci";
const MCP_TOOL_NAMES = [
  "list_runs",
  "get_run",
  "list_jobs",
  "get_logs",
  "retry_run",
  "cancel_run",
].map((t) => `mcp__${MCP_SERVER_NAME}__${t}`);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Read the value after `--name` in argv, or undefined. */
function getFlag(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 && i < process.argv.length - 1 ? process.argv[i + 1] : undefined;
}

const MODEL = getFlag("--model") ?? process.env.CI_DEMO_MODEL ?? DEFAULT_MODEL;

/** Locate the `claude` binary; undefined if not on PATH. */
function findClaude() {
  const probe = spawnSync(process.platform === "win32" ? "where" : "command", [
    ...(process.platform === "win32" ? ["claude"] : ["-v", "claude"]),
  ]);
  if (probe.status === 0) {
    const out = String(probe.stdout).trim().split("\n")[0].trim();
    if (out) return out;
  }
  // Fallback: just trust that `claude` resolves on PATH at call time.
  return "claude";
}

const CLAUDE = findClaude();

/**
 * Detect whether this environment can actually reach the Anthropic API through
 * the Claude Code CLI. True if ANTHROPIC_API_KEY is set, OR `claude auth status`
 * reports a logged-in session. This probe is LOCAL and fast — it never makes a
 * network request (auth status reads on-disk credentials only). We deliberately
 * do NOT attempt a real message call here: "do not burn time reaching the API".
 */
function hasApiAccess() {
  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim()) {
    return true;
  }
  const res = spawnSync(CLAUDE, ["auth", "status", "--json"], {
    encoding: "utf8",
    timeout: 20_000,
  });
  if (res.status !== 0 || !res.stdout) return false;
  try {
    const parsed = JSON.parse(res.stdout);
    return parsed.loggedIn === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Per-interface run configuration
// ---------------------------------------------------------------------------

/**
 * Build the prompt + CLI flag set for one interface. Same TASK everywhere; the
 * only variable is HOW the agent is told to reach the data (shell vs MCP tools)
 * and which tools it is granted.
 */
function conditions() {
  // Written just before the MCP run; a stdio server the CLI will spawn itself.
  const mcpConfigPath = join(OUT_DIR, "agent-mcp-config.json");

  return [
    {
      label: "CLI",
      prompt:
        `${TASK}\n\n` +
        `Use the shell to run the \`ci-cli\` command, which is \`node dist/cli.js\`. ` +
        `For example: \`node dist/cli.js list --status failed\`. ` +
        `Report the ids of the failing runs.`,
      // Shell access only; steer via the prompt above.
      extraArgs: ["--tools", "Bash"],
      before: () => {},
    },
    {
      label: "MCP",
      prompt:
        `${TASK}\n\n` +
        `You have an MCP server named "${MCP_SERVER_NAME}" with tools for querying ` +
        `CI/CD pipeline runs (list_runs, get_run, list_jobs, get_logs, ...). ` +
        `Use those tools to find the failing runs and report their ids.`,
      // No built-in tools; connect the ci-mcp stdio server and allow only its tools.
      extraArgs: [
        "--tools",
        "", // disable built-in tools so the interface truly is "MCP only"
        "--mcp-config",
        mcpConfigPath,
        "--strict-mcp-config", // ignore any ambient MCP config; only ours
        "--allowedTools",
        MCP_TOOL_NAMES.join(" "),
      ],
      before: () => {
        mkdirSync(OUT_DIR, { recursive: true });
        // A stdio MCP server the CLI launches for the duration of the run.
        writeFileSync(
          mcpConfigPath,
          JSON.stringify(
            {
              mcpServers: {
                [MCP_SERVER_NAME]: { command: "node", args: [MCP_ENTRY] },
              },
            },
            null,
            2,
          ),
        );
      },
    },
    {
      label: "AXI",
      prompt:
        `${TASK}\n\n` +
        `Use the shell to run the \`ci\` command, which is \`node dist/axi.js\`. ` +
        `For example: \`node dist/axi.js list --status failed\`. ` +
        `Report the ids of the failing runs.`,
      extraArgs: ["--tools", "Bash"],
      before: () => {},
    },
  ];
}

/**
 * Run one interface condition through the Claude Code CLI in headless mode and
 * parse turns/tokens/cost out of the JSON result. Returns a metrics row.
 */
function runCondition(cond) {
  cond.before();

  const args = [
    "-p",
    cond.prompt,
    "--output-format",
    "json",
    "--model",
    MODEL,
    // Non-interactive: never prompt for tool-permission approval. This is an
    // offline-data sandbox; the only network egress is to the Anthropic API.
    "--permission-mode",
    "bypassPermissions",
    ...cond.extraArgs,
  ];

  const res = spawnSync(CLAUDE, args, {
    cwd: PKG_ROOT, // so `node dist/…` resolves and the CLI runs against this repo
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // Generous ceiling: a full agent run can take a few minutes.
    timeout: 10 * 60 * 1000,
  });

  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || res.error?.message || "").toString().trim();
    throw new Error(`claude exited with status ${res.status} for ${cond.label}: ${detail}`);
  }

  return parseMetrics(cond.label, res.stdout);
}

/**
 * Parse the `claude --output-format json` result object into a metrics row.
 *
 * The Claude Code CLI JSON result carries (top-level):
 *   - num_turns       — number of agent turns
 *   - total_cost_usd  — total cost of the run in USD
 *   - usage           — { input_tokens, output_tokens,
 *                         cache_creation_input_tokens, cache_read_input_tokens }
 * Total tokens = the sum of all four usage buckets (what the agent actually
 * processed end-to-end, cache included). We read defensively with fallbacks so a
 * minor field rename in a future CLI version degrades to a visible gap, not a crash.
 */
function parseMetrics(label, stdout) {
  let obj;
  try {
    obj = JSON.parse(stdout);
  } catch {
    // stream-json or noise on stdout: grab the last JSON object line.
    const lines = stdout.trim().split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        obj = JSON.parse(lines[i]);
        break;
      } catch {
        /* keep scanning backwards */
      }
    }
  }
  if (!obj || typeof obj !== "object") {
    throw new Error(`could not parse JSON result for ${label}`);
  }

  const turns = obj.num_turns ?? obj.numTurns ?? null;
  const cost = obj.total_cost_usd ?? obj.cost_usd ?? obj.totalCostUsd ?? null;

  const u = obj.usage ?? obj.total_usage ?? {};
  const totalTokens =
    u && typeof u === "object"
      ? (u.input_tokens ?? 0) +
        (u.output_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0)
      : null;

  return {
    label,
    turns,
    totalTokens: totalTokens || null,
    cost,
  };
}

// ---------------------------------------------------------------------------
// Table rendering
// ---------------------------------------------------------------------------

/**
 * Render the summary table. `rows` is a list of { label, turns, totalTokens,
 * cost } — any missing metric is shown as the given placeholder (a real number,
 * or "TODO" on the no-credentials path).
 */
function renderTable(rows, placeholder = "TODO") {
  const cell = (v, kind) => {
    if (v === null || v === undefined) return placeholder;
    if (kind === "cost") return `$${Number(v).toFixed(4)}`;
    if (kind === "tokens") return Number(v).toLocaleString("en-US");
    return String(v);
  };

  const header = ["Interface", "Turns", "Total tokens", "Cost (USD)"];
  const body = rows.map((r) => [
    r.label,
    cell(r.turns, "turns"),
    cell(r.totalTokens, "tokens"),
    cell(r.cost, "cost"),
  ]);

  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map((row) => row[i].length)),
  );
  const fmt = (row) => row.map((c, i) => c.padEnd(widths[i])).join(" | ");

  const lines = [fmt(header), widths.map((w) => "-".repeat(w)).join("-+-")];
  for (const row of body) lines.push(fmt(row));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// No-credentials path
// ---------------------------------------------------------------------------

function printNoAccessAndExit() {
  const rows = [
    { label: "CLI", turns: null, totalTokens: null, cost: null },
    { label: "MCP", turns: null, totalTokens: null, cost: null },
    { label: "AXI", turns: null, totalTokens: null, cost: null },
  ];
  console.log(
    [
      "",
      "No API access detected — skipping the real-agent runs.",
      "",
      "This script drives a genuine Claude agent through each interface and needs",
      "either ANTHROPIC_API_KEY set, or the Claude Code CLI (`claude`) logged in",
      "(`claude auth login`). Neither was found in this environment, so nothing was",
      "sent to the API and no tokens were spent.",
      "",
      "To produce the real numbers before the talk, authenticate and re-run:",
      "",
      `    claude auth login          # or: export ANTHROPIC_API_KEY=sk-ant-...`,
      `    node scripts/agent-run.mjs        # optionally --model <id>`,
      "",
      `Task            : "${TASK}"`,
      `Model           : ${MODEL}   (override with --model <id> or CI_DEMO_MODEL)`,
      "",
      "Summary table (TODO — fill in by running with credentials):",
      "",
      renderTable(rows, "TODO"), // <-- TODO placeholders live in every metric cell
      "",
    ].join("\n"),
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  // Guard: dist/ must exist (run `pnpm build` first).
  for (const [name, p] of [
    ["cli.js", CLI_ENTRY],
    ["mcp-server.js", MCP_ENTRY],
    ["axi.js", AXI_ENTRY],
  ]) {
    if (!existsSync(p)) {
      console.error(`Missing ${name} — run \`pnpm build\` first (expected at ${p}).`);
      process.exit(1);
    }
  }

  // Up-front, local, no-network detection of API access.
  if (!hasApiAccess()) {
    printNoAccessAndExit();
    return; // unreachable (printNoAccessAndExit exits) — keeps control flow obvious
  }

  console.log(`Running the real agent 3× (model: ${MODEL}). This calls the API.\n`);
  const rows = [];
  for (const cond of conditions()) {
    process.stdout.write(`→ ${cond.label} ... `);
    try {
      const row = runCondition(cond);
      rows.push(row);
      console.log("done");
    } catch (err) {
      // One interface failing shouldn't lose the others; record a gap and go on.
      console.log(`FAILED (${err instanceof Error ? err.message : String(err)})`);
      rows.push({ label: cond.label, turns: null, totalTokens: null, cost: null });
    }
  }

  console.log(`\nTask: "${TASK}"   Model: ${MODEL}\n`);
  console.log(renderTable(rows, "n/a"));
  console.log("");
}

main();

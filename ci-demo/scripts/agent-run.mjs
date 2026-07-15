#!/usr/bin/env node
// @ts-check
/**
 * scripts/agent-run.mjs — the FAIR, MULTI-PROVIDER real-agent harness.
 *
 * Drives a genuine agent to complete ONE multi-step task — "for each failing
 * run, which job failed and is it flaky/infra or a real regression?" — THREE
 * times, once per interface (CLI, MCP, AXI), and reports turns + token buckets
 * + cost for each. Produces the numbers/recording for slide 12. Runs BEFORE the
 * talk, never on stage — the one non-offline part of the repo.
 *
 * ── Two things are held constant so the INTERFACE is the only variable ──
 *   • a minimal, shared system prompt (no big agent-framework preamble), and
 *   • per-interface tools only: one thin run-command tool for CLI/AXI, the full
 *     ~21-tool MCP catalog for MCP.
 * For the API providers we also send NO prompt caching, so per-turn cost is
 * order-independent. (The subscription CLI does its own caching we can't
 * disable — see the provider note below.)
 *
 * ── Providers (pick with --provider, else auto-detected) ──
 *   openai         raw fetch → OpenAI Chat Completions. Needs OPENAI_API_KEY.
 *                  Default model gpt-4o-mini. Great for cheap dev testing; the
 *                  token-diff tokenizer (gpt-tokenizer) is OpenAI-native, so its
 *                  counts are exact for this provider.
 *   anthropic-api  raw fetch → Anthropic Messages API. Needs ANTHROPIC_API_KEY
 *                  (pay-as-you-go). Exact, order-independent cost.
 *   anthropic-cli  shells out to the `claude` CLI → uses your Claude Code
 *                  SUBSCRIPTION (no API key). Cost is the CLI's total_cost_usd
 *                  ESTIMATE and may wobble with run order due to the CLI's
 *                  internal caching; turns + token volume stay solid. Best for
 *                  the actual slide-12 recording (matches the talk + benchmark).
 *
 * Auto-detect order when --provider is omitted: OPENAI_API_KEY → openai;
 * else ANTHROPIC_API_KEY → anthropic-api; else the `claude` CLI (subscription).
 *
 * ── Transport note ──
 * A production app would use the official SDK for its provider. This repo is
 * deliberately self-contained/offline (vendored deps only; see CLAUDE.md), and
 * this is its single networked script, so the API providers use `fetch` and add
 * no dependency.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { TOOLS, callTool } from "../dist/mcp-server.js";

// ---------------------------------------------------------------------------
// Paths & constants
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(SCRIPT_DIR, "..");
const DIST = join(PKG_ROOT, "dist");
const OUT_DIR = join(PKG_ROOT, "out");
const CLI_ENTRY = join(DIST, "cli.js"); // bin: ci-cli
const MCP_ENTRY = join(DIST, "mcp-server.js"); // bin: ci-mcp (guarded; imported in-process)
const AXI_ENTRY = join(DIST, "axi.js"); // bin: ci

/** The measured task — multi-step, identical across all three interfaces. */
const TASK =
  "For each failing pipeline run, tell me which job failed and whether the " +
  "failure looks like a flaky/infrastructure issue or a real code regression. " +
  "List each run's id, its failing job, and your classification.";

/** Minimal system prompt — identical for every provider and condition. */
const SYSTEM =
  "You are a CI/CD pipeline assistant. Use the provided tools to inspect real " +
  "pipeline data — never guess. When you have the answer, reply with a concise " +
  "final summary and stop.";

const MAX_TURNS = 12; // safety bound on the agent loop
const MAX_TOOL_OUTPUT = 200_000; // char cap on a single tool result (safety)

/** The MCP tool names, namespaced the way the `claude` CLI expects them. */
const MCP_SERVER_NAME = "ci";
const MCP_ALLOWED = TOOLS.map((t) => `mcp__${MCP_SERVER_NAME}__${t.name}`);

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function getFlag(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 && i < process.argv.length - 1 ? process.argv[i + 1] : undefined;
}

const REPEATS = Number(getFlag("--repeats") ?? "1") || 1;

/**
 * Prices in USD per 1M tokens. `claude-sonnet-5` has intro pricing ($2/$10)
 * through 2026-08-31. gpt-4o-mini rates are approximate — confirm with OpenAI
 * and override with --price-in / --price-out if needed. All conditions use the
 * SAME model, so the cost RATIO between interfaces is price-independent.
 */
const PRICES = {
  "claude-sonnet-5": { in: 3.0, out: 15.0 },
  "claude-opus-4-8": { in: 5.0, out: 25.0 },
  "claude-haiku-4-5": { in: 1.0, out: 5.0 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10.0 },
};

const DEFAULT_MODEL = {
  openai: "gpt-4o-mini",
  "anthropic-api": "claude-sonnet-5",
  "anthropic-cli": "claude-sonnet-5",
};

// ---------------------------------------------------------------------------
// Conditions — provider-neutral: each defines its tools (JSON-Schema) + an
// in-process executor for the API providers, plus how the CLI realizes it.
// ---------------------------------------------------------------------------

function runNode(entry, args) {
  const res = spawnSync(process.execPath, [entry, ...args], {
    cwd: PKG_ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.status !== 0 && !res.stdout) {
    throw new Error((res.stderr || res.error?.message || "command failed").trim());
  }
  return (res.stdout ?? "").slice(0, MAX_TOOL_OUTPUT);
}

/** One thin "run this CLI" tool — the entire interface surface for CLI/AXI. */
function shellTool(name, bin, example) {
  return {
    name,
    description:
      `Run the \`${bin}\` command-line tool and return its stdout. Pass the ` +
      `arguments as an array of strings, e.g. ${JSON.stringify(example)}.`,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        args: { type: "array", items: { type: "string" }, description: "Command arguments." },
      },
      required: ["args"],
    },
  };
}

/** MCP tools in the neutral shape (JSON Schema under `parameters`). */
const MCP_NEUTRAL_TOOLS = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: t.inputSchema,
}));

function conditions() {
  return [
    {
      label: "CLI",
      tools: [shellTool("run_ci_cli", "ci-cli", ["list", "--status", "failed"])],
      exec: (name, input) => runNode(CLI_ENTRY, input.args ?? []),
      // CLI-provider realization: shell out to ci-cli via the Bash tool.
      cli: { kind: "shell", bin: "cli.js", hint: "Use the Bash tool to run `node dist/cli.js` (e.g. `node dist/cli.js list --status failed`)." },
    },
    {
      label: "MCP",
      tools: MCP_NEUTRAL_TOOLS,
      exec: (name, input) => JSON.stringify(callTool(name, input ?? {})),
      cli: { kind: "mcp", hint: `Use the "${MCP_SERVER_NAME}" MCP tools (list_runs, get_logs, list_jobs, search_logs, …) to inspect the data.` },
    },
    {
      label: "AXI",
      tools: [shellTool("run_ci", "ci", ["failures"])],
      exec: (name, input) => runNode(AXI_ENTRY, input.args ?? []),
      cli: { kind: "shell", bin: "axi.js", hint: "Use the Bash tool to run `node dist/axi.js` (e.g. `node dist/axi.js failures`)." },
    },
  ];
}

/** Per-condition prompt hint for the API providers (only its tools exist, so
 *  this just nudges it to actually use them). */
function apiHint(cond) {
  const toolNames = cond.tools.map((t) => t.name).join(", ");
  return `\n\nUse the available tool(s) — ${toolNames} — to get real data before answering.`;
}

// ---------------------------------------------------------------------------
// Cost helper (for the API providers, which return raw token counts)
// ---------------------------------------------------------------------------

function priceFor(model) {
  return {
    in: Number(getFlag("--price-in") ?? "") || PRICES[model]?.in || 3.0,
    out: Number(getFlag("--price-out") ?? "") || PRICES[model]?.out || 15.0,
  };
}

// ---------------------------------------------------------------------------
// Provider: OpenAI Chat Completions (raw fetch)
// ---------------------------------------------------------------------------

const openaiProvider = {
  key: "openai",
  available: () => Boolean(process.env.OPENAI_API_KEY?.trim()),
  async runTask(cond, model) {
    const price = priceFor(model);
    const tools = cond.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    const messages = [
      { role: "system", content: SYSTEM },
      { role: "user", content: TASK + apiHint(cond) },
    ];
    let turns = 0;
    let input = 0;
    let output = 0;

    for (let i = 0; i < MAX_TURNS; i++) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model, messages, tools, tool_choice: "auto", max_tokens: 1024 }),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 400)}`);
      const json = await res.json();
      turns++;
      input += json.usage?.prompt_tokens ?? 0;
      output += json.usage?.completion_tokens ?? 0;

      const choice = json.choices?.[0];
      const msg = choice?.message ?? {};
      const calls = msg.tool_calls ?? [];
      if (choice?.finish_reason !== "tool_calls" || calls.length === 0) break;

      messages.push(msg); // assistant turn carrying tool_calls
      for (const tc of calls) {
        let content;
        try {
          const args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
          content = cond.exec(tc.function.name, args);
        } catch (err) {
          content = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
        messages.push({ role: "tool", tool_call_id: tc.id, content });
      }
    }
    const cost = (input / 1e6) * price.in + (output / 1e6) * price.out;
    return { turns, input, output, total: input + output, cost };
  },
};

// ---------------------------------------------------------------------------
// Provider: Anthropic Messages API (raw fetch)
// ---------------------------------------------------------------------------

const anthropicApiProvider = {
  key: "anthropic-api",
  available: () => Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
  async runTask(cond, model) {
    const price = priceFor(model);
    const tools = cond.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
    const messages = [{ role: "user", content: TASK + apiHint(cond) }];
    let turns = 0;
    let input = 0;
    let output = 0;

    for (let i = 0; i < MAX_TURNS; i++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          system: SYSTEM,
          thinking: { type: "disabled" },
          tools,
          messages,
        }),
      });
      if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 400)}`);
      const json = await res.json();
      turns++;
      input += json.usage?.input_tokens ?? 0;
      output += json.usage?.output_tokens ?? 0;

      if (json.stop_reason !== "tool_use") break;
      messages.push({ role: "assistant", content: json.content });
      const results = [];
      for (const block of json.content ?? []) {
        if (block.type !== "tool_use") continue;
        let text;
        let isError = false;
        try {
          text = cond.exec(block.name, block.input);
        } catch (err) {
          text = `Error: ${err instanceof Error ? err.message : String(err)}`;
          isError = true;
        }
        results.push({ type: "tool_result", tool_use_id: block.id, content: text, ...(isError ? { is_error: true } : {}) });
      }
      messages.push({ role: "user", content: results });
    }
    const cost = (input / 1e6) * price.in + (output / 1e6) * price.out;
    return { turns, input, output, total: input + output, cost };
  },
};

// ---------------------------------------------------------------------------
// Provider: Claude CLI (subscription; no API key)
// ---------------------------------------------------------------------------

function findClaude() {
  const probe = spawnSync(process.platform === "win32" ? "where" : "command", [
    ...(process.platform === "win32" ? ["claude"] : ["-v", "claude"]),
  ]);
  if (probe.status === 0) {
    const out = String(probe.stdout).trim().split("\n")[0].trim();
    if (out) return out;
  }
  return "claude";
}

const anthropicCliProvider = {
  key: "anthropic-cli",
  available: () => spawnSync(findClaude(), ["--version"], { encoding: "utf8" }).status === 0,
  async runTask(cond, model) {
    const claude = findClaude();
    // Realize the interface. Fairness: identical minimal --system-prompt for all
    // three, dynamic sections excluded; only the tool surface differs.
    let extra;
    if (cond.cli.kind === "mcp") {
      mkdirSync(OUT_DIR, { recursive: true });
      const cfgPath = join(OUT_DIR, "agent-mcp-config.json");
      writeFileSync(
        cfgPath,
        JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { command: "node", args: [MCP_ENTRY] } } }, null, 2),
      );
      extra = ["--tools", "", "--mcp-config", cfgPath, "--strict-mcp-config", "--allowedTools", MCP_ALLOWED.join(" ")];
    } else {
      extra = ["--tools", "Bash"];
    }

    const args = [
      "-p",
      TASK + "\n\n" + cond.cli.hint,
      "--system-prompt",
      SYSTEM,
      "--exclude-dynamic-system-prompt-sections",
      "--output-format",
      "json",
      "--model",
      model,
      "--permission-mode",
      "bypassPermissions",
      ...extra,
    ];

    const res = spawnSync(claude, args, {
      cwd: PKG_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
    });
    if (res.status !== 0) {
      throw new Error((res.stderr || res.stdout || res.error?.message || "").toString().trim().slice(0, 400));
    }
    const json = JSON.parse(res.stdout);
    const u = json.usage ?? {};
    const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    const output = u.output_tokens ?? 0;
    return {
      turns: json.num_turns ?? null,
      input,
      output,
      total: input + output,
      cost: json.total_cost_usd ?? null, // CLI-provided estimate
    };
  },
};

const PROVIDERS = {
  openai: openaiProvider,
  "anthropic-api": anthropicApiProvider,
  "anthropic-cli": anthropicCliProvider,
};

/** Resolve the provider: explicit --provider wins, else auto-detect. */
function resolveProvider() {
  const explicit = getFlag("--provider");
  if (explicit) {
    const p = PROVIDERS[explicit];
    if (!p) {
      console.error(`Unknown --provider "${explicit}". Options: ${Object.keys(PROVIDERS).join(", ")}.`);
      process.exit(1);
    }
    return p;
  }
  if (openaiProvider.available()) return openaiProvider;
  if (anthropicApiProvider.available()) return anthropicApiProvider;
  return anthropicCliProvider; // subscription fallback
}

// ---------------------------------------------------------------------------
// Table rendering
// ---------------------------------------------------------------------------

function renderTable(rows, placeholder) {
  const num = (v, d) => (v === null || v === undefined ? placeholder : Number(v).toFixed(d));
  const tok = (v) => (v === null || v === undefined ? placeholder : Math.round(Number(v)).toLocaleString("en-US"));
  const usd = (v) => (v === null || v === undefined ? placeholder : `$${Number(v).toFixed(4)}`);

  const header = ["Interface", "Turns", "Input tok", "Output tok", "Total tok", "Cost (USD)"];
  const body = rows.map((r) => [
    r.label,
    num(r.turns, REPEATS > 1 ? 1 : 0),
    tok(r.input),
    tok(r.output),
    tok(r.total),
    usd(r.cost),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)));
  const fmt = (row) => row.map((c, i) => c.padEnd(widths[i])).join(" | ");
  return [fmt(header), widths.map((w) => "-".repeat(w)).join("-+-"), ...body.map(fmt)].join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runCondition(provider, cond, model) {
  const runs = [];
  for (let r = 0; r < REPEATS; r++) {
    process.stdout.write(`→ ${cond.label}${REPEATS > 1 ? ` [${r + 1}/${REPEATS}]` : ""} ... `);
    runs.push(await provider.runTask(cond, model));
    console.log("done");
  }
  const avg = (k) => {
    const vals = runs.map((x) => x[k]).filter((v) => v !== null && v !== undefined);
    return vals.length ? vals.reduce((n, v) => n + v, 0) / vals.length : null;
  };
  return { label: cond.label, turns: avg("turns"), input: avg("input"), output: avg("output"), total: avg("total"), cost: avg("cost") };
}

async function main() {
  for (const [name, p] of [["cli.js", CLI_ENTRY], ["mcp-server.js", MCP_ENTRY], ["axi.js", AXI_ENTRY]]) {
    if (!existsSync(p)) {
      console.error(`Missing ${name} — run \`pnpm build\` first (expected at ${p}).`);
      process.exit(1);
    }
  }

  const provider = resolveProvider();
  const model = getFlag("--model") ?? process.env.CI_DEMO_MODEL ?? DEFAULT_MODEL[provider.key];

  if (!provider.available()) {
    const rows = ["CLI", "MCP", "AXI"].map((label) => ({ label }));
    console.log(
      [
        "",
        `No credentials for provider "${provider.key}".`,
        "",
        "Pick one of:",
        "  --provider openai         (needs OPENAI_API_KEY)      model default gpt-4o-mini",
        "  --provider anthropic-api  (needs ANTHROPIC_API_KEY)   model default claude-sonnet-5",
        "  --provider anthropic-cli  (uses your Claude Code subscription — no key)",
        "",
        "With no --provider, resolution is: OPENAI_API_KEY → openai; else",
        "ANTHROPIC_API_KEY → anthropic-api; else the `claude` CLI (subscription).",
        "",
        `Task  : "${TASK}"`,
        "",
        "Summary table (TODO — fill in by running with credentials):",
        "",
        renderTable(rows, "TODO"),
        "",
      ].join("\n"),
    );
    process.exit(0);
  }

  const cachingNote = provider.key === "anthropic-cli" ? "subscription; cost = CLI estimate" : "no prompt caching";
  console.log(
    `Provider: ${provider.key}   Model: ${model}   Repeats: ${REPEATS}   (${cachingNote})\n`,
  );

  const rows = [];
  for (const cond of conditions()) {
    try {
      rows.push(await runCondition(provider, cond, model));
    } catch (err) {
      console.log(`FAILED (${err instanceof Error ? err.message : String(err)})`);
      rows.push({ label: cond.label });
    }
  }

  console.log(`\nTask: "${TASK}"\n`);
  console.log(renderTable(rows, "n/a"));
  console.log(
    "\n(Fair comparison: minimal shared system prompt, per-interface tools only. " +
      "Tokens are attributable to the interface. Turns + token volume are the robust " +
      "signals; on anthropic-cli the cost column is the CLI's estimate.)",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

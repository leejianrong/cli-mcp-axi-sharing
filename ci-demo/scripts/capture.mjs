// scripts/capture.mjs — serialize each interface's per-call payload for the
// measured task ("list the pipeline runs that are failing", --status failed)
// into out/ so the tokenizer diff has something concrete to count.
//
// Everything is OFFLINE: the MCP/AXI payloads are built by importing the shared
// built core (dist/core.js) and the exported TOOLS (dist/mcp-server.js); the CLI
// and AXI *text* are captured by running the built entry points, exactly as a
// user would on stage. Run directly with node:
//
//   node scripts/capture.mjs cli    → out/cli-output.json
//   node scripts/capture.mjs mcp    → out/mcp-payload.json
//   node scripts/capture.mjs axi    → out/axi-output.txt
//   node scripts/capture.mjs all    → all three (also the default with no arg)
//
// The capture functions are exported so token-diff.mjs can regenerate a missing
// payload without duplicating any logic.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadRuns, filterByStatus } from "../dist/core.js";
import { TOOLS } from "../dist/mcp-server.js";

// The one task measured everywhere.
const STATUS = "failed";

// Resolve paths relative to this module so the script works from any cwd.
const OUT_DIR = fileURLToPath(new URL("../out/", import.meta.url));
const CLI_ENTRY = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const AXI_ENTRY = fileURLToPath(new URL("../dist/axi.js", import.meta.url));

/** Ensure out/ exists, then write a file into it. Returns the absolute path. */
function writeOut(name, contents) {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = fileURLToPath(new URL(name, `file://${OUT_DIR}`));
  writeFileSync(path, contents);
  return path;
}

/**
 * CLI payload: the full verbose JSON the human CLI dumps. Captured by running
 * the built entry point so it is byte-for-byte what the stage command prints.
 */
export function captureCli() {
  const stdout = execFileSync(
    process.execPath,
    [CLI_ENTRY, "list", "--status", STATUS],
    { encoding: "utf8" },
  );
  const path = writeOut("cli-output.json", stdout);
  console.log(`wrote ${path}`);
  return stdout;
}

/**
 * MCP payload: what an MCP client actually loads into context for this task —
 * all six tool definitions (the "schema tax") PLUS one representative tool
 * result (the list_runs result for status=failed: the full run objects, exactly
 * what the tool returns over the wire).
 */
export function captureMcp() {
  const result = filterByStatus(loadRuns(), STATUS);
  const payload = {
    tools: TOOLS,
    sampleCall: { name: "list_runs", arguments: { status: STATUS } },
    result,
  };
  const text = JSON.stringify(payload, null, 2);
  const path = writeOut("mcp-payload.json", text);
  console.log(`wrote ${path}`);
  return text;
}

/**
 * AXI payload: the compact TOON block. Captured by running the built entry
 * point so it matches the on-stage `ci list --status failed` output exactly.
 */
export function captureAxi() {
  const stdout = execFileSync(
    process.execPath,
    [AXI_ENTRY, "list", "--status", STATUS],
    { encoding: "utf8" },
  );
  const path = writeOut("axi-output.txt", stdout);
  console.log(`wrote ${path}`);
  return stdout;
}

/** Run all three captures. */
export function captureAll() {
  captureCli();
  captureMcp();
  captureAxi();
}

// CLI dispatch — only when run as the entry point, so token-diff.mjs can import
// the functions above without triggering a capture.
const isEntry =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isEntry) {
  const subcommand = process.argv[2] ?? "all";
  switch (subcommand) {
    case "cli":
      captureCli();
      break;
    case "mcp":
      captureMcp();
      break;
    case "axi":
      captureAxi();
      break;
    case "all":
      captureAll();
      break;
    default:
      console.error(`unknown subcommand: ${subcommand}`);
      console.error("usage: node scripts/capture.mjs [cli|mcp|axi|all]");
      process.exit(1);
  }
}

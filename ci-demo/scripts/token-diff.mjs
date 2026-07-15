// scripts/token-diff.mjs — the payoff of the demo (Step 4). Counts the tokens
// of the three captured per-call payloads for the task "list the failing runs"
// and prints a comparison table with % savings.
//
// The tokenizer is gpt-tokenizer (pure-JS, fully offline). It is NOT Claude's
// tokenizer — it is a close stand-in, so we present the numbers as an
// approximation and lean on the *relative* differences (direction + magnitude),
// never the third digit.
//
// Reads out/{cli-output.json,mcp-payload.json,axi-output.txt}. If any is
// missing it regenerates it via capture.mjs's exported functions, so a bare
// `node scripts/token-diff.mjs` works from a clean checkout.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { encode } from "gpt-tokenizer";

import { TOOLS } from "../dist/mcp-server.js";
import { captureCli, captureMcp, captureAxi } from "./capture.mjs";

const OUT_DIR = fileURLToPath(new URL("../out/", import.meta.url));

/** Read a captured payload, regenerating it via `capture` if it is missing. */
function readOrCapture(name, capture) {
  const path = fileURLToPath(new URL(name, `file://${OUT_DIR}`));
  try {
    return readFileSync(path, "utf8");
  } catch {
    return capture();
  }
}

/** Count tokens with the approximate (gpt-tokenizer) encoder. */
function countTokens(text) {
  return encode(text).length;
}

/** Right-pad a label with dots to a fixed dotted-leader width. */
function leader(label, width) {
  const dots = Math.max(1, width - label.length);
  return `${label} ${".".repeat(dots)}`;
}

/** Format a token count with thousands separators, right-aligned. */
function fmt(n) {
  return n.toLocaleString("en-US").padStart(6);
}

const mcpText = readOrCapture("mcp-payload.json", captureMcp);
const cliText = readOrCapture("cli-output.json", captureCli);
const axiText = readOrCapture("axi-output.txt", captureAxi);

const mcp = countTokens(mcpText);
const cli = countTokens(cliText);
const axi = countTokens(axiText);

// MCP is the baseline (heaviest); express the others as % savings against it.
const pct = (n, base) => `-${Math.round((1 - n / base) * 100)}%`;

const LABEL_WIDTH = 26;

console.log('Payload tokens for "list failing runs" (gpt-tokenizer, approx):');
console.log(
  `  ${leader(`MCP  (${TOOLS.length} tool schemas + result)`, LABEL_WIDTH)} ${fmt(mcp)}   (baseline)`,
);
console.log(
  `  ${leader("CLI  (verbose JSON)", LABEL_WIDTH)} ${fmt(cli)}   ${pct(cli, mcp)} vs MCP`,
);
console.log(
  `  ${leader("AXI  (TOON, 4 fields, trunc)", LABEL_WIDTH)} ${fmt(axi)}   ${pct(axi, mcp)} vs MCP,  ${pct(axi, cli)} vs CLI`,
);
console.log(
  "\n(gpt-tokenizer approximates Claude's tokenizer — read the relative gaps, not exact counts.)",
);

#!/usr/bin/env node
// @ts-check
/**
 * scripts/validate-recording.mjs — dependency-free structural validator for the
 * agent-run "recording" format (schemaVersion 1). Pure Node built-ins, offline.
 *
 * Usage:
 *   node scripts/validate-recording.mjs <path-to-recording.json>
 *
 * Exits 0 and prints a concise per-interface summary when the file is valid.
 * Exits non-zero and prints every violation (each pointed at its interface
 * label + event seq where relevant) when it is not. The schema is documented in
 * docs/recording_schema.md — this validator is its executable counterpart.
 */

import { readFileSync } from "node:fs";

/** Allowed event types, in the order the schema documents them. */
const EVENT_TYPES = new Set([
  "turn_start",
  "assistant_text",
  "tool_call",
  "tool_result",
  "final",
]);

/** Interface labels that must be present, exactly once each, in this order. */
const REQUIRED_LABELS = ["CLI", "MCP", "AXI"];

/** Collected human-readable problems. Non-empty ⇒ invalid ⇒ exit 1. */
const errors = [];
const err = (msg) => errors.push(msg);

/** True for a plain (non-array, non-null) object. */
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Prefix a message with the interface + seq it belongs to. */
function at(label, seq) {
  return `[${label} seq ${seq}]`;
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/validate-recording.mjs <path-to-recording.json>");
  process.exit(2);
}

let raw;
try {
  raw = readFileSync(path, "utf8");
} catch (e) {
  console.error(`Cannot read file '${path}': ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}

let rec;
try {
  rec = JSON.parse(raw);
} catch (e) {
  console.error(`Invalid JSON in '${path}': ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Top-level shape
// ---------------------------------------------------------------------------

if (!isObject(rec)) {
  console.error("Top level must be a JSON object.");
  process.exit(1);
}

if (rec.schemaVersion !== 1) {
  err(`schemaVersion must be the number 1 (got ${JSON.stringify(rec.schemaVersion)}).`);
}
for (const field of ["provider", "model", "task", "system", "recordedAt"]) {
  if (typeof rec[field] !== "string" || rec[field].length === 0) {
    err(`Top-level "${field}" must be a non-empty string.`);
  }
}
if (typeof rec.recordedAt === "string" && Number.isNaN(Date.parse(rec.recordedAt))) {
  err(`Top-level "recordedAt" is not a parseable ISO 8601 timestamp: ${JSON.stringify(rec.recordedAt)}.`);
}

if (!Array.isArray(rec.interfaces)) {
  err(`Top-level "interfaces" must be an array.`);
} else if (rec.interfaces.length !== 3) {
  err(`Expected exactly 3 interfaces, found ${rec.interfaces.length}.`);
}

// Validate the interface set (labels CLI/MCP/AXI, each present once).
if (Array.isArray(rec.interfaces)) {
  const labels = rec.interfaces.map((i) => (isObject(i) ? i.label : undefined));
  for (const want of REQUIRED_LABELS) {
    const n = labels.filter((l) => l === want).length;
    if (n === 0) err(`Missing required interface with label "${want}".`);
    if (n > 1) err(`Interface label "${want}" appears ${n} times; must be unique.`);
  }
  for (const l of labels) {
    if (l !== undefined && !REQUIRED_LABELS.includes(l)) {
      err(`Unexpected interface label ${JSON.stringify(l)}; allowed: ${REQUIRED_LABELS.join(", ")}.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Per-interface validation
// ---------------------------------------------------------------------------

/** Accumulated per-interface stats for the OK summary. */
const summary = [];

if (Array.isArray(rec.interfaces)) {
  for (let idx = 0; idx < rec.interfaces.length; idx++) {
    const iface = rec.interfaces[idx];
    if (!isObject(iface)) {
      err(`interfaces[${idx}] must be an object.`);
      continue;
    }
    const label = typeof iface.label === "string" ? iface.label : `interfaces[${idx}]`;

    // toolCatalog
    if (!Array.isArray(iface.toolCatalog)) {
      err(`[${label}] "toolCatalog" must be an array.`);
    } else {
      iface.toolCatalog.forEach((t, i) => {
        if (!isObject(t) || typeof t.name !== "string" || typeof t.description !== "string") {
          err(`[${label}] toolCatalog[${i}] must be { name: string, description: string }.`);
        }
      });
    }

    // events
    if (!Array.isArray(iface.events) || iface.events.length === 0) {
      err(`[${label}] "events" must be a non-empty array.`);
      continue;
    }

    let expectedSeq = 0;
    let prevTotal = -1;
    let prevInput = -1;
    let prevOutput = -1;
    let prevTurn = 0;
    let toolCallCount = 0;
    let turnStartCount = 0;
    /** Set of tool_call callIds seen so far, for tool_result matching. */
    const openCallIds = new Set();
    let lastTokens = null;

    for (const ev of iface.events) {
      if (!isObject(ev)) {
        err(`[${label}] an event is not an object.`);
        continue;
      }
      const seq = ev.seq;
      const where = at(label, seq);

      // seq: integer, 0-based, +1 each step
      if (!Number.isInteger(seq)) {
        err(`[${label}] event "seq" must be an integer (got ${JSON.stringify(seq)}).`);
      } else if (seq !== expectedSeq) {
        err(`${where} seq out of order: expected ${expectedSeq}, got ${seq} (must start at 0 and increase by 1).`);
      }
      expectedSeq = (Number.isInteger(seq) ? seq : expectedSeq) + 1;

      // type
      if (!EVENT_TYPES.has(ev.type)) {
        err(`${where} unknown event type ${JSON.stringify(ev.type)}; allowed: ${[...EVENT_TYPES].join(", ")}.`);
      }

      // turn: 1-based integer, non-decreasing
      if (!Number.isInteger(ev.turn) || ev.turn < 1) {
        err(`${where} "turn" must be a 1-based integer (got ${JSON.stringify(ev.turn)}).`);
      } else if (ev.turn < prevTurn) {
        err(`${where} "turn" decreased from ${prevTurn} to ${ev.turn}.`);
      } else {
        prevTurn = ev.turn;
      }

      // tokens: cumulative, total === input+output, monotonic non-decreasing
      const tok = ev.tokens;
      if (!isObject(tok) || typeof tok.input !== "number" || typeof tok.output !== "number" || typeof tok.total !== "number") {
        err(`${where} "tokens" must be { input:number, output:number, total:number }.`);
      } else {
        if (tok.total !== tok.input + tok.output) {
          err(`${where} tokens.total (${tok.total}) must equal input + output (${tok.input} + ${tok.output} = ${tok.input + tok.output}).`);
        }
        if (tok.input < prevInput || tok.output < prevOutput || tok.total < prevTotal) {
          err(`${where} tokens decreased (input ${prevInput}→${tok.input}, output ${prevOutput}→${tok.output}, total ${prevTotal}→${tok.total}); must be monotonic non-decreasing.`);
        }
        prevInput = tok.input;
        prevOutput = tok.output;
        prevTotal = tok.total;
        lastTokens = tok;
      }

      // per-type required fields
      switch (ev.type) {
        case "turn_start":
          turnStartCount++;
          break;
        case "assistant_text":
          if (typeof ev.text !== "string") err(`${where} assistant_text requires a string "text".`);
          break;
        case "tool_call":
          toolCallCount++;
          if (typeof ev.name !== "string" || ev.name.length === 0) err(`${where} tool_call requires a non-empty string "name".`);
          if (!isObject(ev.args)) err(`${where} tool_call "args" must be an object.`);
          if (typeof ev.callId !== "string" || ev.callId.length === 0) err(`${where} tool_call requires a non-empty string "callId".`);
          else openCallIds.add(ev.callId);
          break;
        case "tool_result":
          if (typeof ev.name !== "string" || ev.name.length === 0) err(`${where} tool_result requires a non-empty string "name".`);
          if (typeof ev.callId !== "string" || ev.callId.length === 0) err(`${where} tool_result requires a non-empty string "callId".`);
          else if (!openCallIds.has(ev.callId)) err(`${where} tool_result callId ${JSON.stringify(ev.callId)} has no preceding tool_call.`);
          if (typeof ev.text !== "string") {
            err(`${where} tool_result requires a string "text".`);
          } else if (ev.chars !== ev.text.length) {
            err(`${where} tool_result.chars (${JSON.stringify(ev.chars)}) must equal text.length (${ev.text.length}).`);
          }
          if (typeof ev.isError !== "boolean") err(`${where} tool_result requires a boolean "isError".`);
          break;
        case "final":
          if (typeof ev.text !== "string") err(`${where} final requires a string "text".`);
          break;
      }
    }

    // First event of the interface must open at seq 0 with a turn_start.
    const first = iface.events[0];
    if (isObject(first)) {
      if (first.seq !== 0) err(`[${label}] first event must have seq 0 (got ${JSON.stringify(first.seq)}).`);
      if (first.type !== "turn_start") err(`[${label}] first event must be a turn_start (got ${JSON.stringify(first.type)}).`);
    }

    // totals object
    const totals = iface.totals;
    if (!isObject(totals)) {
      err(`[${label}] "totals" must be an object.`);
    } else {
      for (const f of ["turns", "input", "output", "total", "toolCalls"]) {
        if (typeof totals[f] !== "number") err(`[${label}] totals.${f} must be a number.`);
      }
      if (!(typeof totals.cost === "number" || totals.cost === null)) {
        err(`[${label}] totals.cost must be a number or null.`);
      }
      if (typeof totals.total === "number" && typeof totals.input === "number" && typeof totals.output === "number" && totals.total !== totals.input + totals.output) {
        err(`[${label}] totals.total (${totals.total}) must equal input + output (${totals.input + totals.output}).`);
      }
      if (totals.toolCalls !== toolCallCount) {
        err(`[${label}] totals.toolCalls (${JSON.stringify(totals.toolCalls)}) must equal the number of tool_call events (${toolCallCount}).`);
      }
      if (totals.turns !== turnStartCount) {
        err(`[${label}] totals.turns (${JSON.stringify(totals.turns)}) must equal the number of turn_start events (${turnStartCount}).`);
      }
      // Totals must match the final cumulative token snapshot.
      if (lastTokens && typeof totals.total === "number") {
        for (const f of ["input", "output", "total"]) {
          if (typeof totals[f] === "number" && totals[f] !== lastTokens[f]) {
            err(`[${label}] totals.${f} (${totals[f]}) must equal the last event's cumulative tokens.${f} (${lastTokens[f]}).`);
          }
        }
      }
    }

    summary.push({
      label,
      turns: turnStartCount,
      toolCalls: toolCallCount,
      total: isObject(totals) && typeof totals.total === "number" ? totals.total : NaN,
    });
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (errors.length > 0) {
  console.error(`INVALID: ${path}`);
  console.error(`${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`OK: ${path}`);
console.log(`  schemaVersion ${rec.schemaVersion} · provider ${rec.provider} · model ${rec.model}`);
const pad = (s, n) => String(s).padEnd(n);
console.log(`  ${pad("interface", 10)} ${pad("turns", 6)} ${pad("toolCalls", 10)} total tokens`);
let grand = 0;
for (const s of summary) {
  grand += Number.isFinite(s.total) ? s.total : 0;
  console.log(`  ${pad(s.label, 10)} ${pad(s.turns, 6)} ${pad(s.toolCalls, 10)} ${s.total.toLocaleString("en-US")}`);
}
console.log(`  ${pad("", 10)} ${pad("", 6)} ${pad("", 10)} ${grand.toLocaleString("en-US")} total`);
process.exit(0);

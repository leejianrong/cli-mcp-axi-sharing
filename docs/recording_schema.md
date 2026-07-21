# Recording schema (schemaVersion 1)

A "recording" is the JSON a run of `scripts/agent-run.mjs --record` emits: a
replayable trace of the SAME multi-step task driven three ways — once through the
CLI, once through the MCP server, once through AXI. A frontend reads one file and
replays all three side by side so an audience can watch the per-turn token cost
diverge. This document is the contract between the recorder and that frontend;
`scripts/validate-recording.mjs` is its executable form. If code and prose
disagree, fix the doc.

Everything here is descriptive of a finished run — a recording is written after
the fact, so token counts are cumulative snapshots, not live meters.

## File naming

Recordings live under `ci-demo/recordings/` and are named
`recordings/<provider>-<sanitizedModel>.json`, where `sanitizedModel` is the
model id with every non-alphanumeric run collapsed to a single `-` (e.g.
`gpt-4o-mini` stays `gpt-4o-mini`, `claude-sonnet-5` stays `claude-sonnet-5`).
`sample.json` is the one exception: a hand-authored fixture, not a live capture.

## Top level

```jsonc
{
  "schemaVersion": 1,
  "provider": "openai",          // provider key, e.g. "openai" | "anthropic-api" | "anthropic-cli"
  "model": "gpt-4o-mini",        // the model id the run used
  "task": "…",                   // the shared user task, identical across all three interfaces
  "system": "…",                 // the shared system prompt, identical across all three
  "recordedAt": "2026-07-14T18:32:07Z",  // ISO 8601
  "interfaces": [ <InterfaceRecording>, <InterfaceRecording>, <InterfaceRecording> ]
}
```

`interfaces` always has exactly three entries, one per label, in the order
**CLI, MCP, AXI** — the order the talk presents them.

## InterfaceRecording

```jsonc
{
  "label": "CLI",                // "CLI" | "MCP" | "AXI"
  "toolCatalog": [               // the tools handed to THIS interface
    { "name": "run_ci_cli", "description": "…" }
  ],
  "events": [ <Event>, … ],      // ordered; see the sequencing rules below
  "totals": {
    "turns": 2,                  // == number of turn_start events
    "input": 6810,               // cumulative input tokens for the run
    "output": 214,               // cumulative output tokens
    "total": 7024,               // == input + output, and == the last event's tokens.total
    "cost": 0.001157,            // USD, or null when the provider does not report a cost
    "toolCalls": 1               // == number of tool_call events
  }
}
```

`toolCatalog` is the interface's surface, not a per-call log: CLI and AXI list a
single thin shell tool; MCP lists a representative slice of its ~21-tool catalog.

## Events

Every event carries these four fields, whatever its type:

- `seq` — integer, **0-based**, strictly increasing by exactly 1 within the
  interface (each interface's `events` restarts at `seq: 0`).
- `type` — one of `turn_start`, `assistant_text`, `tool_call`, `tool_result`,
  `final`.
- `turn` — **1-based** turn number, non-decreasing across the interface.
- `tokens` — `{ input, output, total }`, the cumulative token snapshot (see
  below).

### The token-snapshot rule

`tokens` is the **cumulative** usage as of that event, with
`total === input + output`. It is monotonic non-decreasing across the
interface's events — it never goes down. The provider reports usage once per
model response, so the snapshot is **updated once per turn**: every event in a
given turn carries that turn's snapshot, and the value steps up at each new
turn. `totals.input/output/total` equal the last event's snapshot.

### Event types

- `turn_start` — opens a turn. Just the four common fields.
  ```jsonc
  { "seq": 0, "type": "turn_start", "turn": 1, "tokens": { "input": 900, "output": 62, "total": 962 } }
  ```
- `assistant_text` — the model's natural-language text for the turn. Adds
  `text` (string).
- `tool_call` — the model invoking a tool. Adds `name` (string), `args`
  (**object**), `callId` (string, unique per call, referenced by its result).
  ```jsonc
  { "seq": 2, "type": "tool_call", "turn": 1, "tokens": {…},
    "name": "run_ci_cli", "args": { "args": ["list", "--status", "failed"] }, "callId": "call_cli_1" }
  ```
- `tool_result` — the tool's output. Adds `name` (string), `callId` (matches a
  preceding `tool_call`), `text` (string, the raw result), `chars`
  (**=== `text.length`**), `isError` (boolean).
- `final` — the run's closing answer. Adds `text` (string).

### Intra-turn ordering

Within a turn the events appear as:

```
turn_start → (optional assistant_text) → tool_call(s) → tool_result(s)
```

A turn may issue several `tool_call`s before their `tool_result`s; each result's
`callId` ties it back to its call. The **final turn** is the exception: it is
`turn_start → final`, with no tool activity.

## What the validator enforces

`node scripts/validate-recording.mjs <file>` exits non-zero with specific
messages (pointed at the interface label + event `seq`) on any violation, or
prints a per-interface summary and exits 0. It checks: required top-level fields
and types; exactly three interfaces with unique labels CLI/MCP/AXI; each
interface opening at `seq: 0` with a `turn_start`; `seq` increasing by exactly 1;
`type` in the allowed set; `turn` a non-decreasing 1-based integer; `tokens`
present with `total === input + output` and monotonic non-decreasing; per-type
required fields; `tool_call.args` an object; `tool_result.chars === text.length`
with a `callId` matching a prior `tool_call`; and `totals` consistent —
`toolCalls` equal to the count of `tool_call` events, `turns` equal to the count
of `turn_start` events, and `input/output/total` equal to the final cumulative
snapshot.

# recordings/

Replayable JSON traces of the multi-step agent task ("for each failing run,
which job failed and is it flaky/infra or a real regression?") run three ways —
CLI, MCP, AXI — so a frontend can replay all three side by side and show the
per-turn token cost diverge. The format (schemaVersion 1) is documented in
[`docs/recording_schema.md`](../../docs/recording_schema.md).

- **`sample.json`** — a hand-authored fixture, not a live capture. It exists so
  frontend replay work can start before any real run, and it doubles as the
  canonical example for the schema. Its numbers are plausible
  (AXI ≪ CLI ≪ MCP on total tokens), but they are authored, not measured.

- **Real recordings** are produced by the agent-run harness with `--record` and
  land here as `<provider>-<sanitizedModel>.json`, e.g.:

  ```bash
  pnpm agent-run -- --provider openai --record
  ```

  That path calls a real agent and needs credentials — it runs before the talk,
  never on stage (see `CLAUDE.md`).

Validate any recording (fixture or real) with the dependency-free validator:

```bash
node scripts/validate-recording.mjs recordings/sample.json
```

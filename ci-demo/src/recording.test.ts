import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Resolve paths relative to this file so the test is cwd-independent (CI runs it
// from the package root; a local editor may not).
const VALIDATOR = fileURLToPath(new URL("../scripts/validate-recording.mjs", import.meta.url));
const RECORDINGS = fileURLToPath(new URL("../recordings/", import.meta.url));

/** Run the validator on a path. Returns the exit code (0 = valid) and combined output. */
function runValidator(path: string): { code: number; out: string } {
  try {
    const out = execFileSync("node", [VALIDATOR, path], { encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return {
      code: typeof err.status === "number" ? err.status : 1,
      out: `${err.stdout ?? ""}${err.stderr ?? ""}`,
    };
  }
}

// This doubles as CI's guard over the committed recordings: if a recording drifts
// out of schema (or a schema change breaks the validator), `pnpm test` goes red.
describe("validate-recording", () => {
  for (const file of ["openai-gpt-4o.json", "openai-gpt-4o-mini.json", "sample.json"]) {
    it(`accepts the committed recording ${file}`, () => {
      const { code, out } = runValidator(join(RECORDINGS, file));
      expect(out).toContain("OK:");
      expect(code).toBe(0);
    });
  }

  it("rejects a structurally invalid recording with exit 1", () => {
    const bad = join(mkdtempSync(join(tmpdir(), "rec-")), "bad.json");
    // Valid JSON, wrong shape: bad schemaVersion, missing required fields + interfaces.
    writeFileSync(bad, JSON.stringify({ schemaVersion: 2, provider: "x" }));
    const { code, out } = runValidator(bad);
    expect(code).toBe(1);
    expect(out).toContain("INVALID:");
  });

  it("rejects malformed JSON with a non-zero exit", () => {
    const bad = join(mkdtempSync(join(tmpdir(), "rec-")), "bad.json");
    writeFileSync(bad, "{ not valid json");
    expect(runValidator(bad).code).not.toBe(0);
  });
});

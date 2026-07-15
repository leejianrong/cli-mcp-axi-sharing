import { describe, expect, it } from "vitest";
import {
  classifyFailure,
  failingJobs,
  filterByStatus,
  loadRuns,
  runSummary,
  summarize,
  truncate,
} from "./core.js";

describe("core", () => {
  it("loads the 8 seeded runs offline", () => {
    const runs = loadRuns();
    expect(runs).toHaveLength(8);
    expect(runs.every((r) => typeof r.id === "string")).toBe(true);
  });

  it("filters by status", () => {
    const runs = loadRuns();
    expect(filterByStatus(runs, "failed")).toHaveLength(3);
    expect(filterByStatus(runs, "running")).toHaveLength(2);
    expect(filterByStatus(runs, "success")).toHaveLength(3);
    expect(filterByStatus(runs, "cancelled")).toHaveLength(0);
  });

  it("summarizes with success reported as passed", () => {
    expect(summarize(loadRuns())).toBe("8 runs · 3 failed · 2 running · 3 passed");
  });

  it("truncates long text with a size hint and leaves short text alone", () => {
    const long = "x".repeat(1500);
    expect(truncate(long, 120)).toBe(`${"x".repeat(120)}…(1500 chars, use --full)`);
    expect(truncate("short", 120)).toBe("short");
  });

  it("projects a run down to a summary without logs or full jobs", () => {
    const run = loadRuns()[0];
    const s = runSummary(run);
    expect(s).not.toHaveProperty("logs");
    expect(typeof s.jobs).toBe("string"); // a rollup string, not the jobs[] array
    expect(s.jobs).toContain("failed");
    expect(s.id).toBe(run.id);
  });

  it("names the failing jobs of a run", () => {
    const byId = (id: string) => loadRuns().find((r) => r.id === id)!;
    expect(failingJobs(byId("run_8f2a"))).toEqual(["e2e"]);
    expect(failingJobs(byId("run_3d71"))).toEqual(["unit"]);
    expect(failingJobs(byId("run_b90c"))).toEqual(["lint"]);
  });

  it("classifies failures as flaky/infra vs regression from the logs", () => {
    const byId = (id: string) => loadRuns().find((r) => r.id === id)!;
    // run_8f2a: e2e timeout + 502 sandbox → flaky/infra
    expect(classifyFailure(byId("run_8f2a")).classification).toBe("flaky/infra");
    // run_3d71: unit AssertionErrors → regression
    expect(classifyFailure(byId("run_3d71")).classification).toBe("regression");
    // run_b90c: eslint errors → regression
    expect(classifyFailure(byId("run_b90c")).classification).toBe("regression");
    // a passing run is not classified
    expect(classifyFailure(byId("run_2f88")).classification).toBe("unknown");
  });
});

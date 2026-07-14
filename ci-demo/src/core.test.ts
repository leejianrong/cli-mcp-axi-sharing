import { describe, expect, it } from "vitest";
import { filterByStatus, loadRuns, summarize, truncate } from "./core.js";

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
});

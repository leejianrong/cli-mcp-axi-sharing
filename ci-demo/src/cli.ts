import { loadRuns, filterByStatus, runSummary } from "./core.js";

/**
 * The human-shaped CLI (`ci-cli`). This is the deliberately verbose baseline.
 * Two subcommands, both pretty-printed with `JSON.stringify(…, null, 2)` and
 * nothing else — no summary line, no aggregate counts, no per-call next-step hint:
 *   `list [--status <s>]`  dumps an array of run SUMMARIES (id, status, branch,
 *                          trigger, duration, created_at, one-line job rollup) —
 *                          NO logs, NO nested jobs[]. To see why a run failed you
 *                          drill in with `get`.
 *   `get <id>`             dumps the ONE full run object — every field, nested
 *                          jobs[], and the entire log tail.
 *   `--help`               standard usage listing (to stdout) — the ONE discovery
 *                          affordance a real CLI always has.
 * Errors are handled the way a real CLI does: an unknown command or a bad id
 * prints a message to STDERR and exits non-zero — no fallback data dump. An agent
 * that stumbles must recover like a human would (retry, run `--help`, pick a valid
 * command). The agent gets no proactive hand-holding; that bluntness is the point,
 * and AXI's guided affordances look good by contrast later.
 */

const USAGE = [
  "ci-cli — inspect CI pipeline runs",
  "",
  "usage:",
  "  ci-cli list [--status <status>]   list run summaries",
  "  ci-cli get <id>                   full details for one run (jobs + logs)",
  "  ci-cli --help                     show this help",
].join("\n");

/** Hand-rolled flag reader: returns the value after `--name`, or undefined. */
function getFlag(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  if (index === -1 || index === argv.length - 1) return undefined;
  return argv[index + 1];
}

function main(): void {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (command === undefined || command === "--help" || command === "-h") {
    // Standard CLI affordance: usage to stdout, success exit.
    console.log(USAGE);
    return;
  }

  if (command === "get") {
    const id = argv[1];
    const run = id ? loadRuns().find((r) => r.id === id) : undefined;
    if (!run) {
      // Honest failure: real error to stderr, non-zero exit. No data dump.
      process.stderr.write(
        `ci-cli: ${id ? `no run '${id}'` : "get requires an <id>"}. Run 'ci-cli --help' for usage.\n`,
      );
      process.exit(1);
    }
    // The full run object, pretty-printed — jobs[] and the whole log tail.
    console.log(JSON.stringify(run, null, 2));
    return;
  }

  if (command === "list") {
    // Reject stray arguments so a malformed guess (e.g. `list run_8f2a`) errors
    // instead of silently returning the whole list — no silent-success confound.
    const rest = argv.slice(1);
    const stray = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--status") { i++; continue; } // consume the flag + its value
      stray.push(rest[i]);
    }
    if (stray.length) {
      process.stderr.write(`ci-cli: unexpected argument '${stray[0]}'. Run 'ci-cli --help' for usage.\n`);
      process.exit(1);
    }
    const status = getFlag("--status");
    const runs = status ? filterByStatus(loadRuns(), status) : loadRuns();
    // The summary payload, pretty-printed. No logs, no jobs[], no hint.
    console.log(JSON.stringify(runs.map(runSummary), null, 2));
    return;
  }

  // Honest failure on an unknown command: error to stderr, non-zero exit, and
  // NO fallback data — the agent recovers like a human (retry, --help, valid cmd).
  process.stderr.write(`ci-cli: unknown command '${command}'. Run 'ci-cli --help' for usage.\n`);
  process.exit(1);
}

main();

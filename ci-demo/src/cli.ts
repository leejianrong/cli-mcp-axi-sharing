import { loadRuns, filterByStatus } from "./core.js";

/**
 * The human-shaped CLI (`ci-cli`). This is the deliberately verbose baseline:
 * `list --status failed` dumps `JSON.stringify(runs, null, 2)` of the FULL run
 * objects — every field, nested jobs[], and the long log tail. No summary line,
 * no aggregate counts, no next-step hint. The agent has to read all of it, every
 * turn. That verbosity is the point; AXI looks good by contrast later.
 */

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

  if (command !== "list") {
    // Unknown/empty command: brief usage to stderr, then fall back to all runs.
    process.stderr.write("usage: ci-cli list [--status <status>]\n");
  }

  const status = getFlag("--status");
  const runs = status ? filterByStatus(loadRuns(), status) : loadRuns();

  // The whole payload, pretty-printed. No shaping, no summary, no hint.
  console.log(JSON.stringify(runs, null, 2));
}

main();

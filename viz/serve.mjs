// Tiny dependency-free static server for the playback visualizer.
// Serves the REPO ROOT so both /viz/ and /ci-demo/recordings/*.json are reachable.
// Usage:  node viz/serve.mjs [port]   (or PORT=xxxx node viz/serve.mjs)
// Built-ins only — no npm deps, fully offline.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, sep, extname } from "node:path";

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), ".."));
const PORT = Number(process.argv[2] || process.env.PORT || 5173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
};

function contentType(p) {
  return TYPES[extname(p).toLowerCase()] || "application/octet-stream";
}

const server = createServer(async (req, res) => {
  try {
    // Decode + strip query, default to /viz/ so a bare host lands on the player.
    let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    if (urlPath === "/") urlPath = "/viz/";

    // Resolve against ROOT and refuse any path that escapes it (traversal guard).
    let target = normalize(join(ROOT, urlPath));
    if (target !== ROOT && !target.startsWith(ROOT + sep)) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("403 Forbidden");
      return;
    }

    // Directory -> serve its index.html.
    let info;
    try {
      info = await stat(target);
    } catch {
      info = null;
    }
    if (info && info.isDirectory()) {
      target = join(target, "index.html");
    }

    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": contentType(target),
      "cache-control": "no-cache",
    });
    res.end(body);
  } catch (err) {
    const code = err && err.code === "ENOENT" ? 404 : 500;
    res.writeHead(code, { "content-type": "text/plain" });
    res.end(`${code} ${code === 404 ? "Not Found" : "Server Error"}`);
  }
});

server.listen(PORT, () => {
  console.log(`\n  Playback visualizer serving ${ROOT}`);
  console.log(`  Open  ->  http://localhost:${PORT}/viz/\n`);
});

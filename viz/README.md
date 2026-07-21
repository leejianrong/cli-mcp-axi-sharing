# Playback visualizer

A self-contained, offline web player that replays a recorded agent run (the
`ci-demo/recordings/*.json` traces) and races the same task through **CLI**,
**MCP**, and **AXI** side by side — so the token/turn/payload gap is visible at a
glance. Step, play/pause, scrub, and switch between a parallel race and a
sequential walkthrough; each lane shows a live terminal transcript, byte-sized
payload packets, running counters, and its tool surface. No frameworks, no build,
no network.

Run it: `cd ci-demo && pnpm viz`, then open http://localhost:5173/viz/. You can
also drag any recording JSON onto the page (works even from `file://`).

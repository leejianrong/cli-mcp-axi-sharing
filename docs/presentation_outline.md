# Presentation Outline — CLI vs MCP vs AXI

**Working title:** _"Apps Agents Love: CLI vs MCP vs AXI"_
**Duration:** ~25 min talk + ~5 min Q&A · **Audience:** mixed technical (internal) · **Framing:** neutral survey
**Total:** 17 slides. **No live coding** — code lives in snippet slides (8b). The demo is two parts: a *live scripted run* (slides 9–11) of prepped interfaces + tokenizer diff, then a *pre-recorded real-agent run* (slide 12) showing turns/tokens/cost. Live parts have a recorded fallback.

> **How to read this:** each slide has a **layout** suggestion, **talking points** (what you say), and a **timing**. Speaker notes are written so a mixed audience follows without prior AXI knowledge. Jargon gets defined the first time it appears.

---

## Slide 1 — Title (0:45)
- **Layout:** Full-bleed title. Big title, your name/team, date. One-line subtitle: _"How the interface you give an agent decides its cost, speed, and reliability."_
- **Talking points:**
  - Quick framing: "Every team here is wiring AI agents to real systems. Today is about the *interface* between the two — and why that choice quietly dominates your token bill."
  - Promise: "By the end you'll know when to reach for a CLI, when for MCP, and what AXI changes. And we'll build one live."
- **Visual cue:** none needed; keep it clean.

## Slide 2 — Hook: an agent is only as good as the tools you hand it (1:30)
- **Layout:** One sentence centered, then a simple 3-box diagram: **Agent → [ interface ] → Your system**. Highlight the middle box.
- **Talking points:**
  - Define the players in plain terms: an **agent** is an LLM in a loop that can call tools; a **tool** is any way it reaches your system (a command, an API, a function).
  - The middle box is the whole ballgame. Same model, same task — swap the middle box and cost/turns/success swing 2–3×.
  - Tee up the three contenders: CLI, MCP, AXI.
- **Speaker note:** Don't explain AXI yet — just name it as "the new one we'll get to."

## Slide 3 — What "an agent using a tool" actually costs (1:30)
- **Layout:** A loop diagram: model reads context → calls tool → tool returns output → output goes back into context → repeat. Annotate three cost drivers.
- **Talking points:**
  - Three things you pay for every task: **input tokens** (everything the model must read — tool definitions + results), **turns** (round-trips; each one re-sends context), **failures** (retries, or wrong answers).
  - Key insight for later: **tokens are charged per turn**, so a bloated interface is taxed repeatedly, not once.
  - "Hold these three numbers — tokens, turns, success — they're our scorecard for all three approaches."

## Slide 4 — Contender #1: the CLI (2:00)
- **Layout:** Left: a terminal screenshot of a normal CLI dumping verbose JSON. Right: a pros/cons list.
- **Talking points:**
  - CLIs were built **for humans at a terminal**. Agents can shell out and read the text.
  - **Pros:** cheap (no schema tax — the tool isn't "described" up front), universal, composable, works offline.
  - **Cons:** output is human-shaped → agent parses prose/verbose JSON; **action and observation are split** (do a thing, then run another command to see what happened → extra turns); brittle error handling; poor discoverability (agent guesses flags, hits errors).
  - Scorecard: cheap, but reliability suffers (published bench: ~86% success).

## Slide 5 — Contender #2: MCP (2:30)
- **Layout:** Left: diagram of an MCP server exposing N tools, each with a JSON schema, all injected into the model's context. Right: pros/cons.
- **Talking points:**
  - Define **MCP (Model Context Protocol)**: a standard way to expose typed tools to an agent framework. The agent gets a structured menu of tools with schemas.
  - **Pros:** structured I/O, discoverable (schemas advertise what's available), typed arguments, ecosystem momentum.
  - **Cons:** the **schema tax** — every tool's schema is loaded into context, and cost scales with tool count. A browser MCP with ~30 tools can push input to ~185K tokens/task. Lazy-loading schemas (tool search) trades token cost for *more turns* — often a wash or worse.
  - Scorecard: reliable-ish, but **2–3× the cost** of a CLI in the published benchmark ($0.15 vs $0.05/task).
- **Speaker note (for the leads in the room):** "This is the surprising one — the 'more structured' option is often the *more expensive* one."

## Slide 6 — The scorecard so far / the gap (1:30)
- **Layout:** A 2×N table comparing CLI vs MCP on **tokens, cost, turns, success, discoverability**. Leave a blank third column labeled "AXI — ?".
- **Talking points:**
  - CLI: cheap + composable, but human-shaped and unreliable.
  - MCP: structured + discoverable, but token-heavy and turn-heavy.
  - "It reads like a tradeoff — pick cheap *or* reliable. The premise of AXI is that this is a false choice."
- **Transition:** "So what if we designed the interface for the agent from the start?"

## Slide 7 — AXI: it's design principles, not a new protocol (2:00)
- **Layout:** Big statement slide. AXI logo/name. One line: _"AXI = Agent eXperience Interface: agent-native CLI tools that treat token budget as a first-class constraint."_
- **Talking points:**
  - The reframe: the CLI-vs-MCP debate is about the *protocol*. AXI says the real lever is **design discipline**. It's a CLI — but one designed for the agent as the primary user.
  - Goal: "the reliability of MCP (structured, discoverable) at the cost profile of a CLI."
  - It's **10 principles + reference implementations** (GitHub, browser), not a runtime you install.
- **Honesty note to say out loud:** "It's a young, opinionated project and the headline benchmarks are published by its author — treat the *principles* as solid and the *exact numbers* as a strong hypothesis. We'll verify the direction ourselves live."

## Slide 8 — The 10 principles, grouped (2:00)
- **Layout:** Three columns — **Efficiency / Robustness / Discoverability** — each listing its principles as short chips. Highlight the 4 we'll see in action (and show as code on slide 8b) with a colored border.
- **Talking points (skim, don't read all 10):**
  - **Efficiency:** (1) token-efficient output — TOON format, ~40% smaller than JSON; (2) minimal default schemas — 3–4 fields, not 10+; (3) content truncation with a `--full` escape hatch.
  - **Robustness:** (4) pre-computed aggregates (counts/statuses up front, no extra round-trips); (5) definitive empty states ("0 results", not silence); (6) structured errors, exit codes, no interactive prompts.
  - **Discoverability:** (7) ambient context via hooks/skills; (8) content-first (run with no args → live data, not help); (9) contextual next-step suggestions; (10) consistent `--help` everywhere.
  - "We'll see the four highlighted ones — the efficiency cluster plus aggregates — in action on a real app in a minute. First, here's what they look like in code."
- **Define TOON briefly:** "a compact, tabular text encoding — think 'CSV's density with JSON's structure.'"

## Slide 8b — The 4 marquee principles, in code (2:00)
- **Layout:** **Before/after code snippets**, side by side (or stacked). One compact pair per principle — this is the "how" now that we're not typing live. If it's cramped, split into two slides (8b-i efficiency, 8b-ii aggregates+truncation). Syntax-highlighted, ≥18pt.
- **The four transformations (real `axi-sdk-js` APIs):**
  - **P1 Token-efficient output:** `console.log(JSON.stringify(runs, null, 2))` → `console.log(renderOutput({ runs }))` _(TOON, ~40% smaller)_.
  - **P2 Minimal schema:** return the full 10+ field object → `runs.map(r => ({ id, status, branch, logs }))` _(4 fields the task needs)_.
  - **P4 Pre-computed aggregates:** _(nothing)_ → `summary: summarize(all)` → `"8 runs · 3 failed · 2 running · 3 passed"` _(no extra round-trip)_.
  - **P3 Content truncation:** `logs: r.logs` → `logs: full ? r.logs : truncate(r.logs, 120)` + a `--full` flag _(size hint, escape hatch)_.
- **Talking points:**
  - "Four small edits. Each maps to a principle. Watch the output shrink in the demo."
  - Keep it snappy — the audience *reads* code slower than you; point at the one changed line per snippet, don't narrate every token.
- **Speaker note:** these snippets are lifted from the finished `src/axi.ts`; they're real, runnable, and match what the demo runs.

## Slide 9 — Demo setup: one CI app, three interfaces (1:00)
- **Layout:** Diagram: a single `ci` core (pipeline-run data) with three adapters branching off — CLI, MCP, AXI. Note "All three prepped — I'll *run* them."
- **Talking points:**
  - Introduce the app: a tiny, offline **CI/CD pipeline-runs** service — the kind of thing an agent checks constantly ("did the build pass? which runs failed?").
  - Same data, three front doors — all built ahead of time. "I'll run each on the same task — **list the failing runs** — and we'll watch the payload the agent has to read shrink. Those four snippets you just saw are what produced the AXI version."
  - Set expectations: "Three commands and a token count. No debugging — if anything hiccups I'll switch to a recording."

## Slide 10 — [LIVE DEMO — scripted run] (5:00)
- **Layout:** Switch to terminal. Slide is a placeholder ("🎬 Live run") so you're not reading slides. Editor NOT needed — no live coding.
- **Beats (full detail in `live_demo_script.md`):**
  1. Run the CLI → verbose JSON for `list --status failed`. Point out: no summary, no next step, agent reads all of it. (~1 min)
  2. Run the MCP capture → show the 6 tool schemas + result the model must read. Name the schema tax. (~1.5 min)
  3. Run the **finished** AXI command → clean, compact TOON output. Point back to slide 8b: "that's P1–P4 doing their job — summary line, 4 fields, truncated logs, `--full` when needed." (~1 min)
  4. Run the **tokenizer diff** across all three payloads → keep the result on screen for slide 11. (~1 min)
- **Speaker note:** this is a *run*, not a build — narrate the effect, not the typing. If any command wobbles, **cut to the recording** immediately (script has the trigger + timestamps). Don't debug live.

## Slide 11 — Results: the live token diff (1:00)
- **Layout:** Big, bold results table populated from the tokenizer script output (fill in the real numbers after your dry run). Columns: Interface · Payload tokens · vs CLI. Bar chart if the deck supports it.
- **Talking points:**
  - Read the numbers: MCP payload is the heaviest (schemas + verbose result); AXI is the lightest; CLI in between.
  - **Say the honest framing:** "This is the *per-call payload* difference, measured live with an approximate tokenizer — read the *direction and magnitude*. But an agent doesn't call a tool once…"
- **Transition:** "…so what happens across a whole task? Let me show you a real agent doing exactly this."

## Slide 12 — Real agent, our app: the recorded run (2:30)
- **Layout:** Embedded **pre-recorded video** (or GIF) of a genuine agent (Claude) completing "list the failing runs" through each interface, side by side or in sequence. Overlay/caption the live counters: **turns · total tokens · cost**. Below the video, a small summary table of the three runs.
- **Talking points:**
  - "This is not a live agent — it's a recording, so the numbers are stable — but it *is* a real agent doing the real task on the app we just ran."
  - Walk the counters: MCP burns the most tokens *and* the most turns (schema tax charged every round-trip); AXI finishes in fewer turns with far fewer tokens; CLI cheap but wobblier.
  - **The key insight, made concrete:** "Slide 11 was one payload. Here you see it *compound* — tokens are charged per turn, so the per-call gap multiplies across the task."
- **Why pre-recorded (say it):** deterministic, offline, no API/network risk on stage — same reason we recorded it as the demo fallback.
- **Fallback:** if video won't play, show the summary table (static) and narrate.

## Slide 13 — And it holds at scale: published benchmarks (1:30)
- **Layout:** The GitHub benchmark table (from `discovery_notes.md`). Bold the AXI row.
- **Talking points:**
  - Three layers now, zooming out: one payload (slide 11) → one task, real agent (slide 12) → hundreds of runs across 17 tasks (this slide).
  - Headlines: AXI 100% success at ~$0.05/task; MCP variants ~$0.15 (2–3×) and more turns; raw CLI cheap but only ~86% reliable.
- **Honesty note:** these are author-published — but you just watched the *mechanism* live and saw it compound in a real run, which is the reason to trust the direction.

## Slide 14 — So: when do you use what? (2:00)
- **Layout:** Decision guide — a simple flow or a 3-row "reach for X when…" table. This is the payoff of the *neutral survey* framing.
- **Talking points (balanced, no cheerleading):**
  - **Reach for MCP when:** you need a small, stable set of typed tools inside a framework that speaks MCP natively; tool count is low; discoverability matters more than token budget; you're integrating with an existing MCP ecosystem.
  - **Reach for a plain CLI when:** the tool already exists, usage is occasional, or you're composing shell pipelines; token cost isn't your bottleneck.
  - **Apply AXI principles when:** an agent hits the tool *frequently*, tool surface is broad, or token/cost/latency is a real constraint — and you control the tool enough to shape its output. You don't need the AXI project to adopt its ideas; TOON output, minimal schemas, and aggregates are retrofittable to *any* CLI or MCP server.
  - Key line: "AXI isn't 'the winner' — it's a set of habits. Most of them make your MCP server better too."

## Slide 15 — Takeaways + resources (1:00)
- **Layout:** 3 bullets + a resources block (links/QR to axi.md, the repo, TOON).
- **Talking points:**
  - **One:** the interface, not the model, often dominates agent cost — treat token budget as a design constraint.
  - **Two:** structure and thrift aren't opposites — you can be both (that's AXI's whole claim).
  - **Three:** you can start Monday — trim one tool's output to the fields agents actually use and watch turns drop.
  - Point to `discovery_notes.md` sources and the repo in this workspace.

## Slide 16 — Q&A / thanks (0:30 + buffer)
- **Layout:** Thanks + contact + repo link.
- **Anticipated questions (prep answers):**
  - _"Aren't the benchmarks self-published?"_ → Yes; that's why we verified the mechanism live. The direction is robust; treat exact figures as indicative.
  - _"Does TOON hurt readability for humans?"_ → It's for the agent; keep a `--full`/`--json` escape hatch for humans and tooling (principle 3/6).
  - _"Can I get AXI's benefits without leaving MCP?"_ → Mostly yes — minimal schemas, aggregates, truncation all apply to MCP tool results.
  - _"What's the catch?"_ → You have to own and shape the tool; you can't AXI-ify a third-party API you don't control.

---

### Timing summary
| Segment | Slides | Time |
|---|---|---|
| Framing & scorecard | 1–3 | ~3:45 |
| CLI & MCP | 4–6 | ~6:00 |
| AXI thesis, principles & code | 7, 8, 8b | ~6:00 |
| **Live demo (scripted run + tokenizer)** | 9–11 | ~7:00 |
| **Recorded real-agent run** | 12 | ~2:30 |
| Benchmark & guidance | 13–14 | ~3:30 |
| Wrap & Q&A | 15–16 | ~1:30 + buffer |
| **Total** | | **~30:15** |

_Right at 30 min. If you're tight: cut slide 3 to 0:45, compress slide 8 (principles overview) since 8b now carries the detail, and keep the live run tight (~5 min). Protect slides 8b, 10, and 12 — they're the heart of the talk._

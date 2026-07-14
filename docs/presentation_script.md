# Presentation script — Apps agents love: CLI vs MCP vs AXI

**How to use this.** This is a read-off script that runs slide-for-slide with `docs/presentation_outline.md`. Each section gives you the slide number and title, its target timing, brief `[stage directions]` in brackets, and the actual words to say. The spoken parts are written as paragraphs, so read them as prose and let yourself paraphrase. Nothing here needs to be recited word for word. Timings sum to about 30 minutes including the demo; there's a little slack if you keep the middle tight.

**Total speaking budget:** ~30 min (25 talk + ~5 Q&A).

**One-line thesis:** the interface you hand an agent, not the protocol behind it, is the real lever, and design discipline is what wins on tokens, cost, and reliability.

**Demo note:** slides 9–11 are a live scripted *run* of three prepped interfaces plus a tokenizer diff, no live coding. Slide 12 is a **pre-recorded** agent run, played from the deck. If any live command wobbles, cut to the recording and don't debug on stage.

---

## Slide 1 — Title (0:45)

[Title slide up. Keep it clean, don't rush the open.]

Every team in this room is wiring AI agents into real systems right now: into your CI, your ticket tracker, your browser, your internal APIs. And most of the attention goes to the model you pick and the prompt you write. Today I want to talk about the thing in the middle that quietly decides your token bill: the interface between the agent and your system.

By the end you'll have a feel for when to reach for a plain command-line tool, when for MCP, and what this newer idea called AXI actually changes. And we'll run all three side by side on the same little app, so you can watch the difference rather than take my word for it.

## Slide 2 — Hook: an agent is only as good as the tools you hand it (1:30)

[Advance. The three-box diagram: Agent → [ interface ] → Your system. Middle box highlighted.]

Let me define the players in plain terms, because this is a mixed room and I don't want to assume. An **agent** is just a language model running in a loop that's allowed to call tools. It reads some context, decides to do something, does it, reads the result, and goes around again. A **tool** is any way it reaches your system: a shell command, an API call, a function it can invoke. That's it.

So we've got three boxes: the agent on the left, your system on the right, and the interface in the middle. And here's the claim I want to plant now and pay off later. The middle box is the whole ballgame. You can hold the model constant, hold the task constant, and just swap that middle box, and your cost, your number of round-trips, and even whether the agent succeeds at all will swing by two or three times.

There are three contenders for that middle box. A CLI, an MCP server, and the new one, which is called AXI and which I'll get to properly in a bit. For now just hold the name.

## Slide 3 — What "an agent using a tool" actually costs (1:30)

[Advance. Loop diagram: read context → call tool → result back into context → repeat.]

Before we compare them, we need a scorecard, and it comes from how the loop actually charges you. Watch the cycle. The model reads its context, calls a tool, the tool returns some output, and that output gets pasted back into the context for the next round. Then it repeats.

Three things you pay for on every task. First, **input tokens**: everything the model has to read, which means the descriptions of the tools available to it plus every result that comes back. Second, **turns**: the number of round-trips, and this is the one people forget. Third, **failures**: retries when it gets confused, or worse, a confident wrong answer.

Here's the insight that makes the whole talk work, so let it land. Tokens are charged *per turn*. Every round-trip re-sends the context. So if your interface is bloated, you don't pay that bloat once. You pay it again and again, every single turn, for the length of the task. Keep three numbers in your head as we go: tokens, turns, success. That's how we'll score all three.

## Slide 4 — Contender #1: the CLI (2:00)

[Advance. Left: terminal dumping verbose JSON. Right: pros and cons.]

Start with the humble command-line tool, the CLI. These were built for a person sitting at a terminal, and the nice thing is an agent can just shell out and read whatever text comes back, exactly like a human would.

The upside is real. A CLI is cheap, because nothing gets described to the model up front: the tool isn't announced, the agent just runs it. It's universal, it composes with pipes and other tools, and it works offline. If the thing you need already exists as a command, you're mostly done.

The trouble is that the output was shaped for a human. It's prose, or it's verbose JSON meant to be skimmed, and the agent has to wade through all of it. There's a subtler problem too: with a CLI, doing a thing and seeing what happened are usually two separate commands. Run one to act, run another to observe, and every extra command is another turn, which is another full re-read of the context. Errors tend to be messy, and discoverability is poor, so the agent guesses at flags and learns by hitting errors. On the published benchmark we'll come back to, a raw CLI lands around 86% success. Cheap, but it drops tasks.

## Slide 5 — Contender #2: MCP (2:30)

[Advance. Left: MCP server exposing N tools, each schema injected into context. Right: pros and cons.]

The second contender is MCP, the Model Context Protocol. It's a standard way to hand an agent a set of typed tools, and the agent gets a structured menu: here are the tools, here's what each one takes, here's what each returns. It's become the default way people plug agents into systems, and for good reason.

The good is genuinely good. The inputs and outputs are structured rather than free text. The tools are discoverable, because their schemas advertise what's on offer, so the agent isn't guessing. Arguments are typed. And there's real ecosystem momentum behind it.

But there's a cost, and it's the surprising part. Every tool's schema, its name, its description, its parameters, gets loaded into the model's context so the agent knows the menu. And that cost scales with the number of tools. A browser MCP server exposing around thirty tools can push a single task up toward a hundred and eighty-five thousand input tokens. You can try to be clever and load the schemas lazily, only fetching a tool's definition when it's needed. But that just trades token cost for more turns, more round-trips to go look things up, and it often comes out a wash or worse.

[For the leads in the room, slow down here.]

So here's the thing worth saying plainly, especially to the folks thinking about budget. On that same benchmark, MCP is two to three times the cost of the CLI: about fifteen cents a task against five. The more structured option is often the more expensive one.

## Slide 6 — The scorecard so far / the gap (1:30)

[Advance. Two-column table, CLI vs MCP, on tokens/cost/turns/success/discoverability. Third column blank: "AXI — ?".]

So where does that leave us. The CLI is cheap and composable, but it's human-shaped and it isn't reliable enough. MCP is structured and discoverable, but it's heavy on tokens and heavy on turns. Look at the table and it reads like a straight tradeoff: pick cheap, or pick reliable, one or the other.

That framing is exactly what the third column challenges. The whole premise of AXI is that this is a false choice, that you don't actually have to trade one for the other. So the obvious question is: what if we designed the interface for the agent from the start, instead of handing it something built for a human or something built for a protocol?

## Slide 7 — AXI: it's design principles, not a new protocol (2:00)

[Advance. Statement slide. "AXI = Agent eXperience Interface: agent-native CLI tools that treat token budget as a first-class constraint."]

Here's the reframe. The CLI-versus-MCP argument is really an argument about the protocol, about the plumbing. AXI, the Agent eXperience Interface, says the protocol isn't where the real lever sits. The lever is design discipline. And in practice AXI *is* a CLI, just one built with the agent as the primary user, not the human.

The goal it sets itself is to get the reliability of MCP, that structure and discoverability, at the cost profile of a CLI. Both, not one or the other. And concretely it's ten design principles plus a couple of reference implementations: one for GitHub, one for the browser. It's not a runtime you install or a framework you adopt. It's a set of habits with worked examples.

[Say this part out loud, don't skip it — the internal audience will be looking for it.]

I want to be honest about what this is, because you'll wonder. AXI is young and it's opinionated, and the headline benchmark numbers are published by the project's own author. So treat the principles as solid engineering (they'll make sense as we go through them) and treat the exact numbers as a strong hypothesis rather than gospel. The good news is we're going to verify the direction ourselves, live, in a few minutes.

## Slide 8 — The 10 principles, grouped (2:00)

[Advance. Three columns: Efficiency / Robustness / Discoverability. The four we'll demo have a coloured border. Skim — do not read all ten.]

The ten principles sort into three buckets, and I'll skim rather than march through every one.

The first bucket is **efficiency**, about what the agent has to read. Token-efficient output, using a format called TOON that's roughly forty percent smaller than the equivalent JSON. Minimal default schemas: return the three or four fields the task needs, not the ten-plus fields your database happens to have. And content truncation, so long fields get cut down with a `--full` flag as the escape hatch when you really do want everything.

The second bucket is **robustness**, about the agent not getting stuck. Pre-computed aggregates, so counts and statuses come back up front and the agent doesn't spend a round-trip working them out. Definitive empty states, so a query with no results says "zero results" rather than returning silence the agent has to interpret. And structured errors with real exit codes and no interactive prompts, because an agent can't answer a "are you sure? [y/n]".

The third is **discoverability**, about the agent finding its way. Ambient context through hooks and skills, a content-first default so running the tool bare gives you live data instead of a help screen, contextual hints about the next step, and consistent `--help` everywhere.

The four with the coloured border (the efficiency cluster plus aggregates) are the ones we'll watch run on a real app shortly. And one definition before we look at code: **TOON** is a compact, tabular text encoding. Think the density of CSV with the structure of JSON. First, here's what these four look like as code.

## Slide 8b — The 4 marquee principles, in code (2:00)

[Advance. Before/after snippets, side by side. Point at the one changed line per pair — don't narrate every token. The room reads code slower than you talk.]

Four small edits, each one a principle. I'll point at the line that matters and move on.

Principle one, token-efficient output. Before, we serialise the runs to pretty-printed JSON. After, one call: `renderOutput`. It encodes to TOON under the hood, and that alone is about forty percent smaller.

Principle two, minimal schema. Before, we hand back the whole run object, every field it has. After, we map it down to the four fields the task actually needs: id, status, branch, logs.

Principle four, pre-computed aggregates. Before, there's nothing: the agent would have to count for itself. After, one line adds a summary ("eight runs, three failed, two running, three passed"), computed up front, no extra round-trip.

And principle three, content truncation. Before, we dump the full log. After, we truncate it to a preview with a size hint, and add a `--full` flag for when someone wants the whole thing. Nothing is hidden, it's just deferred.

That's the entire diff. Four edits. Watch the output shrink when we run it.

## Slide 9 — Demo setup: one CI app, three interfaces (1:00)

[Advance. Diagram: one `ci` core, three adapters — CLI, MCP, AXI. "All three prepped — I'll run them."]

Here's the app. It's a tiny, fully offline CI/CD service for pipeline runs, the kind of thing an agent checks all day long. Did the build pass? Which runs are failing? What broke? There are eight seeded runs in there: three failed, two running, three passed.

Same data, three front doors, all built ahead of time. I'm going to run each one on the exact same task (list the failing runs), and we'll watch the payload the agent has to read shrink as we go. And those four code edits you just saw are literally what produced the AXI version.

To set expectations: this is three commands and a token count, not a debugging session. If anything hiccups, I'll switch straight to a recording of this same run rather than fix it on stage.

## Slide 10 — Live demo: the scripted run (5:00)

[Switch to the terminal. Slide is just a "live run" placeholder so you're not reading off it. No editor needed. Clear the screen before each step.]

[Step 1 — the CLI. ~1 min. Type:]

```bash
ci-cli list --status failed
```

[A wall of pretty-printed JSON scrolls past — three full run objects, nested jobs, long logs.]

This is a normal CLI, the kind built for a person who'll skim it. But the agent can't skim: it has to read all of this, every turn. And notice what's missing: there's no summary, and no hint about what to do next. If the agent wants a count of how many failed, that's another command, which is another turn, which is another full re-read.

[Capture it for the diff:]

```bash
node scripts/capture.mjs cli
```

[Step 2 — the MCP payload. ~1.5 min. Type:]

```bash
node scripts/capture.mjs mcp
cat out/mcp-payload.json | head -40
```

[Six tool schemas plus one result. Let the room see the wall, then say "…and it continues" rather than scrolling forever.]

This is what MCP puts in front of the model. Six tools, each with a full schema (parameters, types, descriptions), and then the actual result at the end. The structure and the discoverability are genuinely useful; the agent knows exactly what it can do. But this whole menu gets loaded into context, and it's charged every single turn. Six tools here. Real servers ship thirty. That's the schema tax, and you can see it.

[Step 3 — the finished AXI command. ~1 min. Keep slide 8b one click away. Type:]

```bash
ci list --status failed
ci list --status failed --full
```

[A tight TOON block: a summary line, then the failing runs with just id, status, branch, and a truncated logs field. The --full run expands the logs.]

Same data, same task. This is the four principles doing their job. That top line is a pre-computed summary, so the agent never burns a turn counting: principle four. Four fields instead of ten: principle two. The logs are truncated with a size hint (principle three), and here's the escape hatch, `--full`, which expands them when you actually need them. And the whole thing is encoded in TOON, about forty percent smaller than the JSON: principle one. [Point back at slide 8b.] That's the diff from a moment ago, running.

[Capture for the diff:]

```bash
ci list --status failed > out/axi-output.txt
```

[Step 4 — the token diff. ~1 min. Type:]

```bash
node scripts/token-diff.mjs
```

[The three payload numbers come up. Leave them on screen for slide 11.]

And there's the payoff. Same task, three payloads, counted with a tokenizer. Hold that thought. I'll read the numbers properly on the next slide.

[If any command errors or hangs past about five seconds, stop and say: "Let me switch to a capture of this exact run so we don't waste your time," then play the recording from the noted timestamp. Narrate over it exactly as you would live. Don't debug.]

## Slide 11 — Results: the live token diff (1:00)

[Advance to the results table. Read the numbers off it.]

Here are the numbers we just generated. MCP is the heaviest at two thousand six hundred and fifty-five tokens: six schemas plus a verbose result. The CLI comes in at one thousand three hundred and fifty-eight, that's 49% below MCP, so about half. And AXI is two hundred and thirty-six, ninety-one percent below MCP, and eighty-three percent below the CLI.

[Say the honest framing plainly. This is the line the room will remember you for.]

One caveat, stated up front. This is the per-call payload difference, measured with an approximate tokenizer. It's close to Claude's but not identical. So read the direction and the magnitude, not the third digit. The shape is what's real.

And one honest aside, because a sharp lead will ask. Notice the CLI is only about half of MCP here, not the tiny fraction you might have expected. That's because our server ships just six tools. The schema tax scales with tool count: a real server with thirty tools pushes MCP far higher and opens that gap right up. AXI's ninety-one percent barely moves either way. But this is still one call. An agent never calls a tool just once, so what happens across a whole task?

## Slide 12 — Real agent, our app: the recorded run (2:30)

[Advance. Play the pre-recorded agent video. Counters on screen: turns · total tokens · cost. Summary table below.]

[Say this out loud so it's never mistaken for sleight of hand.]

This is a recording, not a live agent. But it *is* a genuine agent, Claude, doing the real task on the same app we just ran, three times, once through each interface. It's recorded for one reason: the numbers stay stable, and there's no network or API risk on stage. Same model, same task, same app: the only thing that changes is the interface, which is exactly the variable we care about.

[Walk the counters as they move. Point at the on-screen table for the figures.]

Watch what compounds. MCP re-reads that big schema menu every turn, and it takes more turns to get there, so it burns the most tokens and the most round-trips. AXI finishes in the fewest turns with a fraction of the tokens. The CLI is cheap but wobblier: it gets there, but less reliably.

[TODO: fill the three numbers — turns / total tokens / cost per interface — once `node scripts/agent-run.mjs` has been run from `ci-demo/`. Read them off the on-screen table rather than from memory; expect the same shape as the published benchmark on slide 13 (MCP heaviest on turns and tokens, AXI lowest on both). Do not invent figures.]

The point is right there in the table. Slide 11 was a single payload. Here you see it compound: because tokens are charged per turn, that per-call gap multiplies across the whole task. That's the mechanism, running end to end.

[If the video won't play, show the static summary table and narrate it. Never troubleshoot playback live.]

## Slide 13 — And it holds at scale: published benchmarks (1:30)

[Advance. The GitHub benchmark table, AXI row bold.]

Now zoom out. We've gone through three layers: one payload on slide 11, one full task with a real agent on slide 12, and now hundreds of runs across seventeen tasks here.

The headlines from the GitHub benchmark: eighty-five runs per condition, Claude Sonnet. AXI: a hundred percent success at about five cents a task, three turns. MCP with schemas loaded eagerly: about fifteen cents, six turns, and it's pulling a hundred and seventy-five thousand input tokens per task against AXI's forty-six thousand. The raw CLI is cheap, roughly the same nickel, but only around 86% reliable. The browser benchmark tells the same story across nearly five hundred runs.

[Honesty note again.]

These are author-published numbers, same caveat as before. But you just watched the mechanism live, and you watched it compound in a real run. That's the reason to trust the direction, even if you'd want to reproduce the exact figures yourself.

## Slide 14 — So: when do you use what? (2:00)

[Advance. Decision guide — a simple "reach for X when…" table. This is the payoff of the neutral framing, so stay balanced.]

So let me not turn this into a sales pitch, because it isn't one. Here's how I'd actually decide.

Reach for MCP when you've got a small, stable set of typed tools and you're inside a framework that already speaks MCP, when your tool count is low, and when discoverability matters to you more than the token budget. If you're plugging into an existing MCP ecosystem, that pull is real and it's fine to follow it.

Reach for a plain CLI when the tool already exists, when the agent only hits it occasionally, or when you're stringing together shell pipelines and token cost simply isn't your bottleneck. Don't over-engineer something you touch twice a day.

Apply the AXI principles when an agent hits the tool *frequently*, when the tool surface is broad, or when token, cost, or latency is a real constraint you're feeling, and when you own the tool enough to shape its output. And here's the part I'd underline: you don't need the AXI project to get the benefit. TOON output, minimal schemas, pre-computed aggregates all retrofit onto any CLI you own, and onto your MCP server results too.

AXI isn't "the winner" here. It's a set of habits, and most of them make your MCP server better as well.

## Slide 15 — Takeaways + resources (1:00)

[Advance. Three points plus a resources block — links or a QR to axi.md, the repo, TOON.]

Three things to take away. The first: the interface, not the model, often dominates what an agent costs you, so treat the token budget as a design constraint from the start, the way you'd treat latency or memory. The second: structure and thrift aren't opposites. You can have both, and that's really AXI's whole claim in one line. And the third, the practical one: you can start Monday. Pick one tool an agent hits often, trim its output down to the fields the agent actually uses, and watch the turns drop. That's it. That's the whole move.

The sources are on screen: the discovery notes with all the benchmark references, the repo here in the workspace, and the TOON format. Everything we ran is reproducible.

## Slide 16 — Q&A / thanks (0:30 + buffer)

[Advance. Thanks, contact, repo link. Open the floor.]

That's the talk. Thank you. The repo and the sources are up here if you want to reproduce any of the numbers, and I'm happy to take questions.

[Prepared answers for the likely ones:]

[If asked "aren't the benchmarks self-published?" — Yes, they are, and that's exactly why we verified the mechanism live today. The direction is solid; treat the precise figures as indicative and reproduce them if you need to.]

[If asked "does TOON hurt readability for humans?" — It's built for the agent, not for you. Keep a `--full` or `--json` escape hatch for humans and for tooling, and you lose nothing.]

[If asked "can I get AXI's benefits without leaving MCP?" — Mostly yes. Minimal schemas, aggregates, and truncation all apply directly to your MCP tool results.]

[If asked "what's the catch?" — You have to own and shape the tool. You can't AXI-ify a third-party API you don't control — the output isn't yours to change.]

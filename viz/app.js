/* ============================================================
   Agent-run playback visualizer — vanilla JS, no deps, offline.

   Playback model: a single integer CURSOR = number of revealed events.
   render() redraws deterministically from events[0 .. cursor-1].
     - Race mode:  one global cursor K over max lane length; each lane
                   reveals min(K, itsLength) events, so light lanes finish
                   while MCP keeps drilling.
     - Sequential: one lane at a time, its own local cursor; play advances
                   to the next lane when the current one finishes.
   Animation = CSS transitions triggered by state changes; a transient
   "flying packet" fires only on a forward step (not on scrub).
   ============================================================ */

const LABELS = ["CLI", "MCP", "AXI"];
const ACCENT = { CLI: "cli", MCP: "mcp", AXI: "axi" };
const ORD = ["1st", "2nd", "3rd"]; // race finish ranks (only three lanes)
// tool name -> shell binary, for rendering CLI/AXI calls as "$ ..."
const BIN = { run_ci_cli: "ci-cli", run_ci: "ci" };
// Two exhibits (+ the dev fixture). Both models reach the right answer on all three
// interfaces — the story is cost, not correctness. gpt-4o is the clean headline;
// gpt-4o-mini shows how a blunt interface taxes a weaker model: the CLI makes it
// thrash for many turns to get to the same answer AXI reaches in one call.
const BUNDLED = [
  {
    file: "openai-gpt-4o.json",
    label: "gpt-4o · capable model",
    note: "Capable model — all three reach the right answer, so the gap is pure token cost: MCP's schema tax dominates, AXI is leanest, CLI sits in between.",
  },
  {
    file: "openai-gpt-4o-mini.json",
    label: "gpt-4o-mini · small model",
    note: "Small model — still correct on all three, but the blunt CLI makes it thrash: 10 turns and 21 tool calls to land the answer AXI reaches in 3 turns and one call.",
  },
  {
    file: "sample.json",
    label: "sample · fixture",
    note: "Hand-authored fixture used for development.",
  },
];

const state = {
  data: null,
  mode: "race",       // "race" | "seq"
  raceCursor: 0,      // 0 .. maxLen
  seqLane: 0,         // active lane index in sequential mode
  seqLocal: 0,        // 0 .. len(activeLane)
  speed: 1,
  playing: false,
  timer: null,
  maxChars: 1,        // payload-size normalization across ALL events
  expanded: new Set(),// keys of expanded tool_result blocks
  built: false,       // whether lane DOM shells exist for current mode+data
};

const $ = (sel, root = document) => root.querySelector(sel);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- lane / cursor helpers ---------- */
const lanes = () => state.data.interfaces;
const laneLen = (i) => lanes()[i].events.length;
const maxLen = () => Math.max(...lanes().map((_, i) => laneLen(i)));

// current cursor + its ceiling for whichever mode is active
function cursor() { return state.mode === "race" ? state.raceCursor : state.seqLocal; }
function cursorMax() { return state.mode === "race" ? maxLen() : laneLen(state.seqLane); }

// events revealed for lane i given the current cursor
function revealed(i) {
  const ev = lanes()[i].events;
  if (state.mode === "race") return ev.slice(0, Math.min(state.raceCursor, ev.length));
  if (i !== state.seqLane) return [];
  return ev.slice(0, state.seqLocal);
}

// cumulative token bucket for lane i at the cursor (zeros before its first event).
// Single source of truth so the lane counter, its meter, and the scoreboard agree.
function laneTokens(i) {
  const ev = revealed(i);
  return ev.length ? ev[ev.length - 1].tokens : { input: 0, output: 0, total: 0 };
}

/* ---------- payload sizing (sqrt scale so fat dumps & slivers both read) ---------- */
function sizePx(chars, maxWidth) {
  const min = 8;
  const max = Math.max(min + 4, maxWidth);
  const t = Math.sqrt(chars) / Math.sqrt(state.maxChars || 1);
  return Math.round(min + t * (max - min));
}

/* ---------- command rendering ---------- */
function isShell(args) { return args && Array.isArray(args.args); }
function cmdHtml(ev) {
  if (isShell(ev.args)) {
    const bin = BIN[ev.name] || ev.name;
    const parts = ev.args.args.map((a) => esc(a)).join(" ");
    return `<span class="prompt">$</span> <span class="fn">${esc(bin)}</span> <span class="arg">${parts}</span>`;
  }
  // MCP-style: name(k=v, ...)
  const kv = Object.entries(ev.args || {})
    .map(([k, v]) => `${esc(k)}=<span class="arg">${esc(typeof v === "string" ? v : JSON.stringify(v))}</span>`)
    .join(", ");
  return `<span class="fn">${esc(ev.name)}</span>(${kv})`;
}

/* ============================================================
   Build lane shells (once per mode/data change)
   ============================================================ */
function buildStage() {
  const stage = $("#stage");
  stage.className = "stage " + state.mode;
  stage.innerHTML = "";
  const idxs = state.mode === "race" ? [0, 1, 2] : [state.seqLane];
  for (const i of idxs) stage.appendChild(buildLane(i));
  state.built = true;
}

function buildLane(i) {
  const iface = lanes()[i];
  const acc = ACCENT[iface.label];
  const el = document.createElement("article");
  el.className = "lane";
  el.dataset.lane = i;
  el.style.setProperty("--accent", `var(--${acc})`);
  el.style.setProperty("--accent-ink", `var(--${acc}-ink)`);
  el.style.setProperty("--accent-wash", `var(--${acc}-wash)`);
  const nTools = iface.toolCatalog.length;
  const solo = nTools === 1;
  el.innerHTML = `
    <div class="lane-head">
      <span class="lane-tag">${esc(iface.label)}</span>
      <span class="lane-sub">${solo ? "1 tool" : nTools + " tools"} · ${iface.totals.turns} turns end-state</span>
      <span class="lane-flag">finished</span>
    </div>
    <div class="counters">
      <div class="counter"><div class="k">turns</div><div class="v" data-c="turns">0</div></div>
      <div class="counter"><div class="k">tool calls</div><div class="v" data-c="calls">0</div></div>
      <div class="counter tok"><div class="k">tokens</div><div class="v" data-c="total">0</div><div class="sub" data-c="io">in 0 · out 0</div></div>
    </div>
    <div class="tokmeter">
      <div class="tm-label"><span>cumulative tokens</span><span data-c="tmnum">0</span></div>
      <div class="tm-track"><div class="tm-fill" data-c="tmfill"></div></div>
    </div>
    <div class="toolwall">
      <div class="tw-head"><span>tool surface</span><span data-c="twused">0 / ${nTools} used</span></div>
      <div class="tw-grid">${iface.toolCatalog.map((t) => `<span class="tw-chip${solo ? " solo" : ""}" data-tool="${esc(t.name)}" title="${esc(t.description)}">${esc(t.name)}</span>`).join("")}</div>
    </div>
    <div class="channel">
      <div class="node agent"><span class="dot"></span>agent</div>
      <div class="wire"></div>
      <div class="node tool"><span class="dot"></span>tool</div>
    </div>
    <div class="ledger">
      <div class="lg-head"><span>returned payload</span><span data-c="lgtot">0 chars</span></div>
      <div class="lg-bars"></div>
    </div>
    <div class="transcript"></div>`;
  return el;
}

/* ============================================================
   Render (deterministic from cursor)
   ============================================================ */
function render() {
  // transport
  const max = cursorMax();
  const cur = cursor();
  const scrub = $("#scrub");
  scrub.max = String(max);
  scrub.value = String(cur);
  $("#pos").innerHTML = `<b>${cur}</b> / ${max} events`;
  $("#playbtn").textContent = state.playing ? "⏸" : "▶";
  $("#playbtn").classList.toggle("play", true);
  $("#lanetabs").classList.toggle("show", state.mode === "seq");
  $("#modeRace").setAttribute("aria-pressed", state.mode === "race");
  $("#modeSeq").setAttribute("aria-pressed", state.mode === "seq");

  const idxs = state.mode === "race" ? [0, 1, 2] : [state.seqLane];
  for (const i of idxs) renderLane(i);
  renderScoreboard();
}

/* ============================================================
   Token scoreboard — three interfaces on ONE shared scale so the
   ~16× gap reads at a glance. Bars/counts stay in lockstep with the
   lanes: race mode uses the same laneTokens(i) each counter shows;
   sequential mode falls back to end-state totals (only one lane plays,
   so a live race isn't meaningful there).
   ============================================================ */
function buildScoreboard() {
  const min = Math.min(...lanes().map((l) => l.totals.total)) || 1;
  $('[data-c="rows"]', $("#scoreboard")).innerHTML = lanes().map((l, i) => {
    const acc = ACCENT[l.label];
    const mult = l.totals.total / min; // end-state ratio → stable during playback
    const multStr = mult <= 1.0001 ? "1×" : mult.toFixed(1) + "×";
    return `<div class="sb-row" data-lane="${i}" style="--accent:var(--${acc});--accent-ink:var(--${acc}-ink)">
      <span class="sb-tag">${esc(l.label)}</span>
      <div class="sb-track"><div class="sb-fill"></div></div>
      <span class="sb-mult" title="vs. the leanest interface">${multStr}</span>
      <span class="sb-num" data-c="sbnum">0</span>
    </div>`;
  }).join("");
}

function renderScoreboard() {
  const race = state.mode === "race";
  const scaleMax = Math.max(...lanes().map((l) => l.totals.total)) || 1;
  const board = $("#scoreboard");
  board.classList.toggle("finals", !race);
  $('[data-c="note"]', board).textContent = race ? "shared scale" : "end-state totals";
  lanes().forEach((l, i) => {
    const row = $(`.sb-row[data-lane="${i}"]`, board);
    if (!row) return;
    const val = race ? laneTokens(i).total : l.totals.total;
    $(".sb-fill", row).style.width = (100 * val / scaleMax).toFixed(1) + "%";
    $('[data-c="sbnum"]', row).textContent = val.toLocaleString();
  });
}

function renderLane(i) {
  const laneEl = $(`.lane[data-lane="${i}"]`);
  if (!laneEl) return;
  const iface = lanes()[i];
  const ev = revealed(i);
  const done = state.mode === "race" ? state.raceCursor >= laneLen(i) : state.seqLocal >= laneLen(i);
  const finished = done && ev.length > 0;
  laneEl.classList.toggle("done", finished);

  // finish drama (race only): rank finished lanes, settle them, and pulse a lane
  // that is still running once at least one rival has crossed the line.
  const flag = $(".lane-flag", laneEl);
  if (state.mode === "race" && finished) {
    // shorter lanes finish first; ties share a rank (competition ranking).
    const rank = 1 + lanes().filter((_, j) => laneLen(j) < laneLen(i)).length;
    flag.innerHTML = `finished <span class="lane-rank">· ${ORD[rank - 1] || rank + "th"}</span>`;
  } else {
    flag.textContent = "finished";
  }
  const anyDone = state.mode === "race" &&
    lanes().some((l) => l.events.length > 0 && state.raceCursor >= l.events.length);
  laneEl.classList.toggle("resting", state.mode === "race" && finished);
  laneEl.classList.toggle("running", state.mode === "race" && !done && ev.length > 0 && anyDone);

  // counters
  const turns = ev.filter((e) => e.type === "turn_start").length;
  const calls = ev.filter((e) => e.type === "tool_call").length;
  const tok = laneTokens(i);
  $('[data-c="turns"]', laneEl).textContent = turns;
  $('[data-c="calls"]', laneEl).textContent = calls;
  $('[data-c="total"]', laneEl).textContent = tok.total.toLocaleString();
  $('[data-c="io"]', laneEl).textContent = `in ${tok.input.toLocaleString()} · out ${tok.output.toLocaleString()}`;

  // token meter (shared max across the three totals)
  const gmax = Math.max(...lanes().map((l) => l.totals.total)) || 1;
  $('[data-c="tmnum"]', laneEl).textContent = tok.total.toLocaleString();
  $('[data-c="tmfill"]', laneEl).style.width = (100 * tok.total / gmax).toFixed(1) + "%";

  // tool wall — light called tools
  const used = new Set(ev.filter((e) => e.type === "tool_call").map((e) => e.name));
  laneEl.querySelectorAll(".tw-chip").forEach((c) => c.classList.toggle("lit", used.has(c.dataset.tool)));
  $('[data-c="twused"]', laneEl).textContent = `${used.size} / ${iface.toolCatalog.length} used`;

  // ledger — persistent bars for each revealed tool_result
  const results = ev.filter((e) => e.type === "tool_result");
  const bars = $(".lg-bars", laneEl);
  const laneW = Math.max(120, laneEl.clientWidth - 130);
  bars.innerHTML = results.length
    ? results.map((r) => `<div class="lg-row"><div class="lg-bar${r.isError ? " err" : ""}" style="width:${sizePx(r.chars, laneW)}px" title="${esc(r.name)} — ${r.chars} chars"></div><span class="lg-chars">${r.chars.toLocaleString()}</span></div>`).join("")
    : `<span class="lg-empty">no payload yet</span>`;
  const lgTot = results.reduce((s, r) => s + r.chars, 0);
  $('[data-c="lgtot"]', laneEl).textContent = lgTot.toLocaleString() + " chars";

  // transcript
  $(".transcript", laneEl).innerHTML = transcriptHtml(i, ev);
  bindExpanders(laneEl, i);
  const tr = $(".transcript", laneEl);
  tr.scrollTop = tr.scrollHeight;
}

function transcriptHtml(i, ev) {
  const label = lanes()[i].label;
  if (!ev.length) return `<div class="t-empty">Press play or step to begin ${esc(label)}.</div>`;
  let html = "";
  for (const e of ev) {
    if (e.type === "turn_start") {
      html += `<div class="t-turn">turn ${e.turn}</div>`;
    } else if (e.type === "assistant_text") {
      html += e.text && e.text.trim()
        ? `<div class="t-say"><span class="who">agent</span> ${esc(e.text)}</div>`
        : `<div class="t-say think">agent is thinking…</div>`;
    } else if (e.type === "tool_call") {
      html += `<div class="t-cmd">${cmdHtml(e)}</div>`;
    } else if (e.type === "tool_result") {
      html += resultHtml(label, e);
    } else if (e.type === "final") {
      html += `<div class="t-final"><div class="fin-head">✓ final answer</div>${esc(e.text)}</div>`;
    }
  }
  return html;
}

function resultHtml(label, e) {
  const key = `${label}:${e.seq}`;
  const open = state.expanded.has(key);
  const LIMIT = 220;
  const long = e.text.length > LIMIT;
  const shown = open || !long ? e.text : e.text.slice(0, LIMIT) + "…";
  const toggle = long
    ? ` <span class="expand" data-key="${esc(key)}">${open ? "collapse" : "expand"}</span>`
    : "";
  return `<div class="t-res${e.isError ? " err" : ""}">
      <div class="res-meta"><span>${esc(e.name)} → ${e.chars.toLocaleString()} chars${e.isError ? ' · <span class="err-tag">ERROR</span>' : ""}</span></div>${esc(shown)}${toggle}
    </div>`;
}

function bindExpanders(laneEl, i) {
  laneEl.querySelectorAll(".expand").forEach((el) => {
    el.addEventListener("click", () => {
      const k = el.dataset.key;
      if (state.expanded.has(k)) state.expanded.delete(k); else state.expanded.add(k);
      renderLane(i);
    });
  });
}

/* ============================================================
   Flying packet — transient, only on forward step
   ============================================================ */
function flyStep(prevRace, prevLane, prevLocal) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const idxs = state.mode === "race" ? [0, 1, 2] : [state.seqLane];
  for (const i of idxs) {
    const before = state.mode === "race" ? Math.min(prevRace, laneLen(i)) : (i === state.seqLane ? prevLocal : 0);
    const now = revealed(i).length;
    if (now === before + 1) {
      const e = lanes()[i].events[now - 1];
      if (e.type === "tool_call") fly(i, "call", 18);
      else if (e.type === "tool_result") {
        const laneEl = $(`.lane[data-lane="${i}"]`);
        const w = laneEl ? Math.max(120, laneEl.clientWidth - 130) : 160;
        fly(i, "ret", sizePx(e.chars, w * 0.5), e.isError);
      }
    }
  }
}

function fly(i, kind, widthPx, isError) {
  const wire = $(`.lane[data-lane="${i}"] .wire`);
  if (!wire) return;
  const p = document.createElement("div");
  p.className = `packet ${kind}${isError ? " err" : ""}`;
  p.style.width = widthPx + "px";
  const dur = clamp(620 / state.speed, 150, 900);
  p.style.transition = `left ${dur}ms cubic-bezier(.3,.7,.2,1), opacity ${dur}ms ease`;
  const from = kind === "call" ? "-6px" : "calc(100% + 6px)";
  const to = kind === "call" ? "calc(100% + 6px)" : "-6px";
  p.style.left = from;
  wire.appendChild(p);
  requestAnimationFrame(() => requestAnimationFrame(() => { p.style.left = to; p.style.opacity = ".15"; }));
  setTimeout(() => p.remove(), dur + 80);
}

/* ============================================================
   Transport
   ============================================================ */
function setCursor(v, { animate = false } = {}) {
  const prevRace = state.raceCursor, prevLocal = state.seqLocal, prevLane = state.seqLane;
  v = clamp(v, 0, cursorMax());
  if (state.mode === "race") state.raceCursor = v; else state.seqLocal = v;
  render();
  if (animate) flyStep(prevRace, prevLane, prevLocal);
}

function stepFwd() {
  const atEnd = cursor() >= cursorMax();
  if (atEnd) {
    // sequential: roll into the next lane
    if (state.mode === "seq" && state.seqLane < 2) {
      state.seqLane += 1; state.seqLocal = 0; buildStage(); render();
    } else { pause(); }
    return;
  }
  setCursor(cursor() + 1, { animate: true });
}

function stepBack() { setCursor(cursor() - 1); }

function play() {
  if (state.playing) return;
  // if at the very end, restart from 0
  if (state.mode === "race" && state.raceCursor >= maxLen()) state.raceCursor = 0;
  if (state.mode === "seq" && state.seqLane >= 2 && state.seqLocal >= laneLen(2)) { state.seqLane = 0; state.seqLocal = 0; buildStage(); }
  state.playing = true;
  render();
  schedule();
}

function schedule() {
  clearTimeout(state.timer);
  const interval = clamp(900 / state.speed, 120, 1800);
  state.timer = setTimeout(function tick() {
    if (!state.playing) return;
    stepFwd();
    if (state.playing) { clearTimeout(state.timer); state.timer = setTimeout(tick, clamp(900 / state.speed, 120, 1800)); }
  }, interval);
}

function pause() { state.playing = false; clearTimeout(state.timer); render(); }
function togglePlay() { state.playing ? pause() : play(); }

function setMode(mode) {
  if (mode === state.mode) return;
  pause();
  state.mode = mode;
  buildStage();
  render();
}

function setLane(i) {
  pause();
  state.seqLane = i; state.seqLocal = 0;
  buildStage(); render();
}

/* ============================================================
   Data loading
   ============================================================ */
function applyData(data) {
  state.data = data;
  state.raceCursor = 0; state.seqLane = 0; state.seqLocal = 0;
  state.expanded.clear();
  pause();
  // normalization ceiling across every tool_result in every interface
  let mc = 1;
  for (const iface of data.interfaces)
    for (const e of iface.events)
      if (e.type === "tool_result") mc = Math.max(mc, e.chars);
  state.maxChars = mc;

  // header
  $("#task").textContent = data.task;
  $("#provider").innerHTML = `<b>${esc(data.provider)}</b> · ${esc(data.model)}`;
  $("#recorded").textContent = new Date(data.recordedAt).toISOString().replace("T", " ").replace(".000Z", "Z");
  // lane tabs
  const tabs = $("#lanetabs");
  tabs.innerHTML = data.interfaces.map((f, i) =>
    `<button data-lane="${i}" style="--tabc:var(--${ACCENT[f.label]})" aria-pressed="${i === 0}">${esc(f.label)}</button>`).join("");
  tabs.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    tabs.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", "false"));
    b.setAttribute("aria-pressed", "true");
    setLane(Number(b.dataset.lane));
  }));
  // verification panel
  $("#ask").textContent = data.task;
  $("#answers").innerHTML = data.interfaces.map((f) => {
    const fin = [...f.events].reverse().find((e) => e.type === "final");
    const acc = ACCENT[f.label];
    const cost = f.totals.cost == null ? "n/a" : "$" + f.totals.cost.toFixed(5);
    return `<div class="answer" style="--accent:var(--${acc});--accent-ink:var(--${acc}-ink)">
      <div class="a-head"><span class="a-tag">${esc(f.label)}</span>
        <span class="mono" style="font-size:11px;color:var(--muted)">${f.totals.total.toLocaleString()} tok · ${f.totals.turns} turns · ${f.totals.toolCalls} calls</span>
        <span class="a-cost">${cost}</span></div>
      <div class="a-body">${fin ? esc(fin.text) : "<em>no final</em>"}</div>
    </div>`;
  }).join("");

  buildScoreboard();
  buildStage();
  render();
  $("#notice").textContent = "";
}

async function loadBundled(file) {
  try {
    const res = await fetch(`/ci-demo/recordings/${file}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    applyData(await res.json());
    const entry = BUNDLED.find((b) => b.file === file);
    $("#exhibit").textContent = entry ? entry.note : "";
  } catch (err) {
    $("#notice").textContent = `Couldn't fetch ${file} (${err.message}). Use “Load file…” or drag a recording onto the page.`;
  }
}

function loadFile(file) {
  const r = new FileReader();
  r.onload = () => {
    try { applyData(JSON.parse(r.result)); $("#exhibit").textContent = "Loaded from file."; }
    catch (e) { $("#notice").textContent = `Not valid recording JSON: ${e.message}`; }
  };
  r.readAsText(file);
}

/* ============================================================
   Wire up
   ============================================================ */
function init() {
  $("#modeRace").addEventListener("click", () => setMode("race"));
  $("#modeSeq").addEventListener("click", () => setMode("seq"));
  $("#playbtn").addEventListener("click", togglePlay);
  $("#stepf").addEventListener("click", () => { pause(); stepFwd(); });
  $("#stepb").addEventListener("click", () => { pause(); stepBack(); });
  $("#scrub").addEventListener("input", (e) => { pause(); setCursor(Number(e.target.value)); });
  $("#speed").addEventListener("change", (e) => { state.speed = Number(e.target.value); if (state.playing) schedule(); });

  const sel = $("#recSel");
  sel.innerHTML = BUNDLED.map((b) => `<option value="${b.file}">${b.label}</option>`).join("");
  sel.addEventListener("change", (e) => loadBundled(e.target.value));

  $("#filebtn").addEventListener("click", () => $("#file").click());
  $("#file").addEventListener("change", (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); });

  // drag & drop fallback (works even without the server / file://)
  const drop = $("#drop");
  let depth = 0;
  window.addEventListener("dragenter", (e) => { e.preventDefault(); depth++; drop.classList.add("show"); });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("dragleave", (e) => { e.preventDefault(); if (--depth <= 0) drop.classList.remove("show"); });
  window.addEventListener("drop", (e) => {
    e.preventDefault(); depth = 0; drop.classList.remove("show");
    if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });

  // keyboard: space=play/pause, arrows=step
  window.addEventListener("keydown", (e) => {
    if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
    if (e.key === " ") { e.preventDefault(); togglePlay(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); pause(); stepFwd(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); pause(); stepBack(); }
  });

  loadBundled(BUNDLED[0].file);
}

document.addEventListener("DOMContentLoaded", init);

// app.js — Socrates-Web frontend controller.
// Dashboard rendering, chat (POST /api/chat + /api/stream SSE), hot-reload,
// and Phase 5 guardrails: rest gate, passivity banner, Budapest mode.

const stream = document.getElementById("stream");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const budapest = document.getElementById("budapest");
const passivityEl = document.getElementById("passivity");
const overlay = document.getElementById("overlay");
const countdownEl = document.getElementById("countdown");

let currentES = null;
let busy = false;
let restTimer = null;

const BUDAPEST_MODIFIER =
  "[BUDAPEST MODE ACTIVE] Forbid lecturing, definitions, or syntax explanations. " +
  "Place a difficult, counter-intuitive programming problem or logical paradox in front of the user. " +
  "Force them to struggle and attempt a solution before revealing any documentation.";

const PASSIVE_RE =
  /^(?:ok|okay|k+|cool|got ?it|makes? ?sense|next|proceed|continue|go ?on|y|yes|yeah|sure|fine|right|nice|great|\.+)$/i;

const GATE_TOKENS = ["COGNITIVE SPRINT GATE", "SPRINT_GATE", "SPRINT GATE"];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function scrollBottom() {
  stream.scrollTop = stream.scrollHeight;
}

function setBusy(b) {
  busy = b;
  sendBtn.disabled = b;
  input.disabled = b;
}

// ---- dashboard ------------------------------------------------------------

function renderDashboard(data) {
  renderMission(data.mission);
  renderConcepts(data.schema.concepts);
  renderTimeline(data.schema.concepts);
  renderMisconceptions(data.schema.misconceptions);
}

async function loadDashboard() {
  try {
    const res = await fetch("/api/learning");
    if (!res.ok) return;
    renderDashboard(await res.json());
  } catch {
    /* server not ready yet */
  }
}

function renderMission(m) {
  const box = document.getElementById("mission");
  box.innerHTML = "";
  box.appendChild(el("div", "destination", m.destination || "No mission yet"));
  if (m.artifact) box.appendChild(el("div", "artifact", m.artifact));
  box.appendChild(el("hr"));
}

function renderConcepts(concepts) {
  const box = document.getElementById("concepts");
  box.innerHTML = "";
  if (!concepts.length) {
    box.appendChild(el("div", "meta", "No concepts yet."));
    return;
  }
  for (const c of concepts) {
    const row = el("div", "concept");
    row.title = "grill this concept";
    row.appendChild(el("span", "badge", c.badge));
    row.appendChild(el("span", "name", c.name));
    row.appendChild(el("span", "label", c.label));
    row.addEventListener("click", () => chat(`/skill:grill-misconception ${c.name}`));
    box.appendChild(row);
  }
}

function renderTimeline(concepts) {
  const box = document.getElementById("timeline");
  box.innerHTML = "";
  if (!concepts.length) {
    box.appendChild(el("div", "meta", "No schedule."));
    return;
  }
  const key = (c) => (c.due === "due" ? 0 : c.due === "upcoming" ? 1 : 2);
  const sorted = [...concepts].sort(
    (a, b) => key(a) - key(b) || (a.sm2.next_review || "").localeCompare(b.sm2.next_review || ""),
  );
  for (const c of sorted) {
    const row = el("div", "concept");
    row.appendChild(el("span", "badge", c.badge));
    row.appendChild(el("span", "name", c.name));
    if (c.due === "due") row.appendChild(el("span", "due", "· due now"));
    else if (c.due === "upcoming") row.appendChild(el("span", "upcoming", `· ${c.sm2.next_review}`));
    else row.appendChild(el("span", "unscheduled", "· unscheduled"));
    box.appendChild(row);
  }
}

function renderMisconceptions(list) {
  const box = document.getElementById("misconceptions");
  box.innerHTML = "";
  if (!list.length) {
    box.appendChild(el("div", "meta", "No misconceptions logged."));
    return;
  }
  for (const m of list) {
    const cls = m.status === "resolved" ? "mis-resolved" : "mis-open";
    box.appendChild(el("div", cls, `${m.id} · ${m.concept}: ${m.misconception}`));
  }
}

// ---- guardrails -----------------------------------------------------------

function hasGateToken(s) {
  return GATE_TOKENS.some((t) => s.includes(t));
}

function triggerRestGate() {
  setBusy(true);
  overlay.classList.remove("hidden");
  overlay.classList.remove("fading");
  let remaining = 5 * 60;
  const tick = () => {
    const m = String(Math.floor(remaining / 60)).padStart(2, "0");
    const s = String(remaining % 60).padStart(2, "0");
    countdownEl.textContent = m + ":" + s;
    if (remaining <= 0) {
      if (restTimer) clearInterval(restTimer);
      restTimer = null;
      overlay.classList.add("fading");
      setTimeout(() => overlay.classList.add("hidden"), 500);
      setBusy(false);
      input.focus();
      return;
    }
    remaining--;
  };
  tick();
  restTimer = setInterval(tick, 1000);
}

function showPassivity() {
  passivityEl.classList.add("visible");
}

function hidePassivity() {
  passivityEl.classList.remove("visible");
}

function isPassiveText(t) {
  return PASSIVE_RE.test(t.trim());
}

// ---- chat -----------------------------------------------------------------

function append(kind, text) {
  const d = el("div", "msg " + kind);
  d.textContent = text;
  stream.appendChild(d);
  scrollBottom();
}

async function chat(message) {
  if (busy) return;
  message = (message || "").trim();
  if (!message) return;
  if (!isPassiveText(message)) hidePassivity();
  setBusy(true);
  append("user", message);
  input.value = "";

  const payload = budapest.checked ? message + "\n\n" + BUDAPEST_MODIFIER : message;

  let res;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: payload }),
    });
  } catch {
    append("meta", "⚠️ could not reach server");
    setBusy(false);
    return;
  }
  const j = await res.json().catch(() => ({}));
  if (!j.accepted) {
    append("meta", "⚠️ " + (j.error || "message rejected"));
    setBusy(false);
    return;
  }
  openStream();
}

function openStream() {
  if (currentES) currentES.close();
  const es = new EventSource("/api/stream");
  currentES = es;
  let textEl = null;
  let thinkEl = null;
  let gateActive = false;

  es.onmessage = (ev) => {
    const raw = ev.data;

    if (raw === "[DONE]") {
      es.close();
      if (currentES === es) currentES = null;
      setBusy(false);
      loadDashboard();
      input.focus();
      return;
    }
    if (raw.startsWith("[ERROR]")) {
      append("meta", "⚠️ " + raw.slice(8));
      es.close();
      if (currentES === es) currentES = null;
      setBusy(false);
      input.focus();
      return;
    }

    let e;
    try {
      e = JSON.parse(raw);
    } catch {
      return;
    }

    if (e.type === "reload") {
      renderDashboard(e.data);
      return;
    }

    // fire-and-forget extension notifications (e.g. passivity-interceptor)
    if (e.type === "extension_ui_request") {
      if (e.method === "notify" && typeof e.message === "string" && e.message.includes("PASSIVITY")) {
        showPassivity();
      }
      return;
    }

    if (e.type === "message_update" && e.assistantMessageEvent) {
      const d = e.assistantMessageEvent;
      if (d.type === "thinking_delta") {
        if (!thinkEl) {
          thinkEl = el("div", "msg thinking");
          stream.appendChild(thinkEl);
        }
        thinkEl.textContent += d.delta;
        scrollBottom();
      } else if (d.type === "text_delta") {
        if (gateActive) return; // suppress the rest of the gate markdown
        if (hasGateToken(d.delta)) {
          gateActive = true;
          triggerRestGate();
          return;
        }
        if (!textEl) {
          textEl = el("div", "msg assistant");
          stream.appendChild(textEl);
        }
        textEl.textContent += d.delta;
        scrollBottom();
      }
    }
  };

  es.onerror = () => {
    es.close();
    if (currentES === es) currentES = null;
    setBusy(false);
  };
}

sendBtn.addEventListener("click", () => chat(input.value));
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") chat(input.value);
});

loadDashboard();

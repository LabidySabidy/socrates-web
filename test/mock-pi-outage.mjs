/**
 * A mock pi that reproduces a PROVIDER OUTAGE, using the real event shapes read from pi's source.
 *
 * WHY A MOCK AND NOT JUST A UNIT TEST. The unit tests pin the fold. This pins the whole path — server turn
 * handler → SSE → client — because the original defect was not a wrong fold, it was that the server read ONE
 * event class and discarded the rest. A unit test on the fold would have passed while the app stayed silent.
 *
 * The sequence is what pi actually emits when a provider is down (`agent-session.js:2018` and `:706`):
 *
 *   1. an assistant message that FAILED               → message_update / message_end with stopReason "error"
 *   2. auto_retry_start per attempt                   → attempt, maxAttempts, delayMs, errorMessage
 *   3. auto_retry_end {success:false, finalError}     → retries exhausted
 *   4. agent_settled                                  → pi settles AFTER reporting the failure
 *
 * Step 4 with empty text is what the old code turned into `finalize("done")` — a successful turn that produced
 * nothing, which is exactly what the learner saw as "Socrates is thinking…" forever.
 */
const OUTAGE = "We were unable to start processing your request within the 900-second timeout limit. Please try again later.";

/** MOCK_MODE=outage (default) | slow-turn | healthy */
const mode = process.env.MOCK_MODE ?? "outage";

const ISO = () => new Date().toISOString();
let seq = 0;
const id = () => `mock${String(++seq).padStart(4, "0")}`;

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function messageUpdate(message, assistantMessageEvent) {
  send({ type: "message_update", id: id(), timestamp: ISO(), message, assistantMessageEvent });
}

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let cmd;
    try { cmd = JSON.parse(trimmed); } catch { continue; }
    if (cmd.type !== "prompt") continue;

    // The prompt was accepted; the turn now runs.
    send({ type: "response", id: id(), command: "prompt", success: true });

    if (mode === "healthy") {
      messageUpdate({ role: "assistant", stopReason: null }, { type: "text_delta", delta: "Camber is the wheel's lean angle." });
      messageUpdate({ role: "assistant", stopReason: "endTurn" }, { type: "text_delta", delta: " Toe is its rotation." });
      send({ type: "agent_settled", id: id(), timestamp: ISO() });
      continue;
    }

    if (mode === "slow-turn") {
      // Emits a delta, then goes quiet for a long time. Must NOT be called stalled after that delta.
      messageUpdate({ role: "assistant", stopReason: null }, { type: "text_delta", delta: "Let me think about that. " });
      setTimeout(() => send({ type: "agent_settled", id: id(), timestamp: ISO() }), 2000);
      continue;
    }

    if (mode === "partial") {
      // Streams real text, then the provider dies. The text must survive to the client.
      messageUpdate({ role: "assistant", stopReason: null }, { type: "text_delta", delta: "Ackermann geometry is about the steering arms. " });
      const failed = { role: "assistant", content: [], stopReason: "error", errorMessage: OUTAGE };
      messageUpdate(failed, { type: "done", stopReason: "error" });
      send({ type: "auto_retry_end", id: id(), timestamp: ISO(), success: false, attempt: 1, finalError: OUTAGE });
      setTimeout(() => send({ type: "agent_settled", id: id(), timestamp: ISO() }), 40);
      continue;
    }

    // --- outage -------------------------------------------------------------------------------------
    // 1. the failed assistant message, with the WHOLE message on the wire (agent-session.js:418)
    const failed = { role: "assistant", content: [], stopReason: "error", errorMessage: OUTAGE };
    messageUpdate(failed, { type: "done", stopReason: "error" });
    send({ type: "message_end", id: id(), timestamp: ISO(), message: failed });

    // 2/3. retries, then exhaustion, exactly as pi sequences them
    const maxAttempts = 3;
    let attempt = 0;
    const retry = () => {
      attempt++;
      if (attempt <= maxAttempts) {
        send({ type: "auto_retry_start", id: id(), timestamp: ISO(), attempt, maxAttempts, delayMs: 2000 * 2 ** (attempt - 1), errorMessage: OUTAGE });
        setTimeout(retry, 120);
        return;
      }
      send({ type: "auto_retry_end", id: id(), timestamp: ISO(), success: false, attempt: maxAttempts, finalError: OUTAGE });
      // 4. pi settles anyway. The OLD code called this a successful turn.
      setTimeout(() => send({ type: "agent_settled", id: id(), timestamp: ISO() }), 50);
    };
    setTimeout(retry, 120);
  }
});

process.stdin.on("end", () => process.exit(0));

// mock-pi-answerkey.mjs — returns a REAL answer key that fails extraction.
//
// Exists to prove the failure response does not ship the answer. The reply states the answer and the
// accepted alternatives, then has an unparseable tail so `extractItems` fails AFTER the model has
// committed the answer to text. That is the worst case for `excerpt`.
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const reply =
  '```json\n{"items":[{"prompt":"What is camber?","mode":"short-answer","answer":"Camber",' +
  '"accepts":["camber","wheel camber"],"hints":["front view","not the side view","vertical tilt"],' +
  '"steps":["look from the front","measure the tilt"]}] BROKEN TAIL so extraction fails\n```';
process.stdin.setEncoding("utf8");
let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let cmd;
    try { cmd = JSON.parse(line); } catch { continue; }
    if (cmd.type === "prompt") {
      out({ type: "response", command: "prompt", success: true });
      out({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: reply } });
      out({ type: "agent_settled" });
    }
  }
});

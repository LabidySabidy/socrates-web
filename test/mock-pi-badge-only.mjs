/**
 * A mock pi whose telemetry is a PLAIN badge update — no misconception.
 *
 * 26 of the owner's 29 real telemetry events look like this. It exists so the "no notice" assertion is tested
 * against a real wire shape rather than asserted in the abstract.
 */
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
process.stdin.setEncoding("utf8");
let buf = "";
process.stdin.on("data", (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let cmd;
    try { cmd = JSON.parse(line); } catch { continue; }
    if (cmd.type !== "prompt") continue;
    out({ type: "response", command: "prompt", success: true });
    out({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "A real answer. " } });
    const pieces = [
      '<learning-tele',
      'metry> {"concept":"How A House Lighting Circuit Works","status":"\u{1F7E5}",',
      '"sm2":{"interval":1,"ease_factor":1.96,"repetitions":0}} </learning-',
      "telemetry>",
    ];
    for (const delta of pieces) {
      out({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta } });
    }
    out({ type: "agent_settled" });
  }
});

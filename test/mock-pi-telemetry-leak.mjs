/**
 * A mock pi that streams a `<learning-telemetry>` tag as ordinary assistant text.
 *
 * This reproduces the reported leak: the tag reaches the browser as a `text_delta`. The extension cleans the
 * message on `message_end`, which fires after generation, so the learner has already seen it.
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
    out({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Here is the answer. " } });
    // THE TAG IS STREAMED IN PIECES, because that is the arrangement a per-delta regex fails:
    // measured, it leaks in 3 of 4 split cases. A mock that sent the tag whole would pass a broken fix.
    const pieces = [
      '\n<learning-tele',
      'metry> {"concept":"How A House Lighting Circuit Works","status":"\u{1F7E5}",',
      '"sm2":{"interval":1,"ease_factor":1.96,"repetitions":0},',
      '"misconception":{"id":"MIS-007","description":"Thinks the switch needs a neutral to work",',
      '"status":"open","severity":"root"}} </learning-',
      'telemetry>',
    ];
    for (const delta of pieces) {
      out({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta } });
    }
    out({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: " And that is the point." } });
    out({ type: "agent_settled" });
  }
});

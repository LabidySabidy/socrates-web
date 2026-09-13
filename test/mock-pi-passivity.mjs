// mock-pi-passivity.mjs — stands in for the extension that emits the passivity notification.
//
// In production the pi extension decides the learner is being passive and sends
// `{type:"extension_ui_request", method:"notify", message:"…PASSIVITY…"}` on stdout, which the server
// forwards verbatim as an SSE frame. No such extension is installed on this machine, so this mock
// provides the same frame deterministically in order to verify the CLIENT path:
//
//   frame -> intercept active -> passive draft refused -> real explanation clears it
//
// It is a test producer, not a replacement for the extension.
const out = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

process.stdin.setEncoding("utf8");
let buf = "";
/** The intercept fires once, as a real tutor would signal it once per episode. */
let signalled = false;
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let cmd;
    try {
      cmd = JSON.parse(line);
    } catch {
      continue;
    }
    if (cmd.type === "prompt") {
      out({ type: "response", command: "prompt", success: true });
      out({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Right — " } });
      if (!signalled) {
        signalled = true;
        // The extension's notification, exactly as the server would forward it.
        out({
          type: "extension_ui_request",
          method: "notify",
          message:
            "⚠️ [PASSIVITY INTERCEPT] Simply nodding along triggers the Illusion of Understanding.",
        });
      }
      out({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: "explain the state update in your own words before we continue.",
        },
      });
      out({ type: "agent_settled" });
    }
  }
});

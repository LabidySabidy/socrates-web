// mock-pi-slow.mjs — a prompt that stays IN FLIGHT for a while before settling.
//
// Exists for one test: a rename requested while a turn is running must be deferred, because the agent's
// cwd IS the course directory and Windows cannot rename a directory out from under a live process.
// Every other mock settles immediately, so there is no window in which to make that request.
//
// `MOCK_SETTLE_MS` controls the delay (default 1200ms).
const out = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const settleMs = Number(process.env.MOCK_SETTLE_MS ?? 1200);

out({ type: "__cwd__", cwd: process.cwd() });

process.stdin.setEncoding("utf8");
let buf = "";
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
      out({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: `working in ${process.cwd()}` },
      });
      setTimeout(() => out({ type: "agent_settled" }), settleMs);
    }
  }
});

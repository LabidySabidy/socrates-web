// mock-pi.mjs — deterministic fake `pi --mode rpc` for tests.
// Reads JSONL commands on stdin; on a prompt it emits one fixed turn:
// response -> text deltas -> agent_settled.
const out = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

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
      out({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hello" } });
      out({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: " world" } });
      out({ type: "agent_settled" });
    } else if (cmd.type === "get_state") {
      out({ type: "response", command: "get_state", success: true, data: { isStreaming: false } });
    }
  }
});

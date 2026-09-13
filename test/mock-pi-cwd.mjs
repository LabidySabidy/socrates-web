// mock-pi-cwd.mjs — reports the directory the agent was started in.
//
// Unlike mock-pi.mjs this one exists to prove WHICH COURSE the bridge is running in, and that a
// course switch really does replace the process: it announces its cwd on startup and echoes it on
// every prompt.
const out = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

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
      out({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: `cwd:${process.cwd()}` } });
      out({ type: "agent_settled" });
    }
  }
});

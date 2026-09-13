// mock-pi-assessment.mjs — deterministic replies for the assessment generation paths.
//
// PI_MOCK_MODE selects the reply, so each validation branch can be exercised without waiting on a
// real model or depending on how it happens to phrase things:
//   invalid  - prose with no JSON block at all
//   badcite  - well-formed items citing a file that does not exist
//   good     - well-formed items citing a real file, with real line anchors
const mode = process.env.PI_MOCK_MODE ?? "invalid";

const out = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

const REPLIES = {
  invalid: "Here are some questions I thought of. (No JSON, as requested by the mock.)",
  badcite:
    '```json\n{"items":[{"prompt":"What does the policy hide?","answer":"pending rows","hints":["Check the USING clause.","One column.","The moderation state."],"steps":["Read the policy.","The clause compares status."],"cites":["src/does/not/exist.sql#L4"]}]}\n```',
  good: '```json\n{"items":[{"prompt":"Which condition hides pending rows?","answer":"status = \'approved\'","accepts":["status=\'approved\'"],"hints":["Look at the USING clause.","It compares one column to a literal.","The column stores the moderation state."],"steps":["Open the policy.","The USING clause reads status = \'approved\'"],"cites":["src/migrations/001_policy.sql#L4"]}]}\n```',
};

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
      const reply = REPLIES[mode] ?? REPLIES.invalid;
      // stream in small pieces so the server's accumulation is exercised too
      for (const piece of reply.match(/.{1,24}/gs) ?? []) {
        out({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: piece } });
      }
      out({ type: "agent_settled" });
    }
  }
});

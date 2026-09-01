import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ProcessBridge } from "./process-bridge.ts";

const here = dirname(fileURLToPath(import.meta.url));

// Point the bridge at the deterministic mock pi.
process.env.PI_BIN = "node";
process.env.PI_ARGS = join(here, "test", "mock-pi.mjs");

test("bridge spawns, streams JSONL lines, and detects settle", async () => {
  const bridge = new ProcessBridge(process.cwd());
  const lines: string[] = [];
  bridge.onLine((l) => lines.push(l));

  assert.ok(bridge.pid !== undefined, "child spawned");
  assert.ok(bridge.send({ type: "prompt", message: "hello" }), "send accepted");

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !lines.some((l) => l.includes("agent_settled"))) {
    await new Promise((r) => setTimeout(r, 20));
  }

  assert.ok(lines.some((l) => l.includes('"type":"response"')), "prompt accepted response");
  assert.ok(lines.some((l) => l.includes("text_delta")), "streamed a text delta");
  assert.ok(lines.some((l) => l.includes("agent_settled")), "turn settled");

  bridge.kill();
  assert.equal(bridge.pid, undefined, "child cleared after kill");
});

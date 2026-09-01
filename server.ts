/**
 * server.ts — Socrates-Web HTTP server.
 *
 * Phase 1: GET /api/learning (structured learning state).
 * Phase 2: POST /api/chat (prompt the singleton pi agent) and
 *          GET /api/stream (Server-Sent Events stream of the agent's JSONL).
 *
 * Target project dir: PROJECT_DIR env var, falling back to process.cwd().
 * Port: PORT env var, defaulting to 3850.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { parseLearning } from "./learning-parser.ts";
import { ProcessBridge } from "./process-bridge.ts";

const PORT = Number(process.env.PORT) || 3850;
const projectDir = process.env.PROJECT_DIR || process.cwd();

const bridge = new ProcessBridge(projectDir);

// --- turn state ------------------------------------------------------------
// Raw JSONL lines for the current/last turn, replayed to late SSE subscribers.
let turnLines: string[] = [];
let settled = true;
const sseClients = new Set<ServerResponse>();

function finalize(kind: "done" | "error", detail?: unknown): void {
  settled = true;
  const signal =
    kind === "done"
      ? "data: [DONE]\n\n"
      : `data: [ERROR] ${JSON.stringify({ error: detail ?? "unknown" })}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(signal);
      res.end();
    } catch {
      /* ignore */
    }
  }
  sseClients.clear();
}

bridge.onLine((line) => {
  turnLines.push(line);
  for (const res of sseClients) res.write(`data: ${line}\n\n`);

  let evt: Record<string, unknown> | null = null;
  try {
    evt = JSON.parse(line) as Record<string, unknown>;
  } catch {
    /* not JSON (e.g. __stderr__ is already JSON, but be safe) */
  }

  // Robust turn-end: agent_settled = no retry/compaction/queued follow-up left.
  if (evt?.type === "agent_settled") {
    finalize("done");
  } else if (
    evt?.type === "response" &&
    evt.command === "prompt" &&
    evt.success === false
  ) {
    finalize("error", evt.error);
  }
});

bridge.onExit(() => {
  if (!settled) finalize("error", "pi process exited");
});

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c: Buffer) => {
      data += c.toString();
      if (data.length > 1_000_000) {
        req.destroy();
        reject(new Error("body too large"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

const server = createServer(async (req, res) => {
  const url = req.url || "/";

  if (url === "/api/learning") {
    try {
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify(parseLearning(projectDir), null, 2));
    } catch (err) {
      res.writeHead(500, JSON_HEADERS);
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  if (url === "/api/chat" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body || "{}") as { message?: unknown };
      const message = typeof parsed.message === "string" ? parsed.message : "";
      if (!message) {
        res.writeHead(400, JSON_HEADERS);
        res.end(JSON.stringify({ error: "message required" }));
        return;
      }
      turnLines = [];
      settled = false;
      const accepted = bridge.send({ type: "prompt", message });
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({ accepted }));
    } catch (err) {
      res.writeHead(400, JSON_HEADERS);
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : "invalid body" }));
    }
    return;
  }

  if (url === "/api/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    // Replay the current/last turn so a late subscriber doesn't miss output.
    for (const line of turnLines) res.write(`data: ${line}\n\n`);
    if (settled) {
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if (url === "/" || url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(
      "Socrates-Web API\n\nGET /api/learning\nPOST /api/chat {\"message\":\"...\"}\nGET /api/stream (SSE)\n(Phase 2)",
    );
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`socrates-web (Phase 2): http://localhost:${PORT}`);
  console.log(`project dir: ${projectDir}`);
});

function shutdown() {
  bridge.kill();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

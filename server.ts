/**
 * server.ts — Socrates-Web HTTP server.
 *
 * Phase 1: GET /api/learning (structured learning state).
 * Phase 2: POST /api/chat (prompt the singleton pi agent) + GET /api/stream (SSE).
 * Phase 3: static hosting of public/ + single-active-SSE guard.
 *
 * Target project dir: PROJECT_DIR env var, falling back to process.cwd().
 * Port: PORT env var, defaulting to 3850.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLearning } from "./learning-parser.ts";
import { ProcessBridge } from "./process-bridge.ts";

const PORT = Number(process.env.PORT) || 3850;
const projectDir = process.env.PROJECT_DIR || process.cwd();
const publicDir = join(dirname(fileURLToPath(import.meta.url)), "public");

const bridge = new ProcessBridge(projectDir);

// --- turn / SSE state ------------------------------------------------------
// One global bridge line-handler (registered once at startup — never per
// connection, so no bridge listeners accumulate). It fans out to the single
// active SSE response, which is released on socket close.
let turnLines: string[] = [];
let settled = true;
let activeStream: ServerResponse | null = null;

function finalize(kind: "done" | "error", detail?: unknown): void {
  settled = true;
  const signal =
    kind === "done"
      ? "data: [DONE]\n\n"
      : `data: [ERROR] ${JSON.stringify({ error: detail ?? "unknown" })}\n\n`;
  const res = activeStream;
  activeStream = null;
  if (res) {
    try {
      res.write(signal);
      res.end();
    } catch {
      /* ignore */
    }
  }
}

bridge.onLine((line) => {
  // Ignore tail-end stdout emitted after the turn already settled.
  if (settled) return;
  turnLines.push(line);
  const res = activeStream;
  if (res) {
    try {
      res.write(`data: ${line}\n\n`);
    } catch {
      /* ignore */
    }
  }

  let evt: Record<string, unknown> | null = null;
  try {
    evt = JSON.parse(line) as Record<string, unknown>;
  } catch {
    /* not JSON */
  }

  if (evt?.type === "agent_settled") {
    bridge.markIdle();
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

// --- debounced file watcher ------------------------------------------------
// Re-parses SCHEMA.md after 150ms of silence and pushes a {type:"reload"} event
// to the active SSE stream so the dashboard hot-updates without a page reload.
let watcher: FSWatcher | null = null;
let watchTimer: NodeJS.Timeout | null = null;

function startWatcher(): void {
  const dir = join(projectDir, ".agent", "learning");
  if (!existsSync(dir)) {
    console.log("[watcher] no .agent/learning dir — hot-reload disabled");
    return;
  }
  watcher = watch(dir, (_eventType, filename) => {
    if (filename && filename !== "SCHEMA.md") return;
    if (watchTimer) clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      console.log("[watcher] SCHEMA.md changed — re-parsing (150ms debounce)");
      const data = parseLearning(projectDir);
      if (activeStream) {
        try {
          activeStream.write(`data: ${JSON.stringify({ type: "reload", data })}\n\n`);
        } catch {
          /* ignore */
        }
      }
    }, 150);
  });
  console.log(`[watcher] watching ${dir}`);
}

startWatcher();

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
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = resolve(publicDir, rel);
  // path-traversal guard: resolved path must stay inside public/
  if (filePath !== publicDir && !filePath.startsWith(publicDir + sep)) return false;
  try {
    const data = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0];

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
      // bridge.send() JSON.stringifies the command, escaping control chars,
      // literal newlines, and quotes before writing to stdin.
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
    // single active connection: a second stream would corrupt stdio fan-out.
    if (activeStream) {
      res.writeHead(429, JSON_HEADERS);
      res.end(JSON.stringify({ error: "an SSE stream is already active" }));
      return;
    }
    res.writeHead(200, SSE_HEADERS);
    for (const line of turnLines) res.write(`data: ${line}\n\n`);
    if (settled) {
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    activeStream = res;
    // release on socket close so a dead client never pins the single slot.
    req.on("close", () => {
      if (activeStream === res) activeStream = null;
    });
    return;
  }

  if (url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }

  if (await serveStatic(url, res)) return;

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`socrates-web (Phase 3): http://localhost:${PORT}`);
  console.log(`project dir: ${projectDir}`);
  console.log(`static dir: ${publicDir}`);
});

function shutdown() {
  if (watchTimer) clearTimeout(watchTimer);
  watcher?.close();
  bridge.kill();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

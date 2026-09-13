/**
 * server.ts — Socrates-Web HTTP server.
 *
 * Multi-course resource routes plus the original single-course chat bridge:
 *
 *   GET  /api/courses                discovered + registered courses (scan + registry overlay)
 *   GET  /api/courses/:id            derived/manifest course tree (units → modules)
 *   GET  /api/courses/:id/learning   raw LearningData for that course
 *   POST /api/courses                register / unregister / hide / unhide
 *   GET  /api/learning               ALIAS for the default course — unchanged shape
 *   POST /api/chat                   prompt the singleton pi agent
 *   GET  /api/stream                 SSE: agent output + {type:"reload"} on schema change
 *   GET  /health
 *
 * Env: PROJECT_DIR (default course), COURSES_ROOT (scan root), PORT (default 3850).
 *
 * `startServer()` is exported so tests can boot the real router on an ephemeral port;
 * importing this module no longer has side effects.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseLearning, type LearningData } from "./learning-parser.ts";
import { buildCourse, type CourseTree, type CourseSource } from "./course-model.ts";
import {
  discoverCourses,
  findCourse,
  defaultCoursesRoot,
  registerCourse,
  setHidden,
  unregisterCourse,
  REGISTRY_VERSION,
  type CourseRef,
  type DiscoveryResult,
} from "./courses.ts";
import { ProcessBridge } from "./process-bridge.ts";

export interface ServerOptions {
  port?: number;
  /** The default course. Also the fallback scan doesn't apply if COURSES_ROOT is set. */
  projectDir?: string;
  coursesRoot?: string | null;
  registryPath?: string;
  publicDir?: string;
  /** Wire POST /api/chat + GET /api/stream (spawns pi lazily). Off in tests. */
  chat?: boolean;
  /** Hot-reload watchers per course. Off in tests. */
  watch?: boolean;
}

export interface RunningServer {
  server: Server;
  port: number;
  close(): Promise<void>;
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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body, null, 2));
}

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

function safeJoin(root: string, rel: string): string | null {
  const filePath = resolve(root, rel);
  if (filePath !== root && !filePath.startsWith(root + sep)) return null;
  return filePath;
}

/** Load a course tree from disk. Returns null when the id is unknown. */
export function loadCourseTree(
  ref: CourseRef,
  read: (p: string) => string | null,
  parse: (dir: string) => LearningData = parseLearning,
): CourseTree {
  const slash = ref.dir.endsWith("/") || ref.dir.endsWith("\\") ? ref.dir : `${ref.dir}/`;
  const source: CourseSource = {
    id: ref.id,
    dir: ref.dir,
    data: parse(ref.dir),
    schemaText: read(`${slash}.agent/learning/SCHEMA.md`),
    manifestText: read(`${slash}.agent/learning/COURSE.md`),
  };
  return buildCourse(source);
}

export function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const port = opts.port ?? (Number(process.env.PORT) || 3850);
  const projectDir = opts.projectDir ?? process.env.PROJECT_DIR ?? process.cwd();
  const coursesRoot =
    opts.coursesRoot !== undefined
      ? opts.coursesRoot
      : process.env.COURSES_ROOT ?? defaultCoursesRoot(projectDir);
  const registryPath = opts.registryPath ?? join(projectDir, ".agent", "courses.json");
  const publicDir = opts.publicDir ?? join(dirname(fileURLToPath(import.meta.url)), "public");
  const chatEnabled = opts.chat !== false;
  const watchEnabled = opts.watch !== false;

  const readText = (p: string): string | null => {
    try {
      return existsSync(p) ? readFileSync(p, "utf8") : null;
    } catch {
      return null;
    }
  };

  const discover = (): DiscoveryResult =>
    discoverCourses({ root: coursesRoot, projectDir, registryPath });

  // --- chat / SSE state ------------------------------------------------------
  let turnLines: string[] = [];
  let settled = true;
  let activeStream: ServerResponse | null = null;
  const bridge = new ProcessBridge(projectDir);

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

  if (chatEnabled) {
    bridge.onLine((line) => {
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
      } else if (evt?.type === "response" && evt.command === "prompt" && evt.success === false) {
        finalize("error", evt.error);
      }
    });
    bridge.onExit(() => {
      if (!settled) finalize("error", "pi process exited");
    });
  }

  // --- watchers: one per course, reload carries the course id ----------------
  let watchers: FSWatcher[] = [];
  let watchTimers = new Map<string, NodeJS.Timeout>();

  function closeWatchers(): void {
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
    watchers = [];
    for (const t of watchTimers.values()) clearTimeout(t);
    watchTimers = new Map();
  }

  function pushReload(courseId: string): void {
    const res = activeStream;
    if (!res) return;
    const result = discover();
    const ref = findCourse(result, courseId);
    const payload: Record<string, unknown> = { type: "reload", course: courseId };
    if (ref) {
      try {
        payload.data = loadCourseTree(ref, readText);
      } catch (err) {
        payload.error = err instanceof Error ? err.message : String(err);
      }
    }
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {
      /* ignore */
    }
  }

  function resyncWatchers(): void {
    if (!watchEnabled) return;
    closeWatchers();
    const result = discover();
    for (const ref of result.courses) {
      const dir = join(ref.dir, ".agent", "learning");
      if (!existsSync(dir)) continue;
      try {
        watchers.push(
          watch(dir, (_event, filename) => {
            if (filename && filename !== "SCHEMA.md" && filename !== "COURSE.md") return;
            const existing = watchTimers.get(ref.id);
            if (existing) clearTimeout(existing);
            watchTimers.set(
              ref.id,
              setTimeout(() => {
                watchTimers.delete(ref.id);
                console.log(`[watcher] ${ref.id}: ${filename ?? "change"} — re-parsing (150ms debounce)`);
                pushReload(ref.id);
              }, 150),
            );
          }),
        );
      } catch {
        /* ignore unwatchable dirs */
      }
    }
    console.log(`[watcher] watching ${watchers.length} course(s) under ${coursesRoot ?? "(none)"}`);
  }

  // --- static ---------------------------------------------------------------
  async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
    const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = safeJoin(publicDir, rel);
    if (!filePath) return false;
    try {
      const data = await readFile(filePath);
      res.writeHead(200, { "Content-Type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream" });
      res.end(data);
      return true;
    } catch {
      return false;
    }
  }

  const server = createServer(async (req, res) => {
    const url = (req.url || "/").split("?")[0];

    // --- courses -------------------------------------------------------------
    if (url === "/api/courses" && req.method === "GET") {
      const result = discover();
      sendJson(res, 200, {
        root: result.root,
        registry: registryPath,
        warnings: result.warnings,
        courses: result.courses,
      });
      return;
    }

    if (url === "/api/courses" && req.method === "POST") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}") as {
          dir?: unknown;
          label?: unknown;
          order?: unknown;
          action?: unknown;
        };
        if (typeof body.dir !== "string" || !body.dir.trim()) {
          sendJson(res, 400, { error: "dir required" });
          return;
        }
        const action = typeof body.action === "string" ? body.action : "register";
        let result: { ok: boolean; error?: string };
        if (action === "register") {
          result = registerCourse(registryPath, body.dir, {
            label: typeof body.label === "string" ? body.label : undefined,
            order: typeof body.order === "number" ? body.order : undefined,
          });
        } else if (action === "unregister") {
          result = unregisterCourse(registryPath, body.dir);
        } else if (action === "hide" || action === "unhide") {
          result = setHidden(registryPath, body.dir, action === "hide");
        } else {
          sendJson(res, 400, { error: `unknown action: ${action}` });
          return;
        }
        if (!result.ok) {
          sendJson(res, 400, { error: result.error });
          return;
        }
        resyncWatchers();
        const after = discover();
        sendJson(res, 200, { ok: true, action, warnings: after.warnings, courses: after.courses });
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : "invalid body" });
      }
      return;
    }

    const courseMatch = /^\/api\/courses\/([^/]+)$/.exec(url);
    if (courseMatch && req.method === "GET") {
      const result = discover();
      const ref = findCourse(result, decodeURIComponent(courseMatch[1]));
      if (!ref) {
        sendJson(res, 404, { error: `unknown course: ${courseMatch[1]}`, known: result.courses.map((c) => c.id) });
        return;
      }
      try {
        sendJson(res, 200, loadCourseTree(ref, readText));
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    const learningMatch = /^\/api\/courses\/([^/]+)\/learning$/.exec(url);
    if (learningMatch && req.method === "GET") {
      const result = discover();
      const ref = findCourse(result, decodeURIComponent(learningMatch[1]));
      if (!ref) {
        sendJson(res, 404, { error: `unknown course: ${learningMatch[1]}` });
        return;
      }
      try {
        sendJson(res, 200, parseLearning(ref.dir));
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // --- alias: the default course, byte-compatible with the pre-course API --
    if (url === "/api/learning") {
      try {
        sendJson(res, 200, parseLearning(projectDir));
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // --- chat ----------------------------------------------------------------
    if (url === "/api/chat" && req.method === "POST") {
      if (!chatEnabled) {
        sendJson(res, 503, { error: "chat is disabled" });
        return;
      }
      try {
        const parsed = JSON.parse((await readBody(req)) || "{}") as { message?: unknown };
        const message = typeof parsed.message === "string" ? parsed.message : "";
        if (!message) {
          sendJson(res, 400, { error: "message required" });
          return;
        }
        turnLines = [];
        settled = false;
        const accepted = bridge.send({ type: "prompt", message });
        sendJson(res, 200, { accepted });
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : "invalid body" });
      }
      return;
    }

    if (url === "/api/stream") {
      if (!chatEnabled) {
        sendJson(res, 503, { error: "chat is disabled" });
        return;
      }
      if (activeStream) {
        sendJson(res, 429, { error: "an SSE stream is already active" });
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

  resyncWatchers();

  return new Promise<RunningServer>((resolvePromise) => {
    server.listen(port, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      console.log(`socrates-web: http://localhost:${actualPort}`);
      console.log(`default course: ${projectDir}`);
      console.log(`courses root:   ${coursesRoot ?? "(none)"}`);
      resolvePromise({
        server,
        port: actualPort,
        close: () =>
          new Promise<void>((done) => {
            closeWatchers();
            if (chatEnabled) bridge.kill();
            server.close(() => done());
          }),
      });
    });
  });
}

// --- entry point -------------------------------------------------------------
const isEntry =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntry) {
  const running = await startServer();
  const shutdown = () => {
    running.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export { REGISTRY_VERSION };

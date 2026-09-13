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
import { basename, dirname, extname, join, resolve, sep } from "node:path";
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
import { readJournal, readSessionMarkdown, appendEvent } from "./journal.ts";
import {
  awardedBadge,
  badgeState,
  buildGenerationPrompt,
  courseOracle,
  extractItems,
  raisesBadge,
  readCache,
  validateItems,
  writeCache,
} from "./assessments.ts";
import {
  buildGenerationPrompt as buildInteractivePrompt,
  extractSpecs,
  readCache as readInteractiveCache,
  validateSpecs,
  writeCache as writeInteractiveCache,
} from "./interactives.ts";

export interface ServerOptions {
  port?: number;
  /** The default course. Also the fallback scan doesn't apply if COURSES_ROOT is set. */
  projectDir?: string;
  coursesRoot?: string | null;
  registryPath?: string;
  publicDir?: string;
  /** Static root. Defaults to web/dist — the old vanilla UI in public/ was retired in P2. */
  staticDir?: string;
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
  const publicDir =
    opts.staticDir ??
    opts.publicDir ??
    join(dirname(fileURLToPath(import.meta.url)), "web", "dist");
  if (!existsSync(publicDir)) {
    console.warn(`[static] ${publicDir} does not exist — run \`npm run build\` (web/ has its own build)`);
  }
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
  /** Which course the in-flight (or most recent) turn belongs to. */
  let turnCourse: string | null = null;
  /**
   * Change notifications get their OWN channel. `/api/stream` carries a chat turn and deliberately
   * allows a single subscriber; a page that only wants to know when a file changed must not have to
   * occupy that slot, and must not be starved of updates because a turn is open elsewhere.
   */
  const watchStreams = new Set<ServerResponse>();
  const bridge = new ProcessBridge(projectDir);
  const defaultCourseId = () => basename(resolve(projectDir));

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

  // The bridge is wired on the FIRST chat request, not at boot. Registering a line handler
  // spawns pi, and a server boot must never spawn a ~1GB agent with cwd set to whatever
  // PROJECT_DIR points at — that is how an event log full of absolute paths ends up written
  // into an arbitrary directory. Still registered exactly once, so no listeners accumulate.
  let bridgeWired = false;
  function ensureBridgeWired(): void {
    if (bridgeWired) return;
    bridgeWired = true;
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
    if (watchStreams.size === 0 && !activeStream) return;
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
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of watchStreams) {
      try {
        res.write(frame);
      } catch {
        watchStreams.delete(res);
      }
    }
    // A chat stream may also be open; it ignores frames it does not know.
    try {
      activeStream?.write(frame);
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

  // --- one-shot turns (generation) --------------------------------------------
  // Not a chat turn: it consumes the agent's output itself and never touches the SSE slot, so a
  // request that awaits generation cannot be interleaved with the user's own conversation.
  function runTurn(
    dir: string,
    message: string,
    timeoutMs = 180_000,
  ): Promise<{ text: string; error?: string }> {
    return new Promise((resolvePromise) => {
      if (!chatEnabled) return resolvePromise({ text: "", error: "chat is disabled" });
      if (!settled) return resolvePromise({ text: "", error: "a chat turn is already in progress" });

      bridge.switchCourse(dir);
      turnCourse = null;

      let text = "";
      let finished = false;
      const finish = (result: { text: string; error?: string }) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        bridge.offLine(handler);
        bridge.markIdle();
        resolvePromise(result);
      };

      const handler = (line: string) => {
        let evt: Record<string, unknown> | null = null;
        try {
          evt = JSON.parse(line) as Record<string, unknown>;
        } catch {
          return;
        }
        const inner = evt.assistantMessageEvent as { type?: string; delta?: unknown } | undefined;
        if (evt.type === "message_update" && inner?.type === "text_delta") {
          text += typeof inner.delta === "string" ? inner.delta : "";
        } else if (evt.type === "agent_settled") {
          finish({ text });
        } else if (evt.type === "response" && evt.command === "prompt" && evt.success === false) {
          finish({ text, error: String(evt.error ?? "prompt rejected") });
        }
      };

      const timer = setTimeout(
        () => finish({ text, error: `the agent did not finish within ${Math.round(timeoutMs / 1000)}s` }),
        timeoutMs,
      );
      bridge.onLine(handler);
      if (!bridge.send({ type: "prompt", message })) finish({ text, error: "could not start the agent" });
    });
  }

  // --- static ---------------------------------------------------------------
  async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
    const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = safeJoin(publicDir, rel);
    if (!filePath) return false;
    try {
      const data = await readFile(filePath);
      const ext = extname(filePath).toLowerCase();
      const headers: Record<string, string> = {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
      };
      // index.html must not be cached: it names the hashed asset bundle, so a stale copy keeps
      // loading the previous build after every rebuild. Hashed assets themselves are immutable.
      headers["Cache-Control"] = ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable";
      res.writeHead(200, headers);
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
        // `unregister` removes the registry entry; the scan can still find the course if it lives
        // under COURSES_ROOT. Say so rather than leaving the client to wonder why it is still listed.
        // "Remove it from the catalogue" is `hide` — the reversible one.
        const stillDiscovered =
          action === "unregister"
            ? after.courses.some((c) => resolve(c.dir) === resolve(String(body.dir)))
            : undefined;
        sendJson(res, 200, {
          ok: true,
          action,
          ...(stillDiscovered ? { stillDiscovered, hint: "use action 'hide' to remove it from the catalogue" } : {}),
          warnings: after.warnings,
          courses: after.courses,
        });
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

    const learningMatch = /^\/api\/courses\/([^/]+)\/learning$/.exec(url);    if (learningMatch && req.method === "GET") {
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

    // --- journal: session history for one course -----------------------------
    const journalFileMatch = /^\/api\/courses\/([^/]+)\/journal\/([^/]+)$/.exec(url);
    if (journalFileMatch && req.method === "GET") {
      const result = discover();
      const ref = findCourse(result, decodeURIComponent(journalFileMatch[1]));
      if (!ref) {
        sendJson(res, 404, { error: `unknown course: ${journalFileMatch[1]}` });
        return;
      }
      const file = decodeURIComponent(journalFileMatch[2]);
      const markdown = readSessionMarkdown(ref.dir, file);
      if (markdown === null) {
        // Refused names and absent files are the same answer: never echo the path back.
        sendJson(res, 404, { error: "no such session" });
        return;
      }
      res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
      res.end(markdown);
      return;
    }

    const journalMatch = /^\/api\/courses\/([^/]+)\/journal$/.exec(url);
    if (journalMatch && req.method === "GET") {
      const result = discover();
      const ref = findCourse(result, decodeURIComponent(journalMatch[1]));
      if (!ref) {
        sendJson(res, 404, { error: `unknown course: ${journalMatch[1]}` });
        return;
      }
      try {
        sendJson(res, 200, { id: ref.id, dir: ref.dir, ...readJournal(ref.dir) });
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // --- assessments: authored, else generated and validated ------------------
    const assessmentsMatch = /^\/api\/courses\/([^/]+)\/assessments$/.exec(url);
    if (assessmentsMatch) {
      const result = discover();
      const ref = findCourse(result, decodeURIComponent(assessmentsMatch[1]));
      if (!ref) {
        sendJson(res, 404, { error: `unknown course: ${assessmentsMatch[1]}` });
        return;
      }
      const query = new URL(req.url ?? "/", "http://localhost").searchParams;
      const unit = Number(query.get("unit") ?? "1");
      if (!Number.isFinite(unit) || unit < 1) {
        sendJson(res, 400, { error: "unit must be a positive number" });
        return;
      }

      if (req.method === "GET") {
        try {
          const tree = loadCourseTree(ref, readText);
          const authored = tree.quizzes.filter((q) => q.unit === unit);
          if (authored.length > 0) {
            sendJson(res, 200, {
              unit,
              source: "authored",
              items: authored.flatMap((q) => q.items),
              warnings: tree.warnings.filter((w) => w.startsWith("assessment")),
            });
            return;
          }
          const cached = readCache(ref.dir, unit);
          if (cached) {
            sendJson(res, 200, {
              unit,
              source: "cache",
              generatedAt: cached.generatedAt,
              items: cached.items,
              warnings: [],
            });
            return;
          }
          sendJson(res, 200, { unit, source: "none", items: [], warnings: [] });
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      if (req.method === "POST") {
        try {
          const body = JSON.parse((await readBody(req)) || "{}") as { unit?: unknown; count?: unknown };
          const wanted = typeof body.unit === "number" ? body.unit : unit;
          const count = typeof body.count === "number" ? Math.min(Math.max(body.count, 1), 10) : 3;
          const tree = loadCourseTree(ref, readText);

          // Authored wins: never generate over a hand-written quiz.
          const authored = tree.quizzes.filter((q) => q.unit === wanted);
          if (authored.length > 0) {
            sendJson(res, 200, {
              unit: wanted,
              source: "authored",
              items: authored.flatMap((q) => q.items),
              warnings: [],
            });
            return;
          }

          const unitTree = tree.units.find((u) => u.n === wanted);
          if (!unitTree) {
            sendJson(res, 404, { error: `unit ${wanted} not found in ${ref.id}` });
            return;
          }

          const prompt = buildGenerationPrompt({
            courseTitle: tree.title,
            unitTitle: unitTree.title,
            kind: tree.kind,
            concepts: unitTree.concepts,
            count,
          });
          const turn = await runTurn(ref.dir, prompt);
          if (turn.error) {
            sendJson(res, 502, { error: "generation failed", detail: turn.error });
            return;
          }

          const extracted = extractItems(turn.text);
          if (extracted.error) {
            sendJson(res, 422, {
              error: "generation did not produce usable items",
              detail: extracted.error,
              excerpt: turn.text.slice(0, 400),
            });
            return;
          }

          const { items, errors } = validateItems(extracted.raw, {
            kind: tree.kind,
            oracle: courseOracle(ref.dir),
            prefix: `unit${wanted}-q`,
          });
          if (items.length === 0) {
            sendJson(res, 422, {
              error: "no generated item passed validation",
              detail: errors.join("; ") || "the reply contained no items",
            });
            return;
          }

          writeCache(ref.dir, wanted, items, new Date().toISOString());
          // Rejected items are reported, not hidden: a partly invalid generation is surfaced
          // rather than quietly rendered as if it were whole.
          sendJson(res, 200, {
            unit: wanted,
            source: "generated",
            items,
            rejected: errors,
            warnings: errors.length > 0 ? [`${errors.length} generated item(s) rejected`] : [],
          });
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
    }

    // --- interactives and games: authored, else generated and validated -------
    const labMatch = /^\/api\/courses\/([^/]+)\/interactives$/.exec(url);
    if (labMatch) {
      const result = discover();
      const ref = findCourse(result, decodeURIComponent(labMatch[1]));
      if (!ref) {
        sendJson(res, 404, { error: `unknown course: ${labMatch[1]}` });
        return;
      }
      const query = new URL(req.url ?? "/", "http://localhost").searchParams;
      const unit = Number(query.get("unit") ?? "1");
      if (!Number.isFinite(unit) || unit < 1) {
        sendJson(res, 400, { error: "unit must be a positive number" });
        return;
      }

      if (req.method === "GET") {
        try {
          const tree = loadCourseTree(ref, readText);
          const authored = tree.interactives.filter((i) => i.unit === unit);
          if (authored.length > 0) {
            sendJson(res, 200, {
              unit,
              source: "authored",
              interactives: authored,
              warnings: tree.warnings.filter((w) => w.startsWith("interactive")),
            });
            return;
          }
          const cached = readInteractiveCache(ref.dir, unit);
          if (cached) {
            sendJson(res, 200, {
              unit,
              source: "cache",
              generatedAt: cached.generatedAt,
              interactives: cached.interactives,
              warnings: [],
            });
            return;
          }
          sendJson(res, 200, { unit, source: "none", interactives: [], warnings: [] });
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      if (req.method === "POST") {
        try {
          const body = JSON.parse((await readBody(req)) || "{}") as { unit?: unknown };
          const wanted = typeof body.unit === "number" ? body.unit : unit;
          const tree = loadCourseTree(ref, readText);

          const authored = tree.interactives.filter((i) => i.unit === wanted);
          if (authored.length > 0) {
            sendJson(res, 200, { unit: wanted, source: "authored", interactives: authored, warnings: [] });
            return;
          }
          const unitTree = tree.units.find((u) => u.n === wanted);
          if (!unitTree) {
            sendJson(res, 404, { error: `unit ${wanted} not found in ${ref.id}` });
            return;
          }

          const prompt = buildInteractivePrompt({
            courseTitle: tree.title,
            unitTitle: unitTree.title,
            kind: tree.kind,
            concepts: unitTree.concepts,
          });
          const turn = await runTurn(ref.dir, prompt);
          if (turn.error) {
            sendJson(res, 502, { error: "generation failed", detail: turn.error });
            return;
          }
          const extracted = extractSpecs(turn.text);
          if (extracted.error) {
            sendJson(res, 422, {
              error: "generation did not produce a usable interactive",
              detail: extracted.error,
              excerpt: turn.text.slice(0, 400),
            });
            return;
          }
          const { specs, errors } = validateSpecs(extracted.raw, {
            kind: tree.kind,
            oracle: courseOracle(ref.dir),
            prefix: `unit${wanted}-i`,
          });
          if (specs.length === 0) {
            sendJson(res, 422, {
              error: "no generated interactive passed validation",
              detail: errors.join("; ") || "the reply contained no interactives",
            });
            return;
          }
          const interactives = specs.map((spec, i) => ({
            id: `unit${wanted}-i${i + 1}`,
            title: unitTree.title,
            unit: wanted,
            source: "generated" as const,
            spec,
          }));
          writeInteractiveCache(ref.dir, wanted, interactives, new Date().toISOString());
          sendJson(res, 200, { unit: wanted, source: "generated", interactives, rejected: errors, warnings: [] });
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
    }

    // --- quiz results: recorded as history, never as a mastery claim -----------
    const resultsMatch = /^\/api\/courses\/([^/]+)\/results$/.exec(url);
    if (resultsMatch && req.method === "POST") {
      const result = discover();
      const ref = findCourse(result, decodeURIComponent(resultsMatch[1]));
      if (!ref) {
        sendJson(res, 404, { error: `unknown course: ${resultsMatch[1]}` });
        return;
      }
      try {
        const body = JSON.parse((await readBody(req)) || "{}") as Record<string, unknown>;
        const num = (v: unknown): number | null =>
          typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
        const right = num(body.right);
        const wrong = num(body.wrong);
        const total = num(body.total);
        const unit = num(body.unit);
        if (right === null || wrong === null || total === null || unit === null || unit < 1) {
          sendJson(res, 400, { error: "unit, right, wrong and total are required numbers" });
          return;
        }

        appendEvent(ref.dir, {
          v: 1,
          ts: new Date().toISOString(),
          kind: "assessment_result",
          cwd: ref.dir,
          unit,
          quiz_source: typeof body.source === "string" ? body.source : "unknown",
          right,
          wrong,
          total,
          item_ids: Array.isArray(body.itemIds)
            ? body.itemIds.filter((i): i is string => typeof i === "string")
            : [],
        });

        // The attempt QUALIFIES the concept for a badge (rule in assessments.ts, derived from the
        // design's mastery-gate copy) and that award is logged as a `badge` event — the extension's
        // own vocabulary, so its existing projection applies it on its next run.
        //
        // `mastery` stays null because the FILE has not moved yet: socrates-web does not run the
        // extension's projection, and claiming a badge the file does not show is the exact class of
        // unsupported claim this project keeps removing. `pendingBadge` reports the qualification
        // and the deferral instead.
        let pendingBadge: { concept: string; badge: string; state: string } | null = null;
        try {
          const tree = loadCourseTree(ref, readText);
          const unitTree = tree.units.find((u) => u.n === unit);
          const concept = unitTree?.concepts.length === 1 ? unitTree.concepts[0] : null;
          if (concept) {
            const current = parseLearning(ref.dir).schema.concepts.find((c) => c.name === concept)?.badge;
            const award = awardedBadge(right, wrong);
            if (raisesBadge(current, award)) {
              appendEvent(ref.dir, {
                v: 1,
                ts: new Date().toISOString(),
                kind: "badge",
                cwd: ref.dir,
                concept,
                to: award,
                status: award,
                // Not "tool" or "tag": this badge came from an attempt, not from the tutor.
                source: "assessment",
              });
              pendingBadge = { concept, badge: award, state: badgeState(award) };
            }
          }
        } catch (err) {
          console.warn(`[results] mastery evaluation skipped: ${err instanceof Error ? err.message : err}`);
        }

        sendJson(res, 200, {
          recorded: true,
          unit,
          right,
          wrong,
          total,
          mastery: null,
          pendingBadge,
        });
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // --- legacy alias removed in P2 -----------------------------------------
    // /api/learning used to serve the default course. The course routes replace it; the old
    // vanilla UI that consumed it was deleted in the same commit, so a single revert restores both.
    if (url === "/api/learning") {
      sendJson(res, 404, {
        error: "/api/learning was removed",
        use: `/api/courses/<id>/learning`,
      });
      return;
    }

    // --- chat ----------------------------------------------------------------
    if (url === "/api/chat" && req.method === "POST") {
      if (!chatEnabled) {
        sendJson(res, 503, { error: "chat is disabled" });
        return;
      }
      try {
        const parsed = JSON.parse((await readBody(req)) || "{}") as {
          message?: unknown;
          course?: unknown;
        };
        const message = typeof parsed.message === "string" ? parsed.message : "";
        if (!message) {
          sendJson(res, 400, { error: "message required" });
          return;
        }

        // The course decides which directory the tutor runs in, and cwd IS which course it can
        // read and write. Omitting it keeps the pre-course behaviour: the default course.
        const result = discover();
        const wanted = typeof parsed.course === "string" && parsed.course ? parsed.course : null;
        const ref = wanted ? findCourse(result, wanted) : findCourse(result, defaultCourseId());
        if (!ref) {
          sendJson(res, 404, {
            error: `unknown course: ${wanted ?? defaultCourseId()}`,
            known: result.courses.map((c) => c.id),
          });
          return;
        }
        if (!ref.initiated) {
          sendJson(res, 409, {
            error: `not initiated (no MISSION.md): ${ref.id}`,
            hint: "a course must have a mission before a tutor session can run in it",
          });
          return;
        }

        // A switch mid-turn kills the process the tokens are coming from, so surface that on the
        // live stream instead of leaving the client waiting for output that will never arrive.
        const killedTurn = !settled;
        if (killedTurn) finalize("error", `course switched to ${ref.id} mid-turn`);
        const switched = bridge.switchCourse(ref.dir).switched;

        turnLines = [];
        settled = false;
        turnCourse = ref.id;
        ensureBridgeWired();
        const accepted = bridge.send({ type: "prompt", message });
        sendJson(res, 200, { accepted, course: ref.id, switched, killedTurn });
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : "invalid body" });
      }
      return;
    }

    if (url === "/api/watch") {
      res.writeHead(200, SSE_HEADERS);
      res.write(`data: ${JSON.stringify({ type: "watching", courses: discover().courses.map((c) => c.id) }) }\n\n`);
      watchStreams.add(res);
      // A comment frame keeps intermediaries from closing an idle connection.
      const heartbeat = setInterval(() => {
        try {
          res.write(": ping\n\n");
        } catch {
          /* closed */
        }
      }, 25_000);
      req.on("close", () => {
        clearInterval(heartbeat);
        watchStreams.delete(res);
      });
      return;
    }

    if (url === "/api/stream") {
      if (!chatEnabled) {
        sendJson(res, 503, { error: "chat is disabled" });
        return;
      }
      // A stream belongs to one turn. Subscribing to a different course than the active turn
      // would silently deliver another course's tokens, so refuse instead.
      const asked = new URL(req.url ?? "/", "http://localhost").searchParams.get("course");
      if (asked && turnCourse && asked !== turnCourse) {
        sendJson(res, 409, { error: "a turn for another course is active", activeCourse: turnCourse });
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
            for (const res of watchStreams) {
              try {
                res.end();
              } catch {
                /* ignore */
              }
            }
            watchStreams.clear();
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

/**
 * server.ts — Socrates-Web HTTP server.
 *
 * Multi-course resource routes plus the original single-course chat bridge:
 *
 *   GET  /api/courses                every course in the store
 *   GET  /api/courses/:id            derived/manifest course tree (units → modules)
 *   GET  /api/courses/:id/learning   raw LearningData for that course
 *   POST /api/courses                start a course from a subject (creates the store dir)
 *   GET  /api/learning               REMOVED — 404 pointing at /api/courses/:id/learning
 *   POST /api/chat                   prompt the singleton pi agent
 *   GET  /api/stream                 SSE: agent output + {type:"reload"} on schema change
 *   GET  /health
 *
 * Env: SOCRATES_HOME (course store), HOST, PORT (default 3850).
 *
 * `startServer()` is exported so tests can boot the real router on an ephemeral port;
 * importing this module no longer has side effects.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseLearning, type LearningData } from "./learning-parser.ts";
import { buildCourse, type CourseTree, type CourseSource } from "./course-model.ts";
import { ProcessBridge } from "./process-bridge.ts";
import { adoptGlobal, ensureHome, preflight } from "./session.ts";
import { readJournal, readSessionMarkdown, appendEvent } from "./journal.ts";
import { parseHistory } from "./history.ts";
import { buildContinuity, lessonMode } from "./continuity.ts";
import {
  courseRefs,
  courseDir,
  createCourse,
  findCourse,
  reconcileCourse,
  slugifySubject,
  storeRoot,
  validateTitle,
  writeMissionTitle,
  TITLE_MAX,
  type CourseRef,
} from "./course-store.ts";
import {
  awardedBadge,
  badgeState,
  buildGenerationPrompt,
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

/**
 * Budapest mode, ported VERBATIM from `06cee66^:public/app.js:17-20`.
 *
 * The original concatenated this onto the learner's message text, so the server, the transcript and
 * the event log all saw a polluted prompt. It now travels as a structured `mode` and the SERVER
 * injects it, so the message a learner sent stays the message in the record.
 *
 * The wording is deliberately unchanged: it is programming-specific, and rewriting it would be a
 * content decision rather than a recovery.
 */
export const BUDAPEST_MODIFIER =
  "[BUDAPEST MODE ACTIVE] Forbid lecturing, definitions, or syntax explanations. " +
  "Place a difficult, counter-intuitive programming problem or logical paradox in front of the user. " +
  "Force them to struggle and attempt a solution before revealing any documentation.";

export interface ServerOptions {
  /** Interface to bind. Defaults to loopback. */
  host?: string;
  port?: number;
  /** The course store. Defaults to ~/.socrates/courses, or SOCRATES_HOME. */
  store?: string;
  publicDir?: string;
  /** Static root. Defaults to web/dist — the old vanilla UI in public/ was retired in P2. */
  staticDir?: string;
  /** Wire POST /api/chat + GET /api/stream (spawns pi lazily). Off in tests. */
  chat?: boolean;
  /** Hot-reload watchers per course. Off in tests. */
  watch?: boolean;
  /**
   * Compose the app's own tutor session. `false` leaves the bridge bare, which is what the mock-driven
   * chat tests need; the default composes it so a running app always owns its tutor.
   */
  session?: boolean;
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
  /**
   * Loopback by default. The folder browser below lists directory names, which is a wider surface
   * than the rest of this API, and this is a single-user local app — binding every interface would
   * put that listing on the network. Set HOST=0.0.0.0 deliberately to expose it.
   */
  const host = opts.host ?? process.env.HOST ?? "127.0.0.1";
  const store = opts.store ?? storeRoot();
  /**
   * The store helpers take an ENV, not a resolved path — `opts.store` is the directory the agent
   * starts in. Deriving the env from it (rather than re-reading `process.env` at each call site) is
   * what keeps a test's redirected store and the server's own view of it the same store.
   */
  const storeEnv: NodeJS.ProcessEnv = { ...process.env, SOCRATES_HOME: store };
  const publicDir =
    opts.staticDir ??
    opts.publicDir ??
    join(dirname(fileURLToPath(import.meta.url)), "web", "dist");
  if (!existsSync(publicDir)) {
    console.warn(`[static] ${publicDir} does not exist — run \`npm run build\` (web/ has its own build)`);
  }
  const chatEnabled = opts.chat !== false;
  /** `session: false` composes nothing (tests that drive mocks); the default composes the app's own. */
  const watchEnabled = opts.watch !== false;

  const readText = (p: string): string | null => {
    try {
      return existsSync(p) ? readFileSync(p, "utf8") : null;
    } catch {
      return null;
    }
  };

  /** The course list: the store, and nothing else. */
  const discover = (): { courses: CourseRef[]; root: string | null; warnings: string[] } => ({
    courses: courseRefs(),
    root: store,
    warnings: [],
  });

  // --- chat / SSE state ------------------------------------------------------
  let turnLines: string[] = [];
  let settled = true;
  let activeStream: ServerResponse | null = null;
  /** Which course the in-flight (or most recent) turn belongs to. */
  let turnCourse: string | null = null;
  /**
   * T-051 instrumentation. A turn can render its prose and then never settle, and the only way to
   * tell WHICH handshake branch failed is to log the branches: a subscribe that arrives while
   * another response still holds the single subscriber slot is refused at 429, and a subscribe that
   * arrives after the settle gets a replay. Both look identical from the browser — a composer that
   * never re-enables — so the log is the only thing that separates them.
   *
   * `turnSeq` names the turn; a per-response tag names the socket, so a settle can be attributed to
   * the subscriber that received it (or recorded as having had none).
   */
  let turnSeq = 0;
  let currentTurn = 0;
  let streamSeq = 0;
  const stamp = () => new Date().toISOString().slice(11, 23);
  const hs = (turn: number, msg: string) =>
    console.log(`[hs t${turn} ${stamp()}] ${msg}`);
  /**
   * Change notifications get their OWN channel. `/api/stream` carries a chat turn and deliberately
   * allows a single subscriber; a page that only wants to know when a file changed must not have to
   * occupy that slot, and must not be starved of updates because a turn is open elsewhere.
   */
  const watchStreams = new Set<ServerResponse>();
  /**
   * A course whose directory is waiting to be made to match its document.
   *
   * Windows cannot rename a live process's cwd and the agent's cwd IS the course directory, so a
   * rename while a turn is in flight is DEFERRED rather than forced — breaking a running turn to
   * rename a folder would be a worse bug than a name that lands a few seconds late. Only the most recent
   * request is kept, because the reconcile re-reads the H1 anyway.
   *
   * IT EXPIRES, and that is not a detail. A deferral used to survive indefinitely in memory, so a rename
   * asked for during one turn would fire on the NEXT unrelated settle — which is how a stale test title
   * came back hours later and tried to rename a real course. A pending request is only meaningful for the
   * turn it was deferred behind; after that the learner has long since moved on, and a read reconciles
   * anyway.
   */
  let pendingReconcile: { id: string; title: string | null; expiresAt: number } | null = null;

  function clearPending(): void {
    pendingReconcile = null;
  }

  /**
   * How long a deferred rename stays meaningful.
   *
   * Long enough for a turn to finish (the longest seen is ~5 minutes), short enough that it cannot be
   * carried into a different sitting. Beyond this the learner has moved on, and a read reconciles anyway.
   */
  const DEFER_TTL_MS = 10 * 60 * 1000;
  /**
   * The app's OWN tutor session, composed once here and printed so it can never hide. `chat: false`
   * (tests) skips it entirely — no preflight, no adoption, no spawn.
   */
  const session =
    chatEnabled && opts.session !== false
      ? (() => {
          // First run: adopt the user's provider, model and credentials ONCE. After that the app owns its
          // config and never reads the global one again. Re-runnable on purpose — credentials rotate, and
          // a stale copy surfaces as a 401 that reads like a broken app.
          // Materialise the home from what the repo ships, then adopt, then check. Order matters: the
          // preflight checks the HOME, so the assets must be in it first.
          const prepared = ensureHome(storeEnv);
          if (!prepared.ok) for (const problem of prepared.problems) console.error(`[session] ${problem}`);
          let pre = preflight(storeEnv);
          if (!pre.ok && pre.problems.some((p) => p.includes("credentials") || p.includes("no provider"))) {
            const adopted = adoptGlobal(storeEnv);
            console.log(`[session] ${adopted.ok ? "adopted" : "adoption skipped"}: ${adopted.message}`);
            if (adopted.ok) pre = preflight(storeEnv);
          }
          console.log(
            `[session] home=${pre.session.assetPaths.home} model=${pre.session.provider.provider || "?"}/${pre.session.provider.model || "?"} (${pre.session.provider.source})`,
          );
          if (!pre.ok) {
            // LOUDLY, and with every missing thing named. A lesson that sits silent with no tutor is the
            // failure this prevents, and there is deliberately no silent fallback to the global harness —
            // a fallback that restores the old coupling is how the original bug comes back.
            console.error("[session] PREFLIGHT FAILED — the tutor cannot start:");
            for (const problem of pre.problems) console.error(`  - ${problem}`);
          }
          return pre;
        })()
      : null;

  const bridge = new ProcessBridge(store, session ? { env: session.session.env, args: session.session.args } : null);

  function finalize(kind: "done" | "error", detail?: unknown): void {
    const wasSettled = settled;
    settled = true;
    const signal =
      kind === "done"
        ? "data: [DONE]\n\n"
        : `data: [ERROR] ${JSON.stringify({ error: detail ?? "unknown" })}\n\n`;
    const res = activeStream;
    const heldBy = (res as { __hsTag?: string } | null)?.__hsTag;
    activeStream = null;
    hs(
      currentTurn,
      `SETTLE kind=${kind} alreadySettled=${wasSettled} subscriber=${heldBy ?? "NONE"} ` +
        `bufferedLines=${turnLines.length}` +
        (res ? "" : " — [DONE] had nowhere to go"),
    );
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
  // the store root — that is how an event log full of absolute paths ends up written
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
        // Only a deferral for the course that just settled may fire; an unrelated turn must never move a
        // directory.
        flushPending(turnCourse);
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

  /**
   * Announce a course rename on the existing watch channel.
   *
   * There is no alias table and no old-id mapping (deliberately — that machinery exists to preserve a
   * name that is not the truth), so an open page has to FOLLOW the rename rather than be redirected
   * later. `from`/`to` are course ids, i.e. the slugs, which are also the directory names.
   */
  function pushRenamed(from: string, to: string): void {
    const frame = `data: ${JSON.stringify({ type: "renamed", from, to })}\n\n`;
    for (const res of watchStreams) {
      try {
        res.write(frame);
      } catch {
        watchStreams.delete(res);
      }
    }
  }

  /**
   * The ONE step that makes the filesystem agree with MISSION.md.
   *
   * Called from every path that can change the H1 — a UI rename, the skill writing its title, or a hand
   * edit seen on the next read — so there is exactly one writer and one mover. Renaming the ACTIVE
   * course goes through the bridge: `moveCourseDir` tears the child down with the same `terminate()`
   * `switchCourse` uses, the move runs with the directory free, and `switchCourse` respawns in the new
   * one. A rename requested while a turn is in flight is deferred to keep that turn alive.
   */
  /**
   * Apply a rename that was deferred because a turn was in flight. Called on settle and before a read,
   * so the deferred name lands as soon as the agent stops rather than waiting for the learner to act.
   *
   * It refuses to fire once the deferral has expired, and it refuses when the pending course is not the
   * one that just settled — an unrelated turn settling must never move a directory.
   */
  function flushPending(settledCourseId?: string | null): void {
    const pending = pendingReconcile;
    if (!pending || bridge.isBusy) return;
    if (Date.now() > pending.expiresAt) {
      console.log(`[rename] discarded an expired deferred rename for ${pending.id}`);
      clearPending();
      return;
    }
    if (settledCourseId && settledCourseId !== pending.id) return;
    clearPending();
    const { id, title } = pending;
    const ref = findCourse(discover(), id);
    if (!ref) return;
    if (title) {
      const wrote = writeMissionTitle(ref.dir, title);
      if (!wrote.ok) {
        console.error(`[rename] deferred title write failed: ${wrote.error}`);
        return;
      }
    }
    reconcile(id);
  }

  function reconcile(id: string): {
    ok: boolean;
    id: string;
    renamed?: boolean;
    deferred?: boolean;
    error?: string;
  } {
    const ref = findCourse(discover(), id);
    if (!ref) return { ok: false, id, error: `unknown course: ${id}` };
    if (bridge.isBusy) {
      pendingReconcile = { id, title: null, expiresAt: Date.now() + DEFER_TTL_MS };
      return { ok: true, id, deferred: true };
    }

    const active = resolve(bridge.courseDir) === resolve(ref.dir);
    // Read the wanted slug BEFORE moving, so the collision is refused with nothing touched.
    const wanted = slugifySubject(parseLearning(ref.dir).mission.title);
    if (wanted && wanted !== id && existsSync(courseDir(wanted, storeEnv))) {
      return { ok: false, id, error: `a course called "${wanted}" already exists — pick a different title` };
    }
    if (!wanted || wanted === id) return { ok: true, id, renamed: false };

    // Our own `fs.watch` holds a handle inside the directory, and Windows refuses to rename a directory
    // with an open handle on it (`EPERM`) — so the watcher has to let go before the move and be rebuilt
    // after it. Only visible with watching on, which is how the app actually runs.
    const wasWatching = watchEnabled;
    if (wasWatching) closeWatchers();

    let result;
    if (active) {
      const toDir = courseDir(wanted, storeEnv);
      const moved = bridge.moveCourseDir(ref.dir, toDir);
      if (!moved.ok) {
        // The move failed and the agent is already torn down. Respawn where it was so the course still
        // works, and report the failure rather than leaving a half-applied rename behind.
        if (wasWatching) resyncWatchers();
        bridge.switchCourse(ref.dir);
        console.error(`[rename] could not move ${ref.dir}: ${moved.error}`);
        return { ok: false, id, error: `this course could not be renamed — the folder is in use` };
      }
      result = {
        ok: true as const,
        renamed: true as const,
        id: wanted,
        dir: toDir,
        from: id,
        to: wanted,
        fromDir: ref.dir,
      };
      bridge.switchCourse(toDir);
      if (turnCourse === id) turnCourse = wanted;
    } else {
      result = reconcileCourse(id, storeEnv);
    }

    if (wasWatching) resyncWatchers();

    if (!result.ok) return { ok: false, id, error: result.error };
    if (result.renamed) {
      console.log(`[rename] ${result.from} -> ${result.to}`);
      pushRenamed(result.from, result.to);
    }
    return { ok: true, id: result.id, renamed: result.renamed };
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
            // MISSION.md is watched because it carries the NAME: the tutor writes its title there, and the
            // filesystem has to follow. The reconcile below is deferred while a turn is running (the
            // agent's cwd is the course directory) and lands on settle, which is the same path a UI
            // rename takes.
            const watched = filename === "SCHEMA.md" || filename === "COURSE.md" || filename === "MISSION.md";
            if (filename && !watched) return;
            const existing = watchTimers.get(ref.id);
            if (existing) clearTimeout(existing);
            watchTimers.set(
              ref.id,
              setTimeout(() => {
                watchTimers.delete(ref.id);
                console.log(`[watcher] ${ref.id}: ${filename ?? "change"} — re-parsing (150ms debounce)`);
                // A name change moves the directory first, so the reload below reads the new id.
                reconcile(ref.id);
                const current = findCourse(discover(), ref.id);
                if (current) pushReload(current.id);
              }, 150),
            );
          }),
        );
      } catch {
        /* ignore unwatchable dirs */
      }
    }
    console.log(`[watcher] watching ${watchers.length} course(s) in ${store}`);
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

  /**
   * Every route lives in here. A throw anywhere in it used to leave the request open forever — the
   * socket stayed connected and the client waited, which is far worse than a 500 because it looks
   * like a slow server rather than a bug. Any exception is now answered.
   */
  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = (req.url || "/").split("?")[0];

    // --- courses -------------------------------------------------------------
    if (url === "/api/courses" && req.method === "GET") {
      const result = discover();
      sendJson(res, 200, {
        root: result.root,
        warnings: result.warnings,
        courses: result.courses,
      });
      return;
    }

    if (url === "/api/courses" && req.method === "POST") {
      try {
        const body = JSON.parse((await readBody(req)) || "{}") as {
          subject?: unknown;
          dir?: unknown;
          label?: unknown;
          order?: unknown;
          action?: unknown;
        };
        // The articulate entry point: a SUBJECT, not a directory. Nothing on disk is pointed at, so
        // this is checked FIRST — a request carrying a subject has no dir and must not be turned away
        // by the directory guard below.
        if (typeof body.subject === "string") {
          const created = createCourse(body.subject);
          if (!created.ok) {
            sendJson(res, 400, { error: created.error });
            return;
          }
          resyncWatchers();
          sendJson(res, 201, { ok: true, id: created.id, dir: created.dir, courses: discover().courses });
          return;
        }

        sendJson(res, 400, { error: "subject required" });
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : "invalid body" });
      }
      return;
    }

    const courseMatch = /^\/api\/courses\/([^/]+)$/.exec(url);
    // Rename: the H1 changes, then the ONE reconcile step moves the directory to match it.
    if (courseMatch && req.method === "PATCH") {
      const id = decodeURIComponent(courseMatch[1]);
      const ref = findCourse(discover(), id);
      if (!ref) {
        sendJson(res, 404, { error: `unknown course: ${id}` });
        return;
      }
      let body: { title?: unknown };
      try {
        body = JSON.parse((await readBody(req)) || "{}") as { title?: unknown };
      } catch {
        sendJson(res, 400, { error: "body must be JSON" });
        return;
      }
      if (typeof body.title !== "string") {
        sendJson(res, 400, { error: "title is required", maxLength: TITLE_MAX });
        return;
      }
      const valid = validateTitle(body.title);
      if (!valid.ok) {
        sendJson(res, 400, { error: valid.error, maxLength: TITLE_MAX });
        return;
      }

      // Collision is checked BEFORE anything is written, so a refusal leaves the old name and the old
      // directory exactly as they were rather than half-applied.
      const wanted = slugifySubject(valid.clean);
      if (wanted !== ref.id && existsSync(courseDir(wanted, storeEnv))) {
        sendJson(res, 409, {
          error: `a course called "${wanted}" already exists — pick a different title`,
          id: ref.id,
        });
        return;
      }
      if (bridge.isBusy) {
        // Never rename under a live agent (Windows cannot move its cwd). Defer, and say so.
        pendingReconcile = { id: ref.id, title: valid.clean, expiresAt: Date.now() + DEFER_TTL_MS };
        sendJson(res, 202, { deferred: true, id: ref.id, pending: { title: valid.clean } });
        return;
      }

      const previous = readText(join(ref.dir, ".agent", "learning", "MISSION.md")) ?? "";
      const wrote = writeMissionTitle(ref.dir, valid.clean);
      if (!wrote.ok) {
        sendJson(res, 500, { error: wrote.error });
        return;
      }
      const moved = reconcile(ref.id);
      if (!moved.ok) {
        // The H1 was written and the move failed, so put the document back rather than leave the name
        // and the directory disagreeing — a state the next read would keep trying to repair.
        writeFileSync(join(ref.dir, ".agent", "learning", "MISSION.md"), previous, "utf8");
        sendJson(res, 409, { error: moved.error, id: ref.id });
        return;
      }
      sendJson(res, 200, { id: moved.id, title: valid.clean, renamed: moved.renamed === true, from: ref.id });
      return;
    }

    if (courseMatch && req.method === "GET") {
      // D3: a hand-edited H1 renames the course on the next read, so a read reconciles first. A course
      // whose document disagrees with its directory moves; every other read is a slug compare.
      flushPending();
      reconcile(decodeURIComponent(courseMatch[1]));
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
    /**
     * The settled transcript for the most recent session in a course.
     *
     * The client held the conversation in React state only, so a refresh dropped it while the data sat in
     * pi's session file. This reads that file back. Settled turns only — see `history.ts` for why a
     * half-turn is dropped rather than marked.
     */
    const historyMatch = /^\/api\/courses\/([^/]+)\/history$/.exec(url);
    if (historyMatch && req.method === "GET") {
      const ref = findCourse(discover(), decodeURIComponent(historyMatch[1]));
      if (!ref) {
        sendJson(res, 404, { error: `unknown course: ${historyMatch[1]}` });
        return;
      }
      // The newest session wins: a course accumulates one per sitting, and the console shows where the
      // learner left off. Older sessions are readable through the journal.
      const sessions = readJournal(ref.dir).sessions.filter((s) => s.transcript);
      const newest = sessions.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))[0];
      if (!newest?.transcript || !existsSync(newest.transcript)) {
        sendJson(res, 200, { turns: [], session: null, truncated: false });
        return;
      }
      try {
        // A long course produces a large JSONL; the console shows the recent conversation, so the tail is
        // enough and the endpoint never loads a whole session to render one screen.
        const raw = readFileSync(newest.transcript, "utf8");
        const all = parseHistory(raw);
        const TURNS = 40;
        const turns = all.slice(-TURNS);
        sendJson(res, 200, {
          turns,
          session: newest.file,
          truncated: all.length > turns.length,
        });
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

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

    /**
     * Cross-session continuity for a course: every concept's standing NOW, and the session history
     * reconciled against it.
     *
     * One payload because the two cannot be read apart: a session record that says a misconception was
     * live is only meaningful next to the registry that says whether it still is.
     */
    const continuityMatch = /^\/api\/courses\/([^/]+)\/continuity$/.exec(url);
    if (continuityMatch && req.method === "GET") {
      const ref = findCourse(discover(), decodeURIComponent(continuityMatch[1]));
      if (!ref) {
        sendJson(res, 404, { error: `unknown course: ${continuityMatch[1]}` });
        return;
      }
      try {
        const learning = parseLearning(ref.dir);
        const registry = new Map(learning.schema.misconceptions.map((m) => [m.id, m]));
        const view = buildContinuity(learning, readJournal(ref.dir).sessions, registry);
        sendJson(res, 200, { ...view, mode: lessonMode({ asked: false, standing: null, hasHistory: view.sessions.length > 0 }) });
      } catch (err) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
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
          mode?: unknown;
        };
        const message = typeof parsed.message === "string" ? parsed.message : "";
        if (!message) {
          sendJson(res, 400, { error: "message required" });
          return;
        }

        // The course decides which directory the tutor runs in, and cwd IS which course it can read
        // and write. It is REQUIRED: with one store there is no default course to fall back to.
        const result = discover();
        const wanted = typeof parsed.course === "string" && parsed.course ? parsed.course : null;
        if (!wanted) {
          sendJson(res, 400, { error: "course required", known: result.courses.map((c) => c.id) });
          return;
        }
        const ref = findCourse(result, wanted);
        if (!ref) {
          sendJson(res, 404, { error: `unknown course: ${wanted}`, known: result.courses.map((c) => c.id) });
          return;
        }

        // A switch mid-turn kills the process the tokens are coming from, so surface that on the
        // live stream instead of leaving the client waiting for output that will never arrive.
        const killedTurn = !settled;
        if (killedTurn) finalize("error", `course switched to ${ref.id} mid-turn`);
        const switched = bridge.switchCourse(ref.dir).switched;

        // The mode is applied HERE, not by the client, so `message` stays exactly what the learner
        // typed while the tutor still receives the instruction.
        const budapest = parsed.mode === "budapest";
        const prompt = budapest ? `${message}

${BUDAPEST_MODIFIER}` : message;

        turnLines = [];
        settled = false;
        currentTurn = ++turnSeq;
        hs(currentTurn, `ACCEPT course=${ref.id} via=${killedTurn ? "switch" : "new"} priorSubscriber=${activeStream ? "held" : "none"}`);
        turnCourse = ref.id;
        ensureBridgeWired();
        const accepted = bridge.send({ type: "prompt", message: prompt });
        sendJson(res, 200, { accepted, course: ref.id, switched, killedTurn, mode: budapest ? "budapest" : "default" });
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
      const tag = `s${++streamSeq}`;
      (res as { __hsTag?: string }).__hsTag = tag;
      if (activeStream) {
        const held = (activeStream as { __hsTag?: string }).__hsTag;
        hs(currentTurn, `SUBSCRIBE ${tag} REFUSED 429 — held by ${held ?? "?"}, settled=${settled}`);
        sendJson(res, 429, { error: "an SSE stream is already active" });
        return;
      }
      hs(currentTurn, `SUBSCRIBE ${tag} accepted — settled=${settled}, replaying ${turnLines.length} line(s)`);
      res.writeHead(200, SSE_HEADERS);
      for (const line of turnLines) res.write(`data: ${line}\n\n`);
      if (settled) {
        hs(currentTurn, `REPLAY ${tag} settled before subscribing — sending [DONE] and ending`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      activeStream = res;
      hs(currentTurn, `ATTACH ${tag} as the live subscriber`);
      req.on("close", () => {
        if (activeStream === res) {
          activeStream = null;
          hs(currentTurn, `CLOSE ${tag} released the subscriber slot`);
        } else {
          hs(currentTurn, `CLOSE ${tag} (was not the live subscriber)`);
        }
      });
      return;
    }

    /**
     * What tutor this app is running as, and what is wrong if it cannot start.
     *
     * A lesson that sits silent with no tutor is the failure this prevents, so the client asks before
     * offering a composer. It reports the composed session rather than the ambient one: there is no
     * fallback, so this IS the answer.
     */
    if (url === "/api/session") {
      sendJson(res, 200, {
        chat: chatEnabled,
        ok: session ? session.ok : false,
        problems: session ? session.problems : ["this server was started without a tutor session"],
        provider: session?.session.provider.provider ?? null,
        model: session?.session.provider.model ?? null,
        source: session?.session.provider.source ?? null,
        home: session?.session.assetPaths.home ?? null,
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
  }

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[server] unhandled error for ${req.method} ${req.url}:`, message);
      try {
        if (!res.headersSent) {
          res.writeHead(500, JSON_HEADERS);
          res.end(JSON.stringify({ error: message }));
        } else {
          res.end();
        }
      } catch {
        /* the socket is already gone */
      }
    });
  });

  resyncWatchers();

  return new Promise<RunningServer>((resolvePromise) => {
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      console.log(`socrates-web: http://localhost:${actualPort}`);
      console.log(`course store:   ${store}`);
      console.log(`listening on:   ${host}:${actualPort}`);
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



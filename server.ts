/**
 * server.ts — Phase 1 of Socrates-Web.
 * Zero-dependency HTTP server exposing the parsed learning state as JSON.
 *
 *   GET /api/learning  -> structured learning state (mission/plan/schema)
 *   GET / or /health   -> plain-text status
 *
 * Target project dir: PROJECT_DIR env var, falling back to process.cwd().
 * Port: PORT env var, defaulting to 3850.
 */
import { createServer } from "node:http";
import { parseLearning } from "./learning-parser.ts";

const PORT = Number(process.env.PORT) || 3850;
const projectDir = process.env.PROJECT_DIR || process.cwd();

const server = createServer((req, res) => {
  const url = req.url || "/";

  if (url === "/api/learning") {
    try {
      const data = parseLearning(projectDir);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(data, null, 2));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      );
    }
    return;
  }

  if (url === "/" || url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(
      "Socrates-Web API\n\nGET /api/learning — structured learning state\n(Phase 1 — parser + server)",
    );
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`socrates-web (Phase 1): http://localhost:${PORT}`);
  console.log(`project dir: ${projectDir}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

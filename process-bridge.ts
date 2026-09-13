/**
 * process-bridge.ts — singleton subprocess manager for the `pi` agent (RPC mode).
 *
 * Spawns exactly ONE long-lived `pi --mode rpc` process, speaks JSONL over its
 * stdio, and re-spawns lazily if it crashes. Line framing splits on `\n` only
 * (manual StringDecoder buffer) — NOT node:readline, which the pi RPC docs
 * explicitly flag as non-compliant (it splits U+2028/U+2029 inside JSON strings).
 *
 * Spawns the bundled `pi` (declared npm dependency) via the current node runtime.
 * Env overrides (tests): PI_BIN + PI_ARGS — e.g. `PI_BIN=node PI_ARGS=test/mock-pi.mjs`.
 */
import { execSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StringDecoder } from "node:string_decoder";

function resolvePiCli(): string {
  // The pi package is ESM-only — its `exports` map has no "require" condition,
  // so require.resolve() throws ERR_PACKAGE_PATH_NOT_EXPORTED. import.meta.resolve
  // honors the "import" condition. Resolve the main entry, walk to the package
  // root, then honor the declared bin.pi path.
  const entry = import.meta.resolve("@earendil-works/pi-coding-agent");
  const root = dirname(dirname(fileURLToPath(entry))); // <root>/dist/index.js → <root>
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    bin?: { pi?: string };
  };
  if (!pkg.bin?.pi) {
    throw new Error("@earendil-works/pi-coding-agent declares no bin.pi");
  }
  return join(root, pkg.bin.pi);
}

export type LineHandler = (line: string) => void;
export type ExitHandler = (code: number | null, signal: NodeJS.Signals | null) => void;

export class ProcessBridge {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly bin: string;
  private readonly args: string[];
  private readonly cwd: string;
  private cliPath: string | null = null;
  private buffer = "";
  private readonly decoder = new StringDecoder("utf8");
  private readonly lineHandlers = new Set<LineHandler>();
  private readonly exitHandlers = new Set<ExitHandler>();
  private shuttingDown = false;
  private busy = false;

  constructor(cwd: string) {
    this.cwd = cwd;
    // Default runtime: the current node process running the bundled pi CLI
    // (declared dependency). PI_BIN/PI_ARGS remain escape hatches — e.g. tests
    // set PI_BIN=node and PI_ARGS=test/mock-pi.mjs to bypass the real agent.
    this.bin = process.env.PI_BIN ?? process.execPath;
    this.args = (process.env.PI_ARGS ?? "").split(/\s+/).filter(Boolean);
    process.on("exit", () => this.kill());
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  /** Called by the server when agent_settled is observed. */
  markIdle(): void {
    this.busy = false;
  }

  onLine(handler: LineHandler): void {
    this.lineHandlers.add(handler);
    this.ensureSpawned();
  }

  onExit(handler: ExitHandler): void {
    this.exitHandlers.add(handler);
  }

  /** Write one JSONL command to the agent's stdin. Spawns on first use. */
  send(command: unknown): boolean {
    this.ensureSpawned();
    const child = this.child;
    if (!child || !child.stdin.writable) return false;
    const obj = command as { type?: string } | null;
    if (obj && obj.type === "prompt") this.busy = true;
    child.stdin.write(JSON.stringify(command) + "\n");
    return true;
  }

  private ensureSpawned(): void {
    if (this.child && this.child.exitCode === null && !this.child.killed) return;
    this.spawn();
  }

  private buildArgs(): string[] {
    if (this.args.length) return this.args; // explicit PI_ARGS override (tests)
    if (this.cliPath === null) this.cliPath = resolvePiCli();
    return [this.cliPath, "--mode", "rpc"];
  }

  private spawn(): void {
    let args: string[];
    try {
      args = this.buildArgs();
    } catch (err) {
      console.error(
        `[process-bridge] cannot locate bundled pi: ${err instanceof Error ? err.message : String(err)}`,
      );
      return; // child stays null; the next send() retries and reports not-accepted
    }
    // Spawn the node runtime directly (never a .cmd shim), so no shell wrapper
    // and no orphaned cmd.exe can survive on Windows.
    const child: ChildProcessWithoutNullStreams = spawn(this.bin, args, {
      cwd: this.cwd,
      windowsHide: true,
    });
    this.child = child;

    child.stdout.on("data", (chunk: Buffer) => this.onStdout(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      this.emitLine(JSON.stringify({ type: "__stderr__", text: chunk.toString() }));
    });

    child.on("error", (err) => {
      console.error(`[process-bridge] spawn error: ${err.message}`);
      this.child = null;
    });

    child.on("exit", (code, signal) => {
      this.buffer = "";
      if (this.shuttingDown) return;
      console.error(
        `[process-bridge] pi exited code=${code} signal=${signal ?? "none"} — re-spawn on next input`,
      );
      this.child = null;
      this.busy = false;
      for (const h of this.exitHandlers) {
        try {
          h(code, signal);
        } catch {
          /* ignore */
        }
      }
    });
  }

  private onStdout(chunk: Buffer): void {
    this.buffer += this.decoder.write(chunk);
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      let line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.length > 0) this.emitLine(line);
    }
  }

  private emitLine(line: string): void {
    for (const h of this.lineHandlers) {
      try {
        h(line);
      } catch (err) {
        console.error("[process-bridge] line handler error:", err);
      }
    }
  }

  kill(): void {
    this.shuttingDown = true;
    const child = this.child;
    if (!child) return;
    this.child = null;
    // Windows: shell:true puts cmd.exe between us and the node agent, so kill
    // the whole tree synchronously (taskkill /T) to avoid orphaned processes.
    if (process.platform === "win32" && child.pid) {
      try {
        execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore", windowsHide: true });
      } catch {
        /* taskkill may fail during process exit; fall through to child.kill */
      }
    }
    try {
      child.stdin.end();
    } catch {
      /* ignore */
    }
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

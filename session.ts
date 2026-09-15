/**
 * session.ts — the app's OWN tutor session, composed in one place.
 *
 * The tutor used to be whatever `pi` happened to be on the machine: the global harness at `~/.pi/agent`,
 * with its `AGENTS.md`, `STANDARDS.md`, `LESSONS.md`, every skill the developer had installed, and the
 * project instructions for whatever repository the session was in. That is how a wheel-building learner
 * was read the app's internals — "Parser contract gone … learning-parser.ts", "Scaffold written. Verified
 * by running the app's own learning-parser.ts" — and the skill file's own process notes:
 * "Push for a concrete deliverable, not 'understand wheels.' Good answers look like: …", and
 * "**Step 3 — The 20-hour deconstruction.** … Marks: ★ = I judge these carry ~80% of the result."
 *
 * `composeSession()` is the ONLY thing that constructs a session, and it is a pure function so the
 * preflight and the bridge agree by construction.
 *
 * WHAT ISOLATES THE SESSION: `PI_CODING_AGENT_DIR`. Proven on real spawned children — pointed at an
 * app-owned directory, pi served 2 skills and 2 extensions and none of the harness; with the real harness
 * it served 10 skills and 7 extensions. The skill flags change nothing (`--skill <dir>` and three
 * `--skill <file>` flags both served the same two), so they are not used: each addition is another way to
 * break a working spawn.
 *
 * WHAT DOES **NOT** WORK: seeding `settings.json`. pi resolves its default model from its CACHED catalog
 * (`models-store.json`), not from settings, so an app-owned home has no cache and the configured default
 * is silently ignored:
 *
 *   settings.json only                                -> openrouter/moonshotai/kimi-k2.6
 *   settings.json + auth.json                         -> anthropic/claude-opus-4-8
 *   settings.json + models-store.json                 -> deepseek/deepseek-flash
 *   no models-store, --model deepseek/deepseek-flash  -> deepseek/deepseek-flash
 *
 * So the model is passed EXPLICITLY on the command line. There is no reliable implicit path.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { storeRoot } from "./course-store.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The app's own pi home, shipped in the repo. Never `~/.pi/agent`. */
export function appPiHome(env: NodeJS.ProcessEnv = process.env): string {
  // Beside the store, so `SOCRATES_HOME` redirects it and tests never touch a real one.
  const override = env.SOCRATES_PI_HOME;
  if (override) return resolve(override);
  return join(dirname(storeRoot(env)), "pi");
}

/** Where the repo ships the app's extensions, skills and templates. */
export function shippedAssets(): string {
  return join(HERE, "pi");
}

/** What the app needs from the user's global pi config, read ONCE, for adoption. */
export function globalPiDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.SOCRATES_GLOBAL_PI ?? join(homedir(), ".pi", "agent");
}

export interface ProviderChoice {
  provider: string;
  model: string;
  /** Where the pair came from, printed so a wrong choice can never hide. */
  source: "settings" | "env" | "adopted-file" | "none";
}

/**
 * The provider/model the tutor runs as.
 *
 * Order, and the reason for it: an explicit env pair wins (the escape hatch), then the app's adopted
 * choice — the app OWNS its config after adoption and never reads the global one again — then the user's
 * global settings, which is the first run.
 */
export function resolveProvider(env: NodeJS.ProcessEnv = process.env, home = appPiHome(env)): ProviderChoice {
  if (env.SOCRATES_PROVIDER && env.SOCRATES_MODEL) {
    return { provider: env.SOCRATES_PROVIDER, model: env.SOCRATES_MODEL, source: "env" };
  }
  const adopted = join(home, "session.json");
  if (existsSync(adopted)) {
    try {
      const parsed = JSON.parse(readFileSync(adopted, "utf8")) as { provider?: string; model?: string };
      if (parsed.provider && parsed.model) {
        return { provider: parsed.provider, model: parsed.model, source: "adopted-file" };
      }
    } catch {
      /* a corrupt adoption file falls through to the global read, which is re-runnable */
    }
  }
  const settings = join(globalPiDir(env), "settings.json");
  if (existsSync(settings)) {
    try {
      const parsed = JSON.parse(readFileSync(settings, "utf8")) as {
        defaultProvider?: string;
        defaultModel?: string;
      };
      if (parsed.defaultProvider && parsed.defaultModel) {
        return { provider: parsed.defaultProvider, model: parsed.defaultModel, source: "settings" };
      }
    } catch {
      /* falls through */
    }
  }
  return { provider: "", model: "", source: "none" };
}

export interface Session {
  /** The environment the child must be spawned with. */
  env: NodeJS.ProcessEnv;
  /** The child's argv, WITHOUT the CLI path (the bridge prepends its resolved binary). */
  args: string[];
  /** What the preflight checks, so it and the spawn cannot disagree. */
  assetPaths: { home: string; extensions: string[]; skills: string[]; templates: string; auth: string };
  /** The model, for display and logging. */
  provider: ProviderChoice;
}

/**
 * Compose the session. Pure: no filesystem writes, no spawning, no globals.
 *
 * `--no-context-files` is the ONE flag kept beyond `--mode rpc`. It is what stops pi reading the
 * `AGENTS.md` sitting above the course directory, which is the recitation at the source. Nothing else is
 * added: `--no-extensions`, `--skill`, `--system-prompt` and `PI_OFFLINE` were all measured and either
 * changed nothing or broke what works. In particular the system prompt is NOT replaced — it carries the
 * tool snippets and guidelines extensions opt into, and dropping it would take away the tutor's ability
 * to write the course files.
 */
/**
 * The learner's locale, fixed rather than configured.
 *
 * Owner's decision, 2026-09-15: "always assume the USA. Assume I live in Texas … This is not a per learner
 * setting. We can change that down the line if this turns into something, but for now we need to just keep
 * things simple." Recorded in DECISIONS.md with that reversal path.
 */
export const LOCALE_INSTRUCTION =
  "The learner is in the United States (Texas). Use US English spelling and US conventions. " +
  "Do not use UK trade slang or assume British terminology: words like \"sparky\", \"ceiling rose\", " +
  "\"consumer unit\" and \"earth\" are UK usage — use the terms this learner would hear instead " +
  "(electrician, ceiling fixture, breaker panel, ground), and if a term is genuinely unavoidable, define it " +
  "in the same sentence.";

/**
 * Every skill shipped in the app's pi home.
 *
 * Scanned, not listed, so adding a file cannot leave it unserved — the failure mode T-058 records. An absent
 * or unreadable directory returns an empty list rather than throwing: a session with no skills starts and the
 * lesson says so, which beats refusing to boot.
 */
export function shippedSkills(home: string): string[] {
  try {
    return readdirSync(join(home, "skills"))
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => join(home, "skills", f));
  } catch {
    return [];
  }
}

export function composeSession(env: NodeJS.ProcessEnv = process.env): Session {
  const home = appPiHome(env);
  const shipped = shippedAssets();
  const provider = resolveProvider(env, home);
  // The paths pi will actually read: the app's HOME, not the repo. `ensureHome` puts the shipped assets
  // there; checking the repo instead would pass a preflight for a session that cannot start.
  // SERVE EVERY SHIPPED SKILL, by scanning rather than listing.
  //
  // The list used to be hand-maintained, and that is a silent failure with a known precedent: T-058 records a
  // skill that "is served in NO configuration" while the app dispatched it, producing a lesson whose tutor had
  // no instructions for the task. Adding `skill-explain-concept.md` for D9 would have repeated it. A directory
  // read cannot go stale.
  const assets = {
    home,
    extensions: [join(home, "extensions", "learning"), join(home, "extensions", "passivity")],
    skills: shippedSkills(home),
    templates: join(home, "templates", "learning"),
    auth: join(home, "auth.json"),
  };

  const args = ["--mode", "rpc", "--no-context-files"];
  if (provider.provider && provider.model) args.push("--model", `${provider.provider}/${provider.model}`);
  // D8 + D15 — the learner's locale, stated rather than guessed.
  //
  // Reports #8 (`…509aae37`, "what is a sparky? … is this UK talk?") and #15 (`…04282f90`, "thinks I'm in the
  // UK but I'm in the USA"). The model defaulted to its training prior — UK English, UK trade terms — because
  // nothing in the shipped prompts mentioned a locale at all. APPENDED, never `--system-prompt`: replacing the
  // system prompt would drop the tool snippets and guidelines the extensions opt into, which `composeSession`'s
  // header already warns about.
  //
  // A CONSTANT by the owner's decision ("this is not a per learner setting … keep things simple"). Two
  // sessions in the same environment therefore instruct the tutor identically, which is what makes the
  // behaviour reproducible.
  args.push("--append-system-prompt", LOCALE_INSTRUCTION);

  return {
    env: { ...env, PI_CODING_AGENT_DIR: home },
    args,
    assetPaths: assets,
    provider,
  };
}

/**
 * Materialise the app's pi home from what the repo ships.
 *
 * The repo holds the assets (`pi/extensions`, `pi/skills`, `pi/templates`, `pi/settings.json`) and the
 * runtime home lives beside the store, so something has to put one inside the other. This does, and it is
 * idempotent: the app OWNS these files, so a stale copy from a previous version is replaced on every
 * start rather than left to drift. `auth.json` and `session.json` are never touched — they are the user's
 * adopted credentials and choice, and overwriting them on boot is how a rotation gets silently undone.
 */
export function ensureHome(env: NodeJS.ProcessEnv = process.env): { ok: boolean; problems: string[] } {
  const home = appPiHome(env);
  const shipped = shippedAssets();
  const problems: string[] = [];

  const copyTree = (from: string, to: string) => {
    if (!existsSync(from)) {
      problems.push(`the app is missing a shipped asset: ${from}`);
      return;
    }
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const src = join(from, entry.name);
      const dest = join(to, entry.name);
      if (entry.isDirectory()) copyTree(src, dest);
      else copyFileSync(src, dest);
    }
  };

  try {
    mkdirSync(home, { recursive: true });
    copyTree(join(shipped, "extensions"), join(home, "extensions"));
    copyTree(join(shipped, "skills"), join(home, "skills"));
    copyTree(join(shipped, "templates"), join(home, "templates"));
    const settings = join(shipped, "settings.json");
    if (existsSync(settings) && !existsSync(join(home, "settings.json"))) {
      copyFileSync(settings, join(home, "settings.json"));
    }
  } catch (err) {
    problems.push(
      `could not prepare the app's pi home at ${home}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { ok: problems.length === 0, problems };
}

export interface PreflightResult {
  ok: boolean;
  /** The specific thing that is wrong, named — not a boolean. */
  problems: string[];
  session: Session;
}

/**
 * Check the session can actually run, and say exactly what is missing.
 *
 * A lesson that sits silent with no tutor is the failure this prevents, so every problem is reported —
 * all of them, not the first, because fixing them one restart at a time is its own kind of silent failure.
 * There is deliberately NO fallback to the global harness: a fallback that restores the old coupling is
 * how this comes back.
 */
export function preflight(env: NodeJS.ProcessEnv = process.env): PreflightResult {
  const session = composeSession(env);
  const problems: string[] = [];
  const p = session.assetPaths;

  if (!existsSync(p.home)) problems.push(`the app's pi home is missing: ${p.home}`);
  for (const ext of p.extensions) {
    if (!existsSync(join(ext, "index.ts"))) problems.push(`shipped extension missing: ${ext}/index.ts`);
  }
  // Checked against the REPO's shipped skills, not the home's.
  //
  // `p.skills` is now a SCAN of the app home, so before `ensureHome` runs it is empty and this loop would
  // report nothing — silently passing a session with no skills at all. The preflight's whole job is to name
  // what is missing before a spawn, so it must read the source of truth.
  const shippedSkillsDir = join(shippedAssets(), "skills");
  try {
    const found = readdirSync(shippedSkillsDir).filter((f) => f.endsWith(".md"));
    if (found.length === 0) problems.push(`no skills shipped at ${shippedSkillsDir}`);
    for (const f of found) {
      if (!existsSync(join(p.home, "skills", f))) problems.push(`shipped skill missing: ${join(p.home, "skills", f)}`);
    }
  } catch {
    problems.push(`skills directory unreadable: ${shippedSkillsDir}`);
  }
  if (!existsSync(p.templates)) problems.push(`learning templates missing: ${p.templates}`);
  if (!existsSync(p.auth)) {
    problems.push(`no credentials at ${p.auth} — the tutor cannot reach a model`);
  }
  if (!session.provider.provider || !session.provider.model) {
    problems.push(
      "no provider and model: adopt them once, or set SOCRATES_PROVIDER and SOCRATES_MODEL",
    );
  }

  return { ok: problems.length === 0, problems, session };
}

/**
 * Copy the user's global provider/model and credentials into the app's home, ONCE.
 *
 * The app ADOPTS the user's choice and then owns its config; it never reads the global one again. This is
 * the only place that reads `~/.pi/agent`, it is explicit, and it is re-runnable — credentials rotate, and
 * a stale copy produces a 401 that reads as a broken app.
 *
 * `models-store.json` is deliberately NOT copied: the model is passed on the command line, because pi
 * ignores `defaultModel` without its cache and copying a cache would freeze a catalog the app does not
 * manage.
 */
export function adoptGlobal(env: NodeJS.ProcessEnv = process.env): { ok: boolean; message: string } {
  const home = appPiHome(env);
  const global = globalPiDir(env);
  const written: string[] = [];

  try {
    mkdirSync(home, { recursive: true });

    const chosen = resolveProvider(env, home);
    if (chosen.source === "none") {
      return {
        ok: false,
        message: `no provider and model in ${join(global, "settings.json")} — set them there, or pass SOCRATES_PROVIDER and SOCRATES_MODEL`,
      };
    }
    writeFileSync(
      join(home, "session.json"),
      `${JSON.stringify({ provider: chosen.provider, model: chosen.model }, null, 2)}\n`,
      "utf8",
    );
    written.push(`session.json (${chosen.provider}/${chosen.model})`);

    const globalAuth = join(global, "auth.json");
    if (existsSync(globalAuth)) {
      copyFileSync(globalAuth, join(home, "auth.json"));
      written.push("auth.json");
    } else {
      return {
        ok: false,
        message: `no credentials at ${globalAuth} — run pi once, or set the provider's environment variable`,
      };
    }
    return { ok: true, message: `adopted ${written.join(" and ")} into ${home}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

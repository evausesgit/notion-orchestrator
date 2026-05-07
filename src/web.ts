import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import type { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "./logger.js";

const CONFIG_KEYS = [
  "NOTION_TOKEN",
  "NOTION_DATA_SOURCE_ID",
  "GIT_REPO_URL",
  "GIT_BRANCH",
  "AGENT_COMMAND_JSON",
  "AGENT_REPAIR_ATTEMPTS",
  "ALLOW_PUSH",
] as const;

type ConfigKey = (typeof CONFIG_KEYS)[number];
type WebConfig = Partial<Record<ConfigKey, string>>;

type ProcessState = {
  worker?: ChildProcessByStdio<null, Readable, Readable>;
  startedAt?: string;
  lastExit?: {
    code: number | null;
    signal: NodeJS.Signals | null;
    at: string;
  };
  commandRunning: boolean;
  logs: string[];
};

type ServeOptions = {
  env: NodeJS.ProcessEnv;
  logger: Logger;
  port?: number;
  configPath?: string;
};

export function mergeWebConfig(
  current: WebConfig,
  form: Record<string, string>,
): WebConfig {
  const next: WebConfig = { ...current };

  for (const key of CONFIG_KEYS) {
    if (key === "ALLOW_PUSH") {
      next[key] = form[key] === "true" ? "true" : "false";
      continue;
    }

    const value = form[key]?.trim();
    if (value) {
      next[key] = value;
    } else if (key !== "NOTION_TOKEN") {
      next[key] = "";
    }
  }

  return next;
}

export async function serveWebUi(options: ServeOptions): Promise<void> {
  const port = options.port ?? Number(options.env.PORT || "3000");
  const workspaceDir = options.env.WORKSPACE_DIR || "/workspace";
  const configPath =
    options.configPath ||
    options.env.WEB_CONFIG_PATH ||
    path.join(workspaceDir, "orchestrator-config.json");
  const state: ProcessState = {
    commandRunning: false,
    logs: [],
  };

  let config = await loadWebConfig(configPath, options.env);
  const cliPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "cli.js");

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        return sendJson(res, 200, { ok: true, worker: Boolean(state.worker) });
      }

      if (req.method === "GET" && req.url === "/status") {
        return sendJson(res, 200, publicStatus(state, config));
      }

      if (req.method === "GET" && req.url === "/") {
        return sendHtml(res, renderPage(config, state));
      }

      if (req.method === "POST" && req.url === "/config") {
        const form = await readForm(req);
        config = mergeWebConfig(config, form);
        await saveWebConfig(configPath, config);
        appendLog(state, "config saved");
        return redirect(res);
      }

      if (req.method === "POST" && req.url === "/start") {
        if (state.worker) {
          appendLog(state, "worker already running");
          return redirect(res);
        }
        state.worker = startChild(cliPath, ["run", "--watch", "60"], config, state);
        state.startedAt = new Date().toISOString();
        appendLog(state, "worker started");
        return redirect(res);
      }

      if (req.method === "POST" && req.url === "/stop") {
        if (state.worker) {
          state.worker.kill("SIGTERM");
          appendLog(state, "worker stop requested");
        }
        return redirect(res);
      }

      if (req.method === "POST" && req.url === "/run-once") {
        await runCommand(cliPath, ["run"], config, state);
        return redirect(res);
      }

      if (req.method === "POST" && req.url === "/doctor") {
        await runCommand(cliPath, ["doctor"], config, state);
        return redirect(res);
      }

      sendText(res, 404, "Not found");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(state, `web error: ${message}`);
      sendText(res, 500, message);
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(port, "0.0.0.0", resolve);
  });

  options.logger.info(`web: listening on 0.0.0.0:${port}`, { configPath });

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      options.logger.info("web: shutdown signal received");
      state.worker?.kill("SIGTERM");
      server.close(() => resolve());
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  });
}

async function loadWebConfig(
  configPath: string,
  env: NodeJS.ProcessEnv,
): Promise<WebConfig> {
  const fromEnv: WebConfig = {};
  for (const key of CONFIG_KEYS) {
    if (env[key]) {
      fromEnv[key] = env[key];
    }
  }

  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as WebConfig;
    return { ...fromEnv, ...parsed };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        GIT_BRANCH: "main",
        AGENT_REPAIR_ATTEMPTS: "0",
        ALLOW_PUSH: "false",
        ...fromEnv,
      };
    }
    throw error;
  }
}

async function saveWebConfig(configPath: string, config: WebConfig) {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(configPath, 0o600);
}

function startChild(
  cliPath: string,
  args: string[],
  config: WebConfig,
  state: ProcessState,
) {
  const child = spawn(process.execPath, [cliPath, ...args], {
    env: childEnv(config),
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk: Buffer) => appendLog(state, chunk.toString("utf8").trimEnd()));
  child.stderr.on("data", (chunk: Buffer) => appendLog(state, chunk.toString("utf8").trimEnd()));
  child.on("exit", (code, signal) => {
    state.lastExit = { code, signal, at: new Date().toISOString() };
    state.worker = undefined;
    appendLog(state, `worker exited code=${code ?? "null"} signal=${signal ?? "null"}`);
  });

  return child;
}

async function runCommand(
  cliPath: string,
  args: string[],
  config: WebConfig,
  state: ProcessState,
) {
  if (state.commandRunning) {
    appendLog(state, "command skipped: another command is already running");
    return;
  }

  state.commandRunning = true;
  appendLog(state, `command started: ${args.join(" ")}`);

  await new Promise<void>((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: childEnv(config),
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk: Buffer) => appendLog(state, chunk.toString("utf8").trimEnd()));
    child.stderr.on("data", (chunk: Buffer) => appendLog(state, chunk.toString("utf8").trimEnd()));
    child.on("exit", (code, signal) => {
      appendLog(state, `command exited code=${code ?? "null"} signal=${signal ?? "null"}`);
      state.commandRunning = false;
      resolve();
    });
  });
}

function childEnv(config: WebConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LOG_FORMAT: process.env.LOG_FORMAT || "json",
  };

  for (const key of CONFIG_KEYS) {
    if (config[key] !== undefined) {
      env[key] = config[key];
    }
  }

  return env;
}

function appendLog(state: ProcessState, message: string) {
  if (!message) {
    return;
  }
  for (const line of message.split("\n")) {
    state.logs.push(`${new Date().toISOString()} ${line}`);
  }
  state.logs = state.logs.slice(-300);
}

function publicStatus(state: ProcessState, config: WebConfig) {
  return {
    workerRunning: Boolean(state.worker),
    startedAt: state.startedAt,
    lastExit: state.lastExit,
    commandRunning: state.commandRunning,
    configured: {
      notionToken: Boolean(config.NOTION_TOKEN),
      notionDataSourceId: Boolean(config.NOTION_DATA_SOURCE_ID),
      gitRepoUrl: Boolean(config.GIT_REPO_URL),
      agentCommand: Boolean(config.AGENT_COMMAND_JSON),
      allowPush: config.ALLOW_PUSH === "true",
    },
  };
}

function renderPage(config: WebConfig, state: ProcessState) {
  const running = Boolean(state.worker);
  const logs = state.logs.map((line) => escapeHtml(line)).join("\n");
  const status = running ? "Running" : "Stopped";
  const allowPush = config.ALLOW_PUSH === "true";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>notion-orchestrator</title>
<style>
:root { color-scheme: light; --border:#d8dde6; --text:#18202f; --muted:#5c687a; --bg:#f7f8fa; --panel:#fff; --accent:#1769aa; --danger:#b42318; }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); background: var(--bg); }
header { background: var(--panel); border-bottom: 1px solid var(--border); padding: 18px 24px; display:flex; justify-content:space-between; gap:16px; align-items:center; }
h1 { font-size: 20px; margin:0; letter-spacing:0; }
main { max-width: 1180px; margin: 0 auto; padding: 24px; display: grid; grid-template-columns: minmax(320px, 460px) 1fr; gap: 20px; }
section { background: var(--panel); border:1px solid var(--border); border-radius:8px; padding:18px; }
h2 { font-size: 15px; margin: 0 0 14px; }
label { display:block; font-weight:600; margin: 12px 0 6px; }
input, textarea { width:100%; border:1px solid var(--border); border-radius:6px; padding:10px; font:inherit; background:#fff; }
textarea { min-height: 78px; resize: vertical; }
.row { display:grid; grid-template-columns: 1fr 140px; gap:12px; }
.actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:16px; }
button { border:1px solid var(--border); background:#fff; color:var(--text); border-radius:6px; padding:9px 12px; font:inherit; cursor:pointer; }
button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
button.danger { border-color:#f0b4ad; color:var(--danger); }
.badge { display:inline-flex; align-items:center; border:1px solid var(--border); border-radius:999px; padding:4px 9px; background:#fff; color:var(--muted); }
.push { display:flex; align-items:center; gap:9px; margin-top:12px; }
.push input { width:auto; }
pre { margin:0; min-height:420px; max-height:680px; overflow:auto; background:#111827; color:#e5e7eb; border-radius:6px; padding:14px; white-space:pre-wrap; word-break:break-word; }
.muted { color:var(--muted); }
@media (max-width: 860px) { main { grid-template-columns: 1fr; padding: 14px; } header { padding: 14px; align-items:flex-start; flex-direction:column; } }
</style>
</head>
<body>
<header>
  <div>
    <h1>notion-orchestrator</h1>
    <div class="muted">Worker control panel</div>
  </div>
  <div class="badge">${status}${state.commandRunning ? " · command running" : ""}</div>
</header>
<main>
  <section>
    <h2>Configuration</h2>
    <form method="post" action="/config">
      <label for="NOTION_TOKEN">Notion token</label>
      <input id="NOTION_TOKEN" name="NOTION_TOKEN" type="password" placeholder="${config.NOTION_TOKEN ? "Saved; leave blank to keep" : ""}" value="${escapeAttr(config.NOTION_TOKEN ?? "ntn_f1643563559aYPZTdoP3j15SlcSnQLWemL8WAFBg8bp6K1")}">

      <label for="NOTION_DATA_SOURCE_ID">Notion data source ID</label>
      <input id="NOTION_DATA_SOURCE_ID" name="NOTION_DATA_SOURCE_ID" value="${escapeAttr(config.NOTION_DATA_SOURCE_ID ?? "514bed22-d816-4f86-98e7-255afd0d30d9")}">

      <label for="GIT_REPO_URL">Git repository URL</label>
      <input id="GIT_REPO_URL" name="GIT_REPO_URL" value="${escapeAttr(config.GIT_REPO_URL ?? "https://github.com/evausesgit/mon-super-agent")}">

      <div class="row">
        <div>
          <label for="GIT_BRANCH">Git branch</label>
          <input id="GIT_BRANCH" name="GIT_BRANCH" value="${escapeAttr(config.GIT_BRANCH ?? "main")}">
        </div>
        <div>
          <label for="AGENT_REPAIR_ATTEMPTS">Repair attempts</label>
          <input id="AGENT_REPAIR_ATTEMPTS" name="AGENT_REPAIR_ATTEMPTS" value="${escapeAttr(config.AGENT_REPAIR_ATTEMPTS ?? "0")}">
        </div>
      </div>

      <label for="AGENT_COMMAND_JSON">Agent command JSON</label>
      <textarea id="AGENT_COMMAND_JSON" name="AGENT_COMMAND_JSON" spellcheck="false" placeholder='Codex: ["codex","--ask-for-approval","never","exec","--sandbox","workspace-write","-"]&#10;Claude Code: ["claude","-p","--output-format","json"]'>${escapeHtml(config.AGENT_COMMAND_JSON ?? "")}</textarea>

      <label class="push">
        <input name="ALLOW_PUSH" value="true" type="checkbox"${allowPush ? " checked" : ""}>
        Allow commit and push
      </label>

      <div class="actions">
        <button class="primary" type="submit">Save config</button>
      </div>
    </form>
  </section>

  <section>
    <h2>Controls</h2>
    <div class="actions">
      <form method="post" action="/doctor"><button type="submit">Doctor</button></form>
      <form method="post" action="/run-once"><button type="submit">Run once</button></form>
      <form method="post" action="/start"><button class="primary" type="submit">Start watch</button></form>
      <form method="post" action="/stop"><button class="danger" type="submit">Stop watch</button></form>
    </div>
    <p class="muted">Config is stored on the mounted workspace volume. Token fields are not echoed back into the page.</p>
    <h2>Logs</h2>
    <pre>${logs}</pre>
  </section>
</main>
</body>
</html>`;
}

async function readForm(req: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf8");
  const params = new URLSearchParams(body);
  const form: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    form[key] = value;
  }
  return form;
}

function sendHtml(res: ServerResponse, html: string) {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendText(res: ServerResponse, status: number, text: string) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function redirect(res: ServerResponse) {
  res.writeHead(303, { location: "/" });
  res.end();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value: string) {
  return escapeHtml(value);
}

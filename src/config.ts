import { readFile } from "node:fs/promises";
import { parseArgs, type ParseArgsConfig } from "node:util";
import {
  defaultPropertyMap,
  parsePropertyMapJson,
} from "./notion-properties.js";
import type { NotionPropertyMap } from "./task-types.js";
import type { LogFormat, LogLevel } from "./logger.js";

export type Command = "run" | "list" | "doctor" | "serve" | "version" | "help";

export type Config = {
  command: Command;
  notionToken: string;
  notionDataSourceId: string;
  notionApiVersion: string;
  notionPropertyMap: NotionPropertyMap;
  sprintFilter: string;
  readyStatus: string;
  readyStatuses: string[];
  agentName: string;
  gitRepoUrl: string;
  gitBranch: string;
  gitToken?: string;
  gitUsername: string;
  gitAuthorName: string;
  gitAuthorEmail: string;
  workspaceDir: string;
  reviewArtifactDir: string;
  defaultValidationCommands: string[];
  agentCommand: string[];
  agentTimeoutMs: number;
  agentRepairAttempts: number;
  allowPush: boolean;
  watchIntervalSec?: number;
  watchBackoffMaxSec: number;
  startupTmuxSession?: string;
  maxIterations?: number;
  dryRun: boolean;
  json: boolean;
  webPort: number;
  webConfigPath: string;
  logFormat: LogFormat;
  logLevel: LogLevel;
  helpRequested: boolean;
  helpTopic?: string;
};

const argSpec: ParseArgsConfig["options"] = {
  "notion-token": { type: "string" },
  "notion-data-source": { type: "string" },
  "notion-api-version": { type: "string" },
  "notion-props": { type: "string" },
  sprint: { type: "string" },
  "ready-status": { type: "string" },
  "agent-name": { type: "string" },
  repo: { type: "string" },
  branch: { type: "string" },
  "git-token": { type: "string" },
  "git-username": { type: "string" },
  "author-name": { type: "string" },
  "author-email": { type: "string" },
  workspace: { type: "string" },
  "review-dir": { type: "string" },
  "default-validation": { type: "string" },
  "agent-command": { type: "string" },
  "agent-timeout-ms": { type: "string" },
  "agent-repair-attempts": { type: "string" },
  "allow-push": { type: "boolean" },
  watch: { type: "string" },
  once: { type: "boolean" },
  "max-iterations": { type: "string" },
  "watch-backoff-max": { type: "string" },
  "startup-tmux-session": { type: "string" },
  "dry-run": { type: "boolean" },
  json: { type: "boolean" },
  port: { type: "string" },
  "web-config": { type: "string" },
  "log-format": { type: "string" },
  "log-level": { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean" },
};

export type LoadConfigOptions = {
  argv: string[];
  env: NodeJS.ProcessEnv;
};

export async function loadConfig({ argv, env }: LoadConfigOptions): Promise<Config> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: argSpec,
    allowPositionals: true,
    strict: false,
  });

  const helpRequested = Boolean(values.help) || positionals[0] === "help";
  const versionRequested = Boolean(values.version);
  const command = pickCommand(positionals, versionRequested);
  const helpTopic =
    positionals[0] === "help" ? positionals[1] : helpRequested ? command : undefined;

  if (helpRequested || command === "help") {
    return makeHelpConfig({ command: "help", helpTopic });
  }

  if (command === "version" || versionRequested) {
    return makeHelpConfig({ command: "version" });
  }

  const notionToken =
    pickString(values["notion-token"]) ?? (await readSecret(env, "NOTION_TOKEN")) ?? "";
  const notionDataSourceId =
    pickString(values["notion-data-source"]) ?? env.NOTION_DATA_SOURCE_ID ?? "";
  const notionApiVersion =
    pickString(values["notion-api-version"]) ?? env.NOTION_API_VERSION ?? "2025-09-03";

  const propsRaw =
    pickString(values["notion-props"]) ?? (await readSecret(env, "NOTION_PROPS_JSON"));
  const notionPropertyMap = propsRaw
    ? { ...defaultPropertyMap, ...parsePropertyMapJson(propsRaw) }
    : { ...defaultPropertyMap };

  const sprintFilter = pickString(values.sprint) ?? env.SPRINT_FILTER ?? "";
  const readyStatusRaw =
    pickString(values["ready-status"]) ?? env.READY_STATUS ?? env.READY_STATUSES ?? "Todo";
  const readyStatuses = splitCommands(readyStatusRaw);
  const readyStatus = readyStatuses[0] ?? "Todo";
  const agentName =
    pickString(values["agent-name"]) ?? env.AGENT_NAME ?? "notion-orchestrator";

  const gitRepoUrl = pickString(values.repo) ?? env.GIT_REPO_URL ?? "";
  const gitBranch = pickString(values.branch) ?? env.GIT_BRANCH ?? "main";
  const gitToken =
    pickString(values["git-token"]) ?? (await readSecret(env, "GIT_TOKEN")) ?? undefined;
  const gitUsername =
    pickString(values["git-username"]) ?? env.GIT_USERNAME ?? "x-access-token";
  const gitAuthorName =
    pickString(values["author-name"]) ?? env.GIT_AUTHOR_NAME ?? "notion-orchestrator";
  const gitAuthorEmail =
    pickString(values["author-email"]) ??
    env.GIT_AUTHOR_EMAIL ??
    "bot@notion-orchestrator.local";

  const workspaceDir =
    pickString(values.workspace) ?? env.WORKSPACE_DIR ?? "/workspace";
  const reviewArtifactDir =
    pickString(values["review-dir"]) ?? env.REVIEW_ARTIFACT_DIR ?? ".notion-orchestrator/runs";

  const defaultValidationRaw =
    pickString(values["default-validation"]) ?? env.DEFAULT_VALIDATION_COMMANDS ?? "";
  const defaultValidationCommands = splitCommands(defaultValidationRaw);
  const agentCommandRaw =
    pickString(values["agent-command"]) ??
    (await readSecret(env, "AGENT_COMMAND_JSON")) ??
    "";
  const agentCommand = parseCommandJson(agentCommandRaw, "AGENT_COMMAND_JSON");
  const agentTimeoutMs =
    parseOptionalNumber(values["agent-timeout-ms"], env.AGENT_TIMEOUT_MS) ??
    15 * 60 * 1000;
  const agentRepairAttempts =
    parseOptionalNumber(
      values["agent-repair-attempts"],
      env.AGENT_REPAIR_ATTEMPTS,
    ) ?? 0;

  const allowPush = parseBool(values["allow-push"], env.ALLOW_PUSH, false);
  const dryRun = parseBool(values["dry-run"], undefined, false);
  const json = parseBool(values.json, undefined, false);
  const webPort = parseOptionalNumber(values.port, env.PORT) ?? 3000;
  const webConfigPath = pickString(values["web-config"]) ?? env.WEB_CONFIG_PATH ?? "";

  const watchIntervalSec = parseOptionalNumber(values.watch, undefined);
  const maxIterations = parseOptionalNumber(values["max-iterations"], undefined);
  const watchBackoffMaxSec =
    parseOptionalNumber(values["watch-backoff-max"], env.WATCH_BACKOFF_MAX) ?? 300;
  const startupTmuxSession =
    pickString(values["startup-tmux-session"]) ?? env.STARTUP_TMUX_SESSION;

  const logFormat = (pickString(values["log-format"]) ?? env.LOG_FORMAT ?? "text") as LogFormat;
  const logLevel = (pickString(values["log-level"]) ?? env.LOG_LEVEL ?? "info") as LogLevel;

  if (command === "serve") {
    // The web UI can start with an empty configuration and collect settings later.
  } else if (command !== "doctor" && command !== "list") {
    if (!notionToken) {
      throw new Error("NOTION_TOKEN (or --notion-token) is required.");
    }
    if (!notionDataSourceId) {
      throw new Error("NOTION_DATA_SOURCE_ID (or --notion-data-source) is required.");
    }
  } else {
    if (!notionToken || !notionDataSourceId) {
      throw new Error(
        "Both NOTION_TOKEN and NOTION_DATA_SOURCE_ID are required to query Notion.",
      );
    }
  }

  if (command === "run" && !gitRepoUrl) {
    throw new Error("GIT_REPO_URL (or --repo) is required for run/watch.");
  }

  if (command === "run" && allowPush && !gitToken) {
    throw new Error("GIT_TOKEN (or --git-token) is required when --allow-push is true.");
  }

  return Object.freeze({
    command,
    notionToken,
    notionDataSourceId,
    notionApiVersion,
    notionPropertyMap,
    sprintFilter,
    readyStatus,
    readyStatuses,
    agentName,
    gitRepoUrl,
    gitBranch,
    gitToken,
    gitUsername,
    gitAuthorName,
    gitAuthorEmail,
    workspaceDir,
    reviewArtifactDir,
    defaultValidationCommands,
    agentCommand,
    agentTimeoutMs,
    agentRepairAttempts,
    allowPush,
    watchIntervalSec,
    watchBackoffMaxSec,
    startupTmuxSession,
    maxIterations,
    dryRun,
    json,
    webPort,
    webConfigPath,
    logFormat,
    logLevel,
    helpRequested: false,
  });
}

function pickCommand(positionals: string[], versionRequested: boolean): Command {
  if (positionals.length === 0) {
    return versionRequested ? "version" : "run";
  }

  const candidate = positionals[0];

  if (
    candidate === "run" ||
    candidate === "list" ||
    candidate === "doctor" ||
    candidate === "serve" ||
    candidate === "version" ||
    candidate === "help"
  ) {
    return candidate;
  }

  throw new Error(`Unknown command: ${candidate}. Valid: run, list, doctor, serve, version, help.`);
}

function makeHelpConfig(input: { command: "help" | "version"; helpTopic?: string }): Config {
  return {
    command: input.command,
    helpRequested: true,
    helpTopic: input.helpTopic,
    notionToken: "",
    notionDataSourceId: "",
    notionApiVersion: "",
    notionPropertyMap: { ...defaultPropertyMap },
    sprintFilter: "",
    readyStatus: "Todo",
    readyStatuses: ["Todo"],
    agentName: "notion-orchestrator",
    gitRepoUrl: "",
    gitBranch: "main",
    gitUsername: "x-access-token",
    gitAuthorName: "notion-orchestrator",
    gitAuthorEmail: "bot@notion-orchestrator.local",
    workspaceDir: "/workspace",
    reviewArtifactDir: ".notion-orchestrator/runs",
    defaultValidationCommands: [],
    agentCommand: [],
    agentTimeoutMs: 15 * 60 * 1000,
    agentRepairAttempts: 0,
    allowPush: false,
    watchBackoffMaxSec: 300,
    dryRun: false,
    json: false,
    webPort: 3000,
    webConfigPath: "",
    logFormat: "text",
    logLevel: "info",
  };
}

function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseBool(
  flag: unknown,
  envValue: string | undefined,
  fallback: boolean,
): boolean {
  if (flag === true) {
    return true;
  }
  if (typeof flag === "string") {
    return ["1", "true", "yes", "on"].includes(flag.toLowerCase());
  }
  if (envValue) {
    return ["1", "true", "yes", "on"].includes(envValue.toLowerCase());
  }
  return fallback;
}

function parseOptionalNumber(
  flag: unknown,
  envValue: string | undefined,
): number | undefined {
  const raw = typeof flag === "string" ? flag : envValue;
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative number, got: ${raw}`);
  }
  return parsed;
}

function splitCommands(raw: string): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCommandJson(raw: string, label: string): string[] {
  if (!raw) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} must be a JSON array of strings: ${message}`);
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    !parsed.every((item) => typeof item === "string" && item.length > 0)
  ) {
    throw new Error(`${label} must be a non-empty JSON array of strings.`);
  }

  return parsed;
}

async function readSecret(env: NodeJS.ProcessEnv, key: string): Promise<string | undefined> {
  if (env[key]) {
    return env[key];
  }
  const file = env[`${key}_FILE`];
  if (!file) {
    return undefined;
  }
  const content = await readFile(file, "utf8");
  return content.trim();
}

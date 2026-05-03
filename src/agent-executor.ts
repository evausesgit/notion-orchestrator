import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OrchestrationTask } from "./task-types.js";

export type AgentCommandConfig = {
  repoRoot: string;
  command: string[];
  timeoutMs: number;
};

export type AgentCommandResult = {
  stdout: string;
  stderr: string;
};

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const OUTPUT_LIMIT = 20_000;

export function buildAgentPrompt(task: OrchestrationTask) {
  return [
    "You are working in this git repository.",
    "",
    "Implement the Notion task below and leave a reviewable git diff in the working tree.",
    "",
    `Task ID: ${task.taskId}`,
    `Title: ${task.title}`,
    `Priority: ${task.priority}`,
    `Type: ${task.type}`,
    `Repo areas: ${task.repoArea.join(", ") || "unspecified"}`,
    "",
    "Acceptance Criteria:",
    task.acceptanceCriteria || "Not specified.",
    "",
    "Implementation Brief:",
    task.implementationBrief || "Not specified.",
    "",
    "Files To Touch:",
    ...(task.filesToTouch.length > 0
      ? task.filesToTouch.map((file) => `- ${file}`)
      : ["- Not specified. Choose the minimal files needed for the task."]),
    "",
    "Rules:",
    "- Only edit files needed for this task.",
    "- Do not touch .git, .env*, .ssh, or .notion-orchestrator.",
    "- Do not run destructive git commands.",
    "- Do not commit or push. The orchestrator handles git after you finish.",
    "- Prefer existing project patterns over introducing new abstractions.",
    "- Run focused validation when practical and report what you ran.",
    "",
    "Return a concise summary of the implementation and validation.",
  ].join("\n");
}

export async function runAgentCommand(
  task: OrchestrationTask,
  config: AgentCommandConfig,
): Promise<AgentCommandResult> {
  if (config.command.length === 0) {
    throw new Error("AGENT_COMMAND_JSON must be configured for Execution Mode = agent.");
  }

  const prompt = buildAgentPrompt(task);
  const promptDir = await mkdtemp(path.join(os.tmpdir(), "notion-orch-agent-"));
  const promptPath = path.join(promptDir, "prompt.md");
  await writeFile(promptPath, prompt, "utf8");

  try {
    return await spawnAgent(config, prompt, promptPath);
  } finally {
    await rm(promptDir, { recursive: true, force: true });
  }
}

function spawnAgent(
  config: AgentCommandConfig,
  prompt: string,
  promptPath: string,
): Promise<AgentCommandResult> {
  const [command, ...args] = config.command;
  const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
  if (!command) {
    rejectAgentCommandMissing();
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: config.repoRoot,
      env: {
        ...sanitizedAgentEnv(process.env),
        NOTION_ORCHESTRATOR_PROMPT_FILE: promptPath,
        NOTION_ORCHESTRATOR_REPO_ROOT: config.repoRoot,
      },
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk.toString("utf8"));
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk.toString("utf8"));
    });

    child.on("error", (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);

      if (timedOut) {
        reject(new Error(`Agent command timed out after ${timeoutMs}ms.`));
        return;
      }

      if (code !== 0) {
        reject(
          new Error(
            `Agent command failed with code ${code ?? "unknown"}${
              signal ? ` signal ${signal}` : ""
            }. ${stderr || stdout}`.trim(),
          ),
        );
        return;
      }

      resolve({ stdout, stderr });
    });

    child.stdin.end(prompt);
  });
}

function rejectAgentCommandMissing(): never {
  throw new Error("AGENT_COMMAND_JSON must be configured for Execution Mode = agent.");
}

function appendLimited(current: string, next: string) {
  const combined = current + next;
  if (combined.length <= OUTPUT_LIMIT) {
    return combined;
  }
  return combined.slice(combined.length - OUTPUT_LIMIT);
}

function sanitizedAgentEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env };
  for (const key of [
    "NOTION_TOKEN",
    "NOTION_TOKEN_FILE",
    "NOTION_PROPS_JSON",
    "NOTION_PROPS_JSON_FILE",
    "GIT_TOKEN",
    "GIT_TOKEN_FILE",
  ]) {
    delete next[key];
  }
  return next;
}

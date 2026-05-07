import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { listChangedFiles as listGitChangedFiles } from "./git-ops.js";
import type { TaskExecutionResult } from "./runner.js";
import type { OrchestrationTask } from "./task-types.js";
import { runAgentCommand, type AgentCommandConfig } from "./agent-executor.js";

const FORBIDDEN_PATH_PREFIXES = [".git/", ".ssh/", ".notion-orchestrator/"];
const FORBIDDEN_PATH_EXACT = new Set([".git", ".env", ".ssh"]);

export type ExecutorConfig = {
  repoRoot: string;
  reviewArtifactDir: string;
  reviewBaseUrl?: string;
  agentCommand?: string[];
  agentTimeoutMs?: number;
};

export function createExecutor(config: ExecutorConfig) {
  return async function executeTask(
    task: OrchestrationTask,
    runId: string,
  ): Promise<TaskExecutionResult> {
    if (!task.executionMode || task.executionMode === "manual") {
      return {
        outcome: "skipped",
        summary: `${task.taskId} is configured for manual execution; orchestrator will not modify the repo.`,
      };
    }

    const unsafe = task.filesToTouch.find((file) => !isSafeRelativePath(file));

    if (unsafe) {
      return {
        outcome: "blocked",
        summary: `${task.taskId} requested writing to a forbidden path: ${unsafe}. Files must be relative paths outside .git, .env*, .ssh, and the review artifact dir.`,
      };
    }

    const changedFilesBefore = await listGitChangedFiles(config.repoRoot);

    let agentResult: Awaited<ReturnType<typeof runAgentCommand>>;
    try {
      agentResult = await runAgentCommand(task, agentConfig(config));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        outcome: "blocked",
        summary: `Execution for ${task.taskId} was blocked by the agent command: ${message}`,
      };
    }

    const changedFilesAfter = await listGitChangedFiles(config.repoRoot);
    const newChangedFiles = changedFilesAfter.filter(
      (file) => !changedFilesBefore.includes(file),
    );

    const reviewArtifactPath = await writeReviewArtifact({
      repoRoot: config.repoRoot,
      reviewArtifactDir: config.reviewArtifactDir,
      runId,
      task,
      changedFiles: newChangedFiles,
    });

    return {
      outcome: "in_review",
      summary: [
        `Executed ${task.taskId} through the agent Notion-driven executor.`,
        newChangedFiles.length > 0
          ? `Changed files: ${newChangedFiles.join(", ")}.`
          : "The executor was idempotent and did not introduce a new diff.",
        summarizeAgentOutput(agentResult.stdout, agentResult.stderr),
        `Review artifact: ${path.relative(config.repoRoot, reviewArtifactPath)}.`,
      ].join(" "),
      changedFiles: newChangedFiles,
      link: config.reviewBaseUrl,
    };
  };
}

function agentConfig(config: ExecutorConfig): AgentCommandConfig {
  return {
    repoRoot: config.repoRoot,
    command: config.agentCommand ?? [],
    timeoutMs: config.agentTimeoutMs ?? 15 * 60 * 1000,
  };
}

function summarizeAgentOutput(stdout: string, stderr: string) {
  const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
  if (!output) {
    return "Agent produced no console output.";
  }
  return `Agent output: ${output.slice(0, 1200)}`;
}

export function isSafeRelativePath(target: string) {
  if (!target) {
    return false;
  }

  if (path.isAbsolute(target)) {
    return false;
  }

  const normalized = path.posix.normalize(target.replaceAll("\\", "/"));

  if (normalized.startsWith("..") || normalized.includes("/../")) {
    return false;
  }

  if (FORBIDDEN_PATH_EXACT.has(normalized)) {
    return false;
  }

  if (normalized.startsWith(".env.") && normalized !== ".env.example") {
    return false;
  }

  for (const prefix of FORBIDDEN_PATH_PREFIXES) {
    if (normalized === prefix.replace(/\/$/, "") || normalized.startsWith(prefix)) {
      return false;
    }
  }

  return true;
}

export async function ensureFile(filePath: string, content: string) {
  try {
    await readFile(filePath, "utf8");
  } catch {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${content}\n`, "utf8");
  }
}

export async function ensureSection(filePath: string, heading: string, body: string) {
  const current = await readFile(filePath, "utf8");

  if (current.includes(heading)) {
    return;
  }

  const next = `${current.trimEnd()}\n\n${heading}\n\n${body}\n`;
  await writeFile(filePath, next, "utf8");
}

export async function writeReviewArtifact(input: {
  repoRoot: string;
  reviewArtifactDir: string;
  runId: string;
  task: OrchestrationTask;
  changedFiles: string[];
}) {
  const runsDir = path.join(input.repoRoot, input.reviewArtifactDir);
  await mkdir(runsDir, { recursive: true });

  const filePath = path.join(runsDir, `${input.runId}.md`);
  const reviewContent = [
    `# ${input.runId}`,
    "",
    `- Task: ${input.task.taskId} - ${input.task.title}`,
    `- Status target: In Review`,
    `- Repo areas: ${input.task.repoArea.join(", ") || "unspecified"}`,
    "",
    "## Changed Files",
    "",
    ...(input.changedFiles.length > 0
      ? input.changedFiles.map((file) => `- ${file}`)
      : ["- No new changed files were created by this run."]),
    "",
    "## Review Checklist",
    "",
    "- Confirm the changed files satisfy the task acceptance criteria.",
    "- Confirm the Notion status transition makes sense.",
    "- Capture follow-up work as a new task instead of overloading this one.",
  ].join("\n");

  await writeFile(filePath, reviewContent, "utf8");
  return filePath;
}

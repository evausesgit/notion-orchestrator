#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { loadConfig, type Config } from "./config.js";
import { createLogger, type Logger } from "./logger.js";
import { NotionApiTaskTrackerAdapter } from "./notion-adapter.js";
import { TaskRunner } from "./runner.js";
import { createExecutor } from "./executor.js";
import { runAgentRepairCommand } from "./agent-executor.js";
import {
  commitAndPush,
  getRepoDiffSummary,
  getRemoteOrigin,
  listChangedFiles,
  runRepoChecks,
  stripCredentials,
  toCommitUrl,
} from "./git-ops.js";
import { setupWorkspace } from "./workspace.js";
import { watch } from "./watch.js";
import type { OrchestrationTask } from "./task-types.js";

const execFileAsync = promisify(execFile);

const HELP = `notion-orchestrator — pick ready tasks from Notion and turn them into git commits.

Usage:
  notion-orchestrator [command] [options]

Commands:
  run         Execute one ready task and exit (default).
  list        List ready tasks without modifying anything.
  doctor      Validate config, ping Notion, ping git remote.
  version     Print the package version.
  help [cmd]  Show this help (or extended help for a command).

Common options:
  --notion-token <token>          Notion integration token (or NOTION_TOKEN).
  --notion-data-source <id>       Notion data source ID (or NOTION_DATA_SOURCE_ID).
  --notion-api-version <version>  Default 2025-09-03.
  --notion-props <json>           Override property names. Example:
                                   '{"taskId":"Key","blockedBy":"Depends On"}'.
  --sprint <name>                 Filter by Sprint property (default: no filter).
  --ready-status <name[,name]>    Statuses considered ready (default: Todo).
  --agent-name <name>             Written into Last Updated By Agent.

  --repo <url>                    Target git URL (or GIT_REPO_URL).
  --branch <name>                 Target branch (default: main).
  --git-token <token>             PAT/installation token (or GIT_TOKEN).
  --git-username <name>           HTTPS username (default: x-access-token).
  --author-name / --author-email  Identity used for commits.

  --workspace <path>              Where the target repo is cloned (default: /workspace).
  --review-dir <path>             Review artifact dir relative to repo
                                   (default: .notion-orchestrator/runs).
  --default-validation <cmds>     Comma- or newline-separated fallback validation commands.
  --agent-command <json>          JSON array command for Execution Mode = agent.
  --agent-timeout-ms <ms>         Agent command timeout (default: 900000).
  --agent-repair-attempts <n>     Agent retries after validation failures (default: 0).
  --allow-push                    Permit committing and pushing. Default: dry path only.

Run-mode:
  --watch <seconds>               Switch to daemon mode at the given polling interval.
  --max-iterations <n>            Cap watch iterations (testing/CI).
  --watch-backoff-max <seconds>   Backoff cap on errors (default 300).
  --startup-tmux-session <name>   Kill a stale tmux session before watch starts.
  --dry-run                       Skip Notion writeback and git push.
  --json                          Machine-readable output for list/doctor.

Logging:
  --log-format <text|json>        Default: text.
  --log-level <debug|info|warn|error>  Default: info.

Examples:
  notion-orchestrator doctor
  notion-orchestrator list --json
  notion-orchestrator run --repo https://github.com/me/sandbox.git \\
    --git-token $GH_TOKEN --branch main
  notion-orchestrator run --watch 60 --allow-push
`;

async function main() {
  const config = await loadConfig({ argv: process.argv.slice(2), env: process.env });

  if (config.command === "help") {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  if (config.command === "version") {
    const version = await readPackageVersion();
    process.stdout.write(`${version}\n`);
    return;
  }

  const logger = createLogger(
    {
      level: config.logLevel,
      format: config.logFormat,
      redactions: [config.notionToken, config.gitToken ?? ""].filter(Boolean),
    },
    { agent: config.agentName, command: config.command },
  );

  const tracker = new NotionApiTaskTrackerAdapter({
    token: config.notionToken,
    dataSourceId: config.notionDataSourceId,
    apiVersion: config.notionApiVersion,
    propertyMap: config.notionPropertyMap,
  });

  if (config.command === "list") {
    return listCommand(config, tracker, logger);
  }

  if (config.command === "doctor") {
    return doctorCommand(config, tracker, logger);
  }

  return runCommand(config, tracker, logger);
}

async function listCommand(
  config: Config,
  tracker: NotionApiTaskTrackerAdapter,
  logger: Logger,
) {
  const tasks = await tracker.listTasks({
    sprint: config.sprintFilter || undefined,
    readyStatus: pickReadyStatus(config),
    readyStatuses: pickReadyStatuses(config),
    onlyReady: true,
  });

  if (config.json) {
    process.stdout.write(`${JSON.stringify(tasks, null, 2)}\n`);
    return;
  }

  if (tasks.length === 0) {
    logger.info("No ready tasks found.");
    return;
  }

  for (const task of tasks) {
    process.stdout.write(
      `${task.priority}  ${task.taskId.padEnd(12)}  ${task.title}\n`,
    );
  }
}

async function doctorCommand(
  config: Config,
  tracker: NotionApiTaskTrackerAdapter,
  logger: Logger,
) {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  try {
    const tasks = await tracker.listTasks();
    checks.push({
      name: "notion",
      ok: true,
      detail: `reachable, ${tasks.length} tasks total`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({ name: "notion", ok: false, detail: message });
  }

  if (config.gitRepoUrl) {
    checks.push({
      name: "git remote",
      ok: true,
      detail: `configured: ${stripCredentials(config.gitRepoUrl)}@${config.gitBranch}`,
    });
  } else {
    checks.push({
      name: "git remote",
      ok: false,
      detail: "GIT_REPO_URL is not set; run/watch will fail",
    });
  }

  checks.push({
    name: "workspace",
    ok: true,
    detail: `will use ${config.workspaceDir}/repo`,
  });

  if (config.json) {
    process.stdout.write(`${JSON.stringify(checks, null, 2)}\n`);
  } else {
    for (const check of checks) {
      const status = check.ok ? "ok" : "fail";
      process.stdout.write(`${check.name}: ${status} (${check.detail})\n`);
    }
  }

  const allOk = checks.every((check) => check.ok);
  if (!allOk) {
    process.exitCode = 1;
  }
}

async function runCommand(
  config: Config,
  tracker: NotionApiTaskTrackerAdapter,
  logger: Logger,
) {
  if (config.watchIntervalSec !== undefined && config.startupTmuxSession) {
    await cleanupStartupTmuxSession(config.startupTmuxSession, logger);
  }

  const workspace = await setupWorkspace(
    {
      workspaceDir: config.workspaceDir,
      repoUrl: config.gitRepoUrl,
      branch: config.gitBranch,
      gitToken: config.gitToken,
      gitUsername: config.gitUsername,
      authorName: config.gitAuthorName,
      authorEmail: config.gitAuthorEmail,
    },
    logger,
  );

  const executor = createExecutor({
    repoRoot: workspace.repoDir,
    reviewArtifactDir: config.reviewArtifactDir,
    agentCommand: config.agentCommand,
    agentTimeoutMs: config.agentTimeoutMs,
  });

  const runner = new TaskRunner(
    tracker,
    {
      agentName: config.agentName,
      sprintFilter: config.sprintFilter || undefined,
      readyStatus: pickReadyStatus(config),
      readyStatuses: pickReadyStatuses(config),
    },
    async (task, runId) => {
      try {
        const execution = await executor(task, runId);

        if (execution.outcome !== "in_review" && execution.outcome !== "done") {
          return execution;
        }

        let changedFiles =
          "changedFiles" in execution && execution.changedFiles
            ? execution.changedFiles
            : await listChangedFiles(workspace.repoDir);

        if (changedFiles.length === 0) {
          return {
            outcome: "skipped" as const,
            summary: `No repo diff remained after executing ${task.taskId}; nothing was committed.`,
          };
        }

        const validationCommands =
          task.validationCommands.length > 0
            ? task.validationCommands
            : config.defaultValidationCommands;

        if (validationCommands.length === 0) {
          logger.warn(
            `${task.taskId}: no validation commands configured; skipping verification.`,
          );
        }

        await runValidationWithRepairs({
          repoRoot: workspace.repoDir,
          task,
          validationCommands,
          config,
          logger,
        });

        changedFiles = await listChangedFiles(workspace.repoDir);
        if (changedFiles.length === 0) {
          return {
            outcome: "skipped" as const,
            summary: `No repo diff remained after validating ${task.taskId}; nothing was committed.`,
          };
        }

        if (!config.allowPush || config.dryRun) {
          logger.info(
            `${task.taskId}: changes prepared but not committed (allowPush=${config.allowPush}, dryRun=${config.dryRun}).`,
          );
          return {
            outcome: "in_review",
            summary: [
              `Executed ${task.taskId} and produced a reviewable diff.`,
              `Changed files: ${changedFiles.join(", ")}.`,
              "Push is disabled — re-run with --allow-push to land the commit.",
            ].join(" "),
            changedFiles,
          };
        }

        const { commitSha } = await commitAndPush({
          repoRoot: workspace.repoDir,
          taskId: task.taskId,
          runId,
          files: changedFiles,
          commitMessage: task.commitMessage,
          branch: config.gitBranch,
          push: true,
        });

        const remote = await getRemoteOrigin(workspace.repoDir);
        const commitUrl = toCommitUrl(stripCredentials(remote), commitSha);

        return {
          outcome: "done" as const,
          summary: [
            `Autonomously executed, verified, committed, and pushed ${task.taskId}.`,
            `Changed files: ${changedFiles.join(", ")}.`,
            `Commit: ${commitSha.slice(0, 7)}.`,
          ].join(" "),
          link: commitUrl,
          commitSha,
          changedFiles,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          outcome: "blocked" as const,
          summary: `Execution for ${task.taskId} was blocked by an error: ${message}`,
        };
      }
    },
  );

  if (config.watchIntervalSec !== undefined) {
    const controller = new AbortController();
    const onSignal = () => {
      logger.info("watch: shutdown signal received");
      controller.abort();
    };
    process.on("SIGTERM", onSignal);
    process.on("SIGINT", onSignal);

    await watch(
      runner,
      {
        intervalSec: config.watchIntervalSec,
        backoffMaxSec: config.watchBackoffMaxSec,
        maxIterations: config.maxIterations,
        signal: controller.signal,
      },
      logger,
    );
    return;
  }

  const outcome = await runner.runNextReadyTask();

  if (outcome.kind === "idle") {
    logger.info(outcome.message);
    return;
  }

  if (config.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          runId: outcome.runId,
          taskId: outcome.task.taskId,
          status: outcome.task.status,
          link: outcome.task.link,
          execution: outcome.execution,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    logger.info(`completed`, {
      runId: outcome.runId,
      taskId: outcome.task.taskId,
      outcome: outcome.execution.outcome,
    });
  }
}

async function cleanupStartupTmuxSession(sessionName: string, logger: Logger) {
  const currentSession = await getCurrentTmuxSession();

  if (currentSession === sessionName) {
    logger.warn(
      `startup tmux cleanup skipped for ${sessionName}: refusing to kill the current session.`,
    );
    return;
  }

  try {
    await execFileAsync("tmux", ["kill-session", "-t", sessionName]);
    logger.info(`startup tmux cleanup: stopped stale session ${sessionName}`);
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & {
      code?: string | number;
      stderr?: string;
    };
    const detail = execError.stderr?.trim() || execError.message;
    logger.debug(`startup tmux cleanup: no session stopped (${detail})`);
  }
}

async function getCurrentTmuxSession(): Promise<string | undefined> {
  if (!process.env.TMUX) {
    return undefined;
  }

  try {
    const { stdout } = await execFileAsync("tmux", ["display-message", "-p", "#S"]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function pickReadyStatus(config: Config) {
  return config.readyStatus as
    | "Inbox"
    | "Todo"
    | "In Progress"
    | "Blocked"
    | "In Review"
    | "Done";
}

function pickReadyStatuses(config: Config) {
  return config.readyStatuses.map(
    (status) =>
      status as
        | "Inbox"
        | "Todo"
        | "In Progress"
        | "Blocked"
        | "In Review"
        | "Done",
  );
}

async function runValidationWithRepairs(input: {
  repoRoot: string;
  task: OrchestrationTask;
  validationCommands: string[];
  config: Config;
  logger: Logger;
}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await runRepoChecks(input.repoRoot, input.validationCommands);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const repairAttempt = attempt + 1;

      if (
        repairAttempt > input.config.agentRepairAttempts ||
        input.config.agentCommand.length === 0
      ) {
        throw error;
      }

      input.logger.warn(
        `${input.task.taskId}: validation failed; running repair attempt ${repairAttempt}/${input.config.agentRepairAttempts}.`,
      );

      await runAgentRepairCommand(
        input.task,
        {
          repoRoot: input.repoRoot,
          command: input.config.agentCommand,
          timeoutMs: input.config.agentTimeoutMs,
        },
        {
          attempt: repairAttempt,
          maxAttempts: input.config.agentRepairAttempts,
          validationCommands: input.validationCommands,
          validationError: message,
          repoDiffSummary: await getRepoDiffSummary(input.repoRoot),
        },
      );
    }
  }
}

async function readPackageVersion() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = path.join(here, "..", "package.json");
  const raw = await readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version ?? "0.0.0";
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
});

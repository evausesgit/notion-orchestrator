import crypto from "node:crypto";
import type { TaskTrackerAdapter } from "./notion-adapter.js";
import { truncateForNotion } from "./notion-adapter.js";
import type { OrchestrationStatus, OrchestrationTask } from "./task-types.js";

export type TaskExecutionResult =
  | {
      outcome: "done" | "in_review";
      summary: string;
      link?: string;
      commitSha?: string;
      changedFiles?: string[];
    }
  | {
      outcome: "blocked";
      summary: string;
    }
  | {
      outcome: "skipped";
      summary: string;
    };

export type TaskExecutor = (
  task: OrchestrationTask,
  runId: string,
) => Promise<TaskExecutionResult>;

export type TaskRunnerConfig = {
  agentName: string;
  sprintFilter?: string;
  readyStatus?: OrchestrationStatus;
  readyStatuses?: OrchestrationStatus[];
};

export type RunnerOutcome =
  | { kind: "idle"; message: string }
  | {
      kind: "ran";
      runId: string;
      task: OrchestrationTask;
      execution: TaskExecutionResult;
    };

export class TaskRunner {
  constructor(
    private readonly tracker: TaskTrackerAdapter,
    private readonly config: TaskRunnerConfig,
    private readonly executor: TaskExecutor,
  ) {}

  async runNextReadyTask(): Promise<RunnerOutcome> {
    const tasks = await this.tracker.listTasks({
      sprint: this.config.sprintFilter || undefined,
      readyStatus: this.config.readyStatus ?? "Todo",
      readyStatuses: this.config.readyStatuses,
      onlyReady: true,
    });

    const nextTask = tasks[0];

    if (!nextTask) {
      return {
        kind: "idle",
        message: "No ready tasks were found in the configured tracker.",
      };
    }

    const runId = createRunId(nextTask.taskId);
    const syncedAt = new Date().toISOString();

    await this.tracker.updateTask(nextTask.taskId, {
      status: "In Progress",
      runId,
      agentName: this.config.agentName,
      agentOutput: truncateForNotion(
        `Run ${runId} picked up ${nextTask.taskId} and started execution.`,
      ),
      syncedAt,
    });

    const result = await this.executor(nextTask, runId);
    const nextStatus: OrchestrationStatus =
      result.outcome === "done"
        ? "Done"
        : result.outcome === "in_review"
          ? "In Review"
          : result.outcome === "skipped"
            ? "Todo"
            : "Blocked";

    const updatedTask = await this.tracker.updateTask(nextTask.taskId, {
      status: nextStatus,
      runId,
      agentName: this.config.agentName,
      agentOutput: truncateForNotion(result.summary),
      link: "link" in result ? result.link : undefined,
      syncedAt: new Date().toISOString(),
    });

    return {
      kind: "ran",
      runId,
      task: updatedTask,
      execution: result,
    };
  }

  async runUntilIdle(maxIterations?: number): Promise<RunnerOutcome[]> {
    const outcomes: RunnerOutcome[] = [];
    const cap = maxIterations ?? Infinity;

    for (let i = 0; i < cap; i += 1) {
      const outcome = await this.runNextReadyTask();
      outcomes.push(outcome);

      if (outcome.kind === "idle") {
        break;
      }
    }

    return outcomes;
  }
}

function createRunId(taskId: string) {
  return `run_${taskId}_${crypto.randomUUID().slice(0, 8)}`;
}

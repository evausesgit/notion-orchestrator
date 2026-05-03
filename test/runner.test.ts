import { describe, expect, it } from "vitest";
import { InMemoryNotionAdapter } from "../src/notion-adapter.js";
import { TaskRunner } from "../src/runner.js";

function seedAdapter() {
  return new InMemoryNotionAdapter([
    {
      pageId: "p1",
      properties: {
        taskId: "T-1",
        title: "Ready",
        status: "Todo",
        priority: "P1",
        type: "Task",
        sprint: "Sprint A",
        repoArea: [],
        blockedBy: [],
        acceptanceCriteria: "ok",
        agentOutput: "",
        executionMode: "agent",
        filesToTouch: [],
        validationCommands: [],
      },
    },
  ]);
}

describe("TaskRunner", () => {
  it("returns idle when no tasks ready", async () => {
    const adapter = new InMemoryNotionAdapter([]);
    const runner = new TaskRunner(
      adapter,
      { agentName: "test" },
      async () => ({ outcome: "in_review", summary: "noop" }),
    );

    const outcome = await runner.runNextReadyTask();
    expect(outcome.kind).toBe("idle");
  });

  it("transitions task to In Review on in_review outcome", async () => {
    const adapter = seedAdapter();
    const runner = new TaskRunner(
      adapter,
      { agentName: "test", sprintFilter: "Sprint A" },
      async (task) => ({
        outcome: "in_review",
        summary: `executed ${task.taskId}`,
      }),
    );

    const outcome = await runner.runNextReadyTask();
    expect(outcome.kind).toBe("ran");
    if (outcome.kind === "ran") {
      expect(outcome.task.status).toBe("In Review");
      expect(outcome.task.lastUpdatedByAgent).toBe("test");
    }
  });

  it("transitions task back to Todo on skipped outcome", async () => {
    const adapter = seedAdapter();
    const runner = new TaskRunner(
      adapter,
      { agentName: "test" },
      async () => ({ outcome: "skipped", summary: "no handler" }),
    );

    const outcome = await runner.runNextReadyTask();
    expect(outcome.kind).toBe("ran");
    if (outcome.kind === "ran") {
      expect(outcome.task.status).toBe("Todo");
    }
  });

  it("runUntilIdle stops when adapter empties", async () => {
    const adapter = seedAdapter();
    let calls = 0;
    const runner = new TaskRunner(
      adapter,
      { agentName: "test" },
      async () => {
        calls += 1;
        return { outcome: "done", summary: "shipped" };
      },
    );

    const results = await runner.runUntilIdle(5);
    expect(calls).toBe(1);
    expect(results.at(-1)?.kind).toBe("idle");
  });
});

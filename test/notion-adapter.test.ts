import { describe, expect, it } from "vitest";
import {
  InMemoryNotionAdapter,
  mapNotionPageToTask,
  normalizeExecutionMode,
  truncateForNotion,
} from "../src/notion-adapter.js";
import { mergePropertyMap } from "../src/notion-properties.js";

describe("InMemoryNotionAdapter", () => {
  it("filters by sprint and readiness", async () => {
    const adapter = new InMemoryNotionAdapter([
      {
        pageId: "p1",
        properties: {
          taskId: "T-1",
          title: "Ready item",
          status: "Todo",
          priority: "P1",
          type: "Task",
          sprint: "Sprint A",
          repoArea: ["docs"],
          blockedBy: [],
          acceptanceCriteria: "ok",
          agentOutput: "",
          executionMode: "agent",
          filesToTouch: [],
          validationCommands: [],
        },
      },
      {
        pageId: "p2",
        properties: {
          taskId: "T-2",
          title: "Blocked item",
          status: "Todo",
          priority: "P1",
          type: "Task",
          sprint: "Sprint A",
          repoArea: [],
          blockedBy: ["p1"],
          acceptanceCriteria: "ok",
          agentOutput: "",
          executionMode: "agent",
          filesToTouch: [],
          validationCommands: [],
        },
      },
      {
        pageId: "p3",
        properties: {
          taskId: "T-3",
          title: "Manual item",
          status: "Todo",
          priority: "P1",
          type: "Task",
          sprint: "Sprint A",
          repoArea: [],
          blockedBy: [],
          acceptanceCriteria: "ok",
          agentOutput: "",
          executionMode: "manual",
          filesToTouch: [],
          validationCommands: [],
        },
      },
      {
        pageId: "p4",
        properties: {
          taskId: "T-4",
          title: "Done blocker",
          status: "Done",
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
      {
        pageId: "p5",
        properties: {
          taskId: "T-5",
          title: "Ready after blocker",
          status: "Todo",
          priority: "P1",
          type: "Task",
          sprint: "Sprint A",
          repoArea: [],
          blockedBy: ["p4"],
          acceptanceCriteria: "ok",
          agentOutput: "",
          executionMode: "agent",
          filesToTouch: [],
          validationCommands: [],
        },
      },
    ]);

    const ready = await adapter.listTasks({ sprint: "Sprint A", onlyReady: true });
    expect(ready.map((task) => task.taskId)).toEqual(["T-1", "T-5"]);
  });

  it("updates status, run id, and writeback fields", async () => {
    const adapter = new InMemoryNotionAdapter([
      {
        pageId: "p1",
        properties: {
          taskId: "T-1",
          title: "Item",
          status: "Todo",
          priority: "P1",
          type: "Task",
          sprint: "",
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

    const updated = await adapter.updateTask("T-1", {
      status: "Done",
      runId: "run_T-1_xxx",
      agentName: "tester",
      agentOutput: "summary",
      link: "https://example/commit",
      syncedAt: new Date().toISOString(),
    });

    expect(updated.status).toBe("Done");
    expect(updated.runId).toBe("run_T-1_xxx");
    expect(updated.lastUpdatedByAgent).toBe("tester");
    expect(updated.link).toBe("https://example/commit");
  });
});

describe("mapNotionPageToTask", () => {
  it("uses overridden property names", () => {
    const customMap = mergePropertyMap({ taskId: "Key" });
    const page = {
      id: "page-1",
      properties: {
        Title: { type: "title" as const, title: [{ plain_text: "Hi" }] },
        Key: { type: "rich_text" as const, rich_text: [{ plain_text: "X-1" }] },
        Status: { type: "select" as const, select: { name: "Todo" } },
        Priority: { type: "select" as const, select: { name: "P0" } },
        Type: { type: "select" as const, select: { name: "Task" } },
        Sprint: { type: "select" as const, select: { name: "Q1" } },
        "Repo Area": {
          type: "multi_select" as const,
          multi_select: [{ name: "docs" }],
        },
        "Blocked By": { type: "relation" as const, relation: [] },
        "Acceptance Criteria": {
          type: "rich_text" as const,
          rich_text: [{ plain_text: "ok" }],
        },
        "Agent Output": { type: "rich_text" as const, rich_text: [] },
        "Run ID": { type: "rich_text" as const, rich_text: [] },
        "Last Updated By Agent": { type: "rich_text" as const, rich_text: [] },
        Link: { type: "url" as const, url: null },
        "Execution Mode": { type: "select" as const, select: null },
        "Files To Touch": { type: "rich_text" as const, rich_text: [] },
        "Implementation Brief": { type: "rich_text" as const, rich_text: [] },
        "Validation Commands": { type: "rich_text" as const, rich_text: [] },
        "Commit Message": { type: "rich_text" as const, rich_text: [] },
        "Automation Policy": { type: "select" as const, select: null },
      },
    };

    const task = mapNotionPageToTask(page, customMap);
    expect(task.taskId).toBe("X-1");
    expect(task.title).toBe("Hi");
    expect(task.priority).toBe("P0");
    expect(task.sprint).toBe("Q1");
    expect(task.repoArea).toEqual(["docs"]);
  });

  it("normalizes execution mode values to manual or agent", () => {
    expect(normalizeExecutionMode("manual")).toBe("manual");
    expect(normalizeExecutionMode("manual_handler")).toBe("manual");
    expect(normalizeExecutionMode("agent")).toBe("agent");
    expect(normalizeExecutionMode("generic_markdown")).toBe("agent");
    expect(normalizeExecutionMode("generic_spec")).toBe("agent");
    expect(normalizeExecutionMode("unknown")).toBeUndefined();
  });
});

describe("truncateForNotion", () => {
  it("returns short content unchanged", () => {
    expect(truncateForNotion("hello")).toBe("hello");
  });

  it("truncates long content with ellipsis", () => {
    const long = "a".repeat(2500);
    const result = truncateForNotion(long);
    expect(result.length).toBeLessThanOrEqual(1900);
    expect(result.endsWith("…")).toBe(true);
  });
});

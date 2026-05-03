import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createExecutor, isSafeRelativePath } from "../src/executor.js";
import type { OrchestrationTask } from "../src/task-types.js";

const execFileAsync = promisify(execFile);

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "no-exec-"));
  await execFileAsync("git", ["-C", workDir, "init", "-q"]);
});

afterAll(async () => {
  // Best-effort cleanup; tmpdir is OK to leak on test failure.
});

function makeTask(overrides: Partial<OrchestrationTask>): OrchestrationTask {
  return {
    pageId: "p",
    taskId: "T-1",
    title: "Test",
    status: "Todo",
    priority: "P1",
    type: "Task",
    sprint: "",
    repoArea: [],
    blockedBy: [],
    acceptanceCriteria: "ok",
    agentOutput: "",
    filesToTouch: [],
    validationCommands: [],
    ...overrides,
  };
}

describe("isSafeRelativePath", () => {
  it.each([
    [".env", false],
    [".env.production", false],
    [".git/config", false],
    [".ssh/id_rsa", false],
    ["docs/foo.md", true],
    ["src/handler.ts", true],
    ["..", false],
    ["../../etc/passwd", false],
    ["/etc/passwd", false],
    ["", false],
    [".notion-orchestrator/runs/x.md", false],
  ])("path %s → safe=%s", (input, expected) => {
    expect(isSafeRelativePath(input)).toBe(expected);
  });
});

describe("createExecutor", () => {
  it("blocks tasks with no executionMode", async () => {
    const executor = createExecutor({
      repoRoot: workDir,
      reviewArtifactDir: ".notion-orchestrator/runs",
    });
    const result = await executor(makeTask({}), "run_x");
    expect(result.outcome).toBe("skipped");
  });

  it("blocks unsafe filesToTouch", async () => {
    const executor = createExecutor({
      repoRoot: workDir,
      reviewArtifactDir: ".notion-orchestrator/runs",
    });
    const result = await executor(
      makeTask({
        executionMode: "agent",
        filesToTouch: [".env"],
        implementationBrief: "x",
      }),
      "run_x",
    );
    expect(result.outcome).toBe("blocked");
    expect(result.summary).toContain("forbidden path");
  });

  it("creates the requested file with agent mode", async () => {
    const executor = createExecutor({
      repoRoot: workDir,
      reviewArtifactDir: ".notion-orchestrator/runs",
    });
    const result = await executor(
      makeTask({
        title: "Hello",
        executionMode: "agent",
        filesToTouch: ["docs/from-test.md"],
        implementationBrief: "Body of the doc",
      }),
      "run_md_1",
    );

    expect(result.outcome).toBe("in_review");

    const created = await readFile(path.join(workDir, "docs/from-test.md"), "utf8");
    expect(created).toContain("# Hello");
    expect(created).toContain("Body of the doc");

    const reviewArtifact = await stat(
      path.join(workDir, ".notion-orchestrator/runs/run_md_1.md"),
    );
    expect(reviewArtifact.isFile()).toBe(true);
  });

});

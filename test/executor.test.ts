import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createExecutor, isSafeRelativePath } from "../src/executor.js";
import { buildAgentPrompt } from "../src/agent-executor.js";
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

  it("blocks agent tasks when no agent command is configured", async () => {
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

    expect(result.outcome).toBe("blocked");
    expect(result.summary).toContain("AGENT_COMMAND_JSON");
  });

  it("runs the configured command in agent mode", async () => {
    const executor = createExecutor({
      repoRoot: workDir,
      reviewArtifactDir: ".notion-orchestrator/runs",
      agentCommand: [
        process.execPath,
        "-e",
        [
          "const fs = require('fs');",
          "const prompt = fs.readFileSync(0, 'utf8');",
          "fs.mkdirSync('docs', { recursive: true });",
          "fs.writeFileSync('docs/from-agent.md', prompt.includes('Task ID: T-1') ? 'ok\\n' : 'missing\\n');",
          "console.log('agent completed');",
        ].join(" "),
      ],
      agentTimeoutMs: 5000,
    });
    const result = await executor(
      makeTask({
        title: "Hello",
        executionMode: "agent",
        filesToTouch: ["docs/from-agent.md"],
        implementationBrief: "Body of the doc",
      }),
      "run_agent_1",
    );

    expect(result.outcome).toBe("in_review");

    const created = await readFile(path.join(workDir, "docs/from-agent.md"), "utf8");
    expect(created).toBe("ok\n");

    const reviewArtifact = await stat(
      path.join(workDir, ".notion-orchestrator/runs/run_agent_1.md"),
    );
    expect(reviewArtifact.isFile()).toBe(true);
  });
});

describe("buildAgentPrompt", () => {
  it("includes the task contract", () => {
    const prompt = buildAgentPrompt(
      makeTask({
        taskId: "MCH-1",
        title: "Fix thing",
        executionMode: "agent",
        filesToTouch: ["src/a.ts"],
        implementationBrief: "Implement the fix",
        acceptanceCriteria: "Tests pass",
      }),
    );

    expect(prompt).toContain("Task ID: MCH-1");
    expect(prompt).toContain("Fix thing");
    expect(prompt).toContain("Tests pass");
    expect(prompt).toContain("Implement the fix");
    expect(prompt).toContain("- src/a.ts");
    expect(prompt).toContain("Do not commit or push");
  });
});

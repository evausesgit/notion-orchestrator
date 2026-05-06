import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const baseEnv = {
  NOTION_TOKEN: "secret_test",
  NOTION_DATA_SOURCE_ID: "0c2bda0d-2ad3-4d2c-8a67-8c1165a1d72c",
  GIT_REPO_URL: "https://github.com/example/repo.git",
};

describe("loadConfig", () => {
  it("parses AGENT_COMMAND_JSON", async () => {
    const config = await loadConfig({
      argv: ["run"],
      env: {
        ...baseEnv,
        AGENT_COMMAND_JSON: '["codex","exec","-"]',
        AGENT_REPAIR_ATTEMPTS: "2",
      },
    });

    expect(config.agentCommand).toEqual(["codex", "exec", "-"]);
    expect(config.agentRepairAttempts).toBe(2);
  });

  it("reads AGENT_COMMAND_JSON_FILE", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "no-config-"));
    const file = path.join(dir, "agent-command.json");
    await writeFile(file, '["node","agent.js"]', "utf8");

    const config = await loadConfig({
      argv: ["run"],
      env: {
        ...baseEnv,
        AGENT_COMMAND_JSON_FILE: file,
      },
    });

    expect(config.agentCommand).toEqual(["node", "agent.js"]);
  });

  it("lets CLI flags override agent repair attempts", async () => {
    const config = await loadConfig({
      argv: ["run", "--agent-repair-attempts", "3"],
      env: {
        ...baseEnv,
        AGENT_REPAIR_ATTEMPTS: "1",
      },
    });

    expect(config.agentRepairAttempts).toBe(3);
  });

  it("parses startup tmux session for watch mode", async () => {
    const config = await loadConfig({
      argv: ["run", "--watch", "60", "--startup-tmux-session", "notion-orch-msa-watch"],
      env: baseEnv,
    });

    expect(config.watchIntervalSec).toBe(60);
    expect(config.startupTmuxSession).toBe("notion-orch-msa-watch");
  });

  it("parses multiple ready statuses", async () => {
    const config = await loadConfig({
      argv: ["run", "--ready-status", "Todo,Blocked"],
      env: baseEnv,
    });

    expect(config.readyStatus).toBe("Todo");
    expect(config.readyStatuses).toEqual(["Todo", "Blocked"]);
  });

  it("allows serve without Notion or git settings", async () => {
    const config = await loadConfig({
      argv: ["serve", "--port", "3010", "--web-config", "/tmp/orchestrator.json"],
      env: {
        PORT: "3000",
      },
    });

    expect(config.command).toBe("serve");
    expect(config.notionToken).toBe("");
    expect(config.gitRepoUrl).toBe("");
    expect(config.webPort).toBe(3010);
    expect(config.webConfigPath).toBe("/tmp/orchestrator.json");
  });
});

import { describe, expect, it } from "vitest";
import { mergeWebConfig } from "../src/web.js";

describe("mergeWebConfig", () => {
  it("keeps an existing token when the submitted token is blank", () => {
    const config = mergeWebConfig(
      {
        NOTION_TOKEN: "secret_existing",
        GIT_BRANCH: "main",
        ALLOW_PUSH: "false",
      },
      {
        NOTION_TOKEN: "",
        GIT_BRANCH: "bot/orchestrator",
        ALLOW_PUSH: "true",
      },
    );

    expect(config.NOTION_TOKEN).toBe("secret_existing");
    expect(config.GIT_BRANCH).toBe("bot/orchestrator");
    expect(config.ALLOW_PUSH).toBe("true");
  });

  it("clears normal text fields when submitted blank", () => {
    const config = mergeWebConfig(
      {
        NOTION_DATA_SOURCE_ID: "abc",
        GIT_REPO_URL: "https://github.com/example/repo.git",
        ALLOW_PUSH: "true",
      },
      {
        NOTION_DATA_SOURCE_ID: "",
        GIT_REPO_URL: "",
      },
    );

    expect(config.NOTION_DATA_SOURCE_ID).toBe("");
    expect(config.GIT_REPO_URL).toBe("");
    expect(config.ALLOW_PUSH).toBe("false");
  });
});

import { describe, expect, it } from "vitest";
import { stripCredentials, toCommitUrl } from "../src/git-ops.js";

describe("stripCredentials", () => {
  it("removes basic auth from https urls", () => {
    expect(
      stripCredentials("https://x-access-token:ghp_xxx@github.com/me/repo.git"),
    ).toBe("https://github.com/me/repo.git");
  });

  it("leaves clean urls unchanged", () => {
    expect(stripCredentials("https://github.com/me/repo.git")).toBe(
      "https://github.com/me/repo.git",
    );
  });

  it("leaves ssh urls unchanged", () => {
    expect(stripCredentials("git@github.com:me/repo.git")).toBe(
      "git@github.com:me/repo.git",
    );
  });
});

describe("toCommitUrl", () => {
  it("converts https remote to commit url", () => {
    expect(
      toCommitUrl("https://github.com/me/repo.git", "abc1234"),
    ).toBe("https://github.com/me/repo/commit/abc1234");
  });

  it("converts ssh remote to https commit url", () => {
    expect(
      toCommitUrl("git@github.com:me/repo.git", "abc1234"),
    ).toBe("https://github.com/me/repo/commit/abc1234");
  });
});

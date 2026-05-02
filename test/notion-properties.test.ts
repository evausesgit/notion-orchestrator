import { describe, expect, it } from "vitest";
import {
  defaultPropertyMap,
  mergePropertyMap,
  parsePropertyMapJson,
} from "../src/notion-properties.js";

describe("notion-properties", () => {
  it("returns defaults when no overrides provided", () => {
    const map = mergePropertyMap();
    expect(map).toEqual(defaultPropertyMap);
    expect(map).not.toBe(defaultPropertyMap);
  });

  it("merges only non-empty string overrides", () => {
    const map = mergePropertyMap({
      taskId: "Key",
      blockedBy: "",
    });
    expect(map.taskId).toBe("Key");
    expect(map.blockedBy).toBe(defaultPropertyMap.blockedBy);
  });

  it("rejects unknown role keys", () => {
    expect(() =>
      parsePropertyMapJson(JSON.stringify({ banana: "Yellow" })),
    ).toThrowError(/Unknown Notion role key/);
  });

  it("rejects empty string values", () => {
    expect(() => parsePropertyMapJson(JSON.stringify({ taskId: "" }))).toThrowError(
      /must be a non-empty string/,
    );
  });

  it("accepts a valid override", () => {
    const overrides = parsePropertyMapJson(
      JSON.stringify({ taskId: "Key", blockedBy: "Depends On" }),
    );
    expect(overrides).toEqual({ taskId: "Key", blockedBy: "Depends On" });
  });
});

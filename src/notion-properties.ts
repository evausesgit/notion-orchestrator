import type { NotionPropertyMap, NotionRoleKey } from "./task-types.js";

export const defaultPropertyMap: NotionPropertyMap = {
  title: "Title",
  taskId: "ID",
  status: "Status",
  priority: "Priority",
  type: "Type",
  sprint: "Sprint",
  repoArea: "Repo Area",
  blockedBy: "Blocked By",
  acceptanceCriteria: "Acceptance Criteria",
  agentOutput: "Agent Output",
  runId: "Run ID",
  lastUpdatedByAgent: "Last Updated By Agent",
  lastSyncAt: "Last Sync At",
  link: "Link",
  executionMode: "Execution Mode",
  filesToTouch: "Files To Touch",
  implementationBrief: "Implementation Brief",
  validationCommands: "Validation Commands",
  commitMessage: "Commit Message",
  automationPolicy: "Automation Policy",
};

export function mergePropertyMap(
  overrides?: Partial<NotionPropertyMap>,
): NotionPropertyMap {
  if (!overrides) {
    return { ...defaultPropertyMap };
  }

  const merged = { ...defaultPropertyMap };

  for (const key of Object.keys(overrides) as NotionRoleKey[]) {
    const value = overrides[key];

    if (typeof value === "string" && value.length > 0) {
      merged[key] = value;
    }
  }

  return merged;
}

export function parsePropertyMapJson(input: string): Partial<NotionPropertyMap> {
  const parsed = JSON.parse(input) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "NOTION_PROPS_JSON must be a JSON object mapping role keys to property names.",
    );
  }

  const result: Partial<NotionPropertyMap> = {};
  const validKeys = new Set<NotionRoleKey>(
    Object.keys(defaultPropertyMap) as NotionRoleKey[],
  );

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!validKeys.has(key as NotionRoleKey)) {
      throw new Error(
        `Unknown Notion role key in NOTION_PROPS_JSON: "${key}". Valid keys: ${[...validKeys].join(", ")}.`,
      );
    }

    if (typeof value !== "string" || value.length === 0) {
      throw new Error(
        `NOTION_PROPS_JSON value for "${key}" must be a non-empty string.`,
      );
    }

    result[key as NotionRoleKey] = value;
  }

  return result;
}

import {
  type NotionPropertyMap,
  type OrchestrationStatus,
  type OrchestrationTask,
  type PickTaskOptions,
  type TaskTransition,
} from "./task-types.js";
import { defaultPropertyMap, mergePropertyMap } from "./notion-properties.js";

export interface TaskTrackerAdapter {
  listTasks(options?: PickTaskOptions): Promise<OrchestrationTask[]>;
  getTask(taskId: string): Promise<OrchestrationTask | null>;
  updateTask(taskId: string, transition: TaskTransition): Promise<OrchestrationTask>;
}

type NotionPageProperty =
  | { type: "title"; title: Array<{ plain_text?: string }> }
  | { type: "rich_text"; rich_text: Array<{ plain_text?: string }> }
  | { type: "select"; select: { name: string } | null }
  | { type: "multi_select"; multi_select: Array<{ name: string }> }
  | { type: "relation"; relation: Array<{ id: string }> }
  | { type: "url"; url: string | null }
  | {
      type: "date";
      date: { start: string; end: string | null; time_zone: string | null } | null;
    };

type NotionPage = {
  id: string;
  properties: Record<string, NotionPageProperty>;
};

type NotionQueryResponse = {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
};

type NotionRow = {
  pageId: string;
  properties: Partial<{
    taskId: string;
    title: string;
    status: OrchestrationStatus;
    priority: OrchestrationTask["priority"];
    type: OrchestrationTask["type"];
    sprint: string;
    repoArea: string[];
    blockedBy: string[];
    acceptanceCriteria: string;
    agentOutput: string;
    runId: string;
    lastUpdatedByAgent: string;
    link: string;
    executionMode: OrchestrationTask["executionMode"];
    filesToTouch: string[];
    implementationBrief: string;
    validationCommands: string[];
    commitMessage: string;
    automationPolicy: OrchestrationTask["automationPolicy"];
  }>;
};

const NOTION_RICH_TEXT_LIMIT = 1900;

export class InMemoryNotionAdapter implements TaskTrackerAdapter {
  private readonly tasks = new Map<string, OrchestrationTask>();

  constructor(seedRows: NotionRow[]) {
    for (const row of seedRows) {
      const task = mapNotionRowToTask(row);
      this.tasks.set(task.taskId, task);
    }
  }

  async listTasks(options?: PickTaskOptions): Promise<OrchestrationTask[]> {
    const readyStatus = options?.readyStatus ?? "Todo";

    return [...this.tasks.values()]
      .filter((task) => {
        if (options?.sprint && task.sprint !== options.sprint) {
          return false;
        }

        if (options?.onlyReady) {
          return task.status === readyStatus && task.blockedBy.length === 0;
        }

        return true;
      })
      .sort(compareTasks);
  }

  async getTask(taskId: string): Promise<OrchestrationTask | null> {
    return this.tasks.get(taskId) ?? null;
  }

  async updateTask(taskId: string, transition: TaskTransition): Promise<OrchestrationTask> {
    const current = this.tasks.get(taskId);

    if (!current) {
      throw new Error(`Task ${taskId} was not found in the in-memory adapter.`);
    }

    const updated: OrchestrationTask = {
      ...current,
      status: transition.status,
      agentOutput: transition.agentOutput,
      runId: transition.runId,
      lastUpdatedByAgent: transition.agentName,
      link: transition.link ?? current.link,
    };

    this.tasks.set(taskId, updated);
    return updated;
  }
}

export type NotionApiAdapterConfig = {
  token: string;
  dataSourceId: string;
  apiVersion: string;
  propertyMap?: Partial<NotionPropertyMap>;
};

export class NotionApiTaskTrackerAdapter implements TaskTrackerAdapter {
  private readonly propertyMap: NotionPropertyMap;

  constructor(private readonly config: NotionApiAdapterConfig) {
    this.propertyMap = mergePropertyMap(config.propertyMap);
  }

  async listTasks(options?: PickTaskOptions): Promise<OrchestrationTask[]> {
    const tasks: OrchestrationTask[] = [];
    const readyStatus = options?.readyStatus ?? "Todo";
    let cursor: string | undefined;

    do {
      const response = await this.request<NotionQueryResponse>(
        `/v1/data_sources/${this.config.dataSourceId}/query`,
        {
          method: "POST",
          body: JSON.stringify({
            page_size: 100,
            start_cursor: cursor,
          }),
        },
      );

      for (const page of response.results) {
        const task = mapNotionPageToTask(page, this.propertyMap);

        if (options?.sprint && task.sprint !== options.sprint) {
          continue;
        }

        if (options?.onlyReady) {
          if (task.status !== readyStatus || task.blockedBy.length > 0) {
            continue;
          }
        }

        tasks.push(task);
      }

      cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (cursor);

    return tasks.sort(compareTasks);
  }

  async getTask(taskId: string): Promise<OrchestrationTask | null> {
    const tasks = await this.listTasks();
    return tasks.find((task) => task.taskId === taskId) ?? null;
  }

  async updateTask(taskId: string, transition: TaskTransition): Promise<OrchestrationTask> {
    const current = await this.getTask(taskId);

    if (!current) {
      throw new Error(`Task ${taskId} was not found in Notion.`);
    }

    const properties: Record<string, unknown> = {
      [this.propertyMap.status]: {
        select: {
          name: transition.status,
        },
      },
      [this.propertyMap.runId]: {
        rich_text: richText(transition.runId),
      },
      [this.propertyMap.lastUpdatedByAgent]: {
        rich_text: richText(transition.agentName),
      },
      [this.propertyMap.lastSyncAt]: {
        date: {
          start: transition.syncedAt,
        },
      },
      [this.propertyMap.agentOutput]: {
        rich_text: richText(truncateForNotion(transition.agentOutput)),
      },
    };

    if (transition.link) {
      properties[this.propertyMap.link] = {
        url: transition.link,
      };
    }

    const page = await this.request<NotionPage>(`/v1/pages/${current.pageId}`, {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    });

    return mapNotionPageToTask(page, this.propertyMap);
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`https://api.notion.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "Content-Type": "application/json",
        "Notion-Version": this.config.apiVersion,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Notion API request failed (${response.status}): ${body}`);
    }

    return (await response.json()) as T;
  }
}

export function mapNotionRowToTask(row: NotionRow): OrchestrationTask {
  const props = row.properties;

  return {
    pageId: row.pageId,
    taskId: props.taskId ?? "",
    title: props.title ?? "",
    status: props.status ?? "Inbox",
    priority: props.priority ?? "P2",
    type: props.type ?? "Task",
    sprint: props.sprint ?? "",
    repoArea: props.repoArea ?? [],
    blockedBy: props.blockedBy ?? [],
    acceptanceCriteria: props.acceptanceCriteria ?? "",
    agentOutput: props.agentOutput ?? "",
    runId: props.runId,
    lastUpdatedByAgent: props.lastUpdatedByAgent,
    link: props.link,
    executionMode: normalizeExecutionMode(props.executionMode),
    filesToTouch: props.filesToTouch ?? [],
    implementationBrief: props.implementationBrief,
    validationCommands: props.validationCommands ?? [],
    commitMessage: props.commitMessage,
    automationPolicy: props.automationPolicy,
  };
}

export function mapNotionPageToTask(
  page: NotionPage,
  propertyMap: NotionPropertyMap = defaultPropertyMap,
): OrchestrationTask {
  const properties = page.properties;
  const get = (key: keyof NotionPropertyMap) => properties[propertyMap[key]];

  return {
    pageId: page.id,
    taskId: readRichText(get("taskId")),
    title: readTitle(get("title")),
    status: (readSelect(get("status")) || "Inbox") as OrchestrationTask["status"],
    priority: (readSelect(get("priority")) || "P2") as OrchestrationTask["priority"],
    type: readSelect(get("type")) || "Task",
    sprint: readSelect(get("sprint")),
    repoArea: readMultiSelect(get("repoArea")),
    blockedBy: readRelation(get("blockedBy")),
    acceptanceCriteria: readRichText(get("acceptanceCriteria")),
    agentOutput: readRichText(get("agentOutput")),
    runId: readRichText(get("runId")) || undefined,
    lastUpdatedByAgent: readRichText(get("lastUpdatedByAgent")) || undefined,
    link: readUrl(get("link")) || undefined,
    executionMode: normalizeExecutionMode(readSelect(get("executionMode"))),
    filesToTouch: splitLinesOrCsv(readRichText(get("filesToTouch"))),
    implementationBrief: readRichText(get("implementationBrief")) || undefined,
    validationCommands: splitLinesOrCsv(readRichText(get("validationCommands"))),
    commitMessage: readRichText(get("commitMessage")) || undefined,
    automationPolicy:
      (readSelect(get("automationPolicy")) as OrchestrationTask["automationPolicy"]) ||
      undefined,
  };
}

export function compareTasks(left: OrchestrationTask, right: OrchestrationTask) {
  const priorityOrder = ["P0", "P1", "P2", "P3"];
  const leftIndex = priorityOrder.indexOf(left.priority);
  const rightIndex = priorityOrder.indexOf(right.priority);

  if (leftIndex !== rightIndex) {
    return leftIndex - rightIndex;
  }

  return left.taskId.localeCompare(right.taskId);
}

export function normalizeExecutionMode(
  value: string | undefined,
): OrchestrationTask["executionMode"] | undefined {
  if (!value) {
    return undefined;
  }

  if (value === "manual" || value === "manual_handler") {
    return "manual";
  }

  if (value === "agent" || value === "generic_markdown" || value === "generic_spec") {
    return "agent";
  }

  return undefined;
}

function readTitle(property: NotionPageProperty | undefined) {
  if (!property || property.type !== "title") {
    return "";
  }

  return property.title.map((item) => item.plain_text ?? "").join("");
}

function readRichText(property: NotionPageProperty | undefined) {
  if (!property || property.type !== "rich_text") {
    return "";
  }

  return property.rich_text.map((item) => item.plain_text ?? "").join("");
}

function readSelect(property: NotionPageProperty | undefined) {
  if (!property || property.type !== "select" || !property.select) {
    return "";
  }

  return property.select.name;
}

function readMultiSelect(property: NotionPageProperty | undefined) {
  if (!property || property.type !== "multi_select") {
    return [];
  }

  return property.multi_select.map((item) => item.name);
}

function readRelation(property: NotionPageProperty | undefined) {
  if (!property || property.type !== "relation") {
    return [];
  }

  return property.relation.map((item) => item.id);
}

function readUrl(property: NotionPageProperty | undefined) {
  if (!property || property.type !== "url") {
    return "";
  }

  return property.url ?? "";
}

function richText(content: string) {
  return [
    {
      type: "text",
      text: {
        content,
      },
    },
  ];
}

function splitLinesOrCsv(content: string) {
  return content
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function truncateForNotion(content: string) {
  if (content.length <= NOTION_RICH_TEXT_LIMIT) {
    return content;
  }

  return `${content.slice(0, NOTION_RICH_TEXT_LIMIT - 1)}…`;
}

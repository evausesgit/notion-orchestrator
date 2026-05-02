export const orchestrationStatuses = [
  "Inbox",
  "Todo",
  "In Progress",
  "Blocked",
  "In Review",
  "Done",
] as const;

export type OrchestrationStatus = (typeof orchestrationStatuses)[number];

export type TaskType =
  | "Epic"
  | "Feature"
  | "Task"
  | "Bug"
  | "Research"
  | "Ops"
  | string;

export type Priority = "P0" | "P1" | "P2" | "P3";

export type ExecutionMode =
  | "manual"
  | "generic_markdown"
  | "generic_spec"
  | "manual_handler";

export type AutomationPolicy =
  | "autonomous"
  | "needs_review"
  | "manual_only";

export type OrchestrationTask = {
  pageId: string;
  taskId: string;
  title: string;
  status: OrchestrationStatus;
  priority: Priority;
  type: TaskType;
  sprint: string;
  repoArea: string[];
  blockedBy: string[];
  acceptanceCriteria: string;
  agentOutput: string;
  runId?: string;
  lastUpdatedByAgent?: string;
  link?: string;
  executionMode?: ExecutionMode;
  filesToTouch: string[];
  implementationBrief?: string;
  validationCommands: string[];
  commitMessage?: string;
  automationPolicy?: AutomationPolicy;
};

export type TaskTransition = {
  status: OrchestrationStatus;
  agentOutput: string;
  runId: string;
  agentName: string;
  link?: string;
  syncedAt: string;
};

export type PickTaskOptions = {
  sprint?: string;
  readyStatus?: OrchestrationStatus;
  onlyReady?: boolean;
};

export type NotionRoleKey =
  | "title"
  | "taskId"
  | "status"
  | "priority"
  | "type"
  | "sprint"
  | "repoArea"
  | "blockedBy"
  | "acceptanceCriteria"
  | "agentOutput"
  | "runId"
  | "lastUpdatedByAgent"
  | "lastSyncAt"
  | "link"
  | "executionMode"
  | "filesToTouch"
  | "implementationBrief"
  | "validationCommands"
  | "commitMessage"
  | "automationPolicy";

export type NotionPropertyMap = Record<NotionRoleKey, string>;

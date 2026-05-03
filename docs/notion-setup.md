# Notion database setup

This guide walks you through creating the Notion database that `notion-orchestrator` reads from. Plan for ~5 minutes.

## What you'll have at the end

- A Notion integration token (`NOTION_TOKEN`)
- A database ID (`NOTION_DATA_SOURCE_ID`)
- A database with the right columns
- One test task ready to execute

## 1. Create the integration

1. Open <https://www.notion.so/my-integrations>.
2. Click **New integration**, name it `notion-orchestrator`, leave defaults.
3. After creation, click **Show** next to the **Internal Integration Secret** and copy the `secret_…` value. This is your `NOTION_TOKEN`.

## 2. Create the database

In Notion, create a new page and add a **Database — Full page** block. Name it whatever you like (`Tasks` works).

Add the columns below. Notion lets you change column types after creating them, but it's faster to set them right the first time.

### Columns YOU fill in (when creating tasks)

These 7 columns drive the runner's behavior. Without them, the task is rejected.

| Column name | Type | Example value |
| --- | --- | --- |
| Title (built-in) | title | `Hello from the orchestrator` |
| ID | Text | `TEST-001` |
| Status | Select — options: `Inbox`, `Todo`, `In Progress`, `In Review`, `Done`, `Blocked` | `Todo` |
| Acceptance Criteria | Text | `File docs/hello.md exists` |
| Execution Mode | Select — options: `manual`, `agent` | `agent` |
| Files To Touch | Text (newline- or comma-separated relative paths) | `docs/hello.md` |
| Implementation Brief | Text | `Body of the markdown section the runner will write.` |

### Columns YOU fill in (optional — for filtering and customization)

| Column name | Type | Used for |
| --- | --- | --- |
| Priority | Select — `P0`, `P1`, `P2`, `P3` | Sort order when multiple tasks are ready |
| Type | Select — free options like `Epic`, `Feature`, `Task`, `Bug` | Informational |
| Sprint | Select — free options | Filter via `--sprint`/`SPRINT_FILTER` |
| Repo Area | Multi-select — free options | Surfaces in the review artifact |
| Blocked By | Relation (this database) | Tasks that must be `Done` first |
| Validation Commands | Text (newline-separated shell commands) | Runs before the commit; failure marks the task `Blocked` |
| Commit Message | Text | Custom commit subject |
| Automation Policy | Select — `autonomous`, `needs_review`, `manual_only` | Informational only for now |

### Columns the RUNNER fills in (just create empty)

Create these columns but leave them blank. The runner writes them on every execution.

| Column name | Type |
| --- | --- |
| Run ID | Text |
| Last Updated By Agent | Text |
| Last Sync At | Date |
| Agent Output | Text |
| Link | URL |

## 3. Connect the integration to the database

This step is required and easy to forget.

1. Open the database.
2. Click the **`…`** menu in the top right.
3. Choose **Connections** → search for `notion-orchestrator` → add it.

Without this, every API call returns 404.

## 4. Find the data source ID

Copy the database URL from your browser. It looks like:

```
https://www.notion.so/your-workspace/514bed22d8164f8698e7255afd0d30d9?v=8b3...
```

The 32-character hash *before* the `?v=` is your `NOTION_DATA_SOURCE_ID`. You can use it raw or with dashes:

- raw: `514bed22d8164f8698e7255afd0d30d9`
- dashed: `514bed22-d816-4f86-98e7-255afd0d30d9`

Both work. The part *after* `?v=` is a Notion view ID — **not** what you want.

## 5. Verify the wiring

```bash
docker run --rm \
  -e NOTION_TOKEN=$NOTION_TOKEN \
  -e NOTION_DATA_SOURCE_ID=$NOTION_DATA_SOURCE_ID \
  ghcr.io/evausesgit/notion-orchestrator:0.1.0 list --json
```

You should see a JSON array of the rows currently in `Todo` with no unresolved blockers. If you created the test task from the README, you should see exactly one entry.

## 6. (Optional) Rename columns

If your existing database already uses different column names, you don't need to rename them — pass an override map:

```bash
NOTION_PROPS_JSON='{"taskId":"Key","blockedBy":"Depends On"}'
```

The keys must be valid role names from the tables above (the canonical role for each column is shown below):

| Role | Default column |
| --- | --- |
| `title` | Title |
| `taskId` | ID |
| `status` | Status |
| `priority` | Priority |
| `type` | Type |
| `sprint` | Sprint |
| `repoArea` | Repo Area |
| `blockedBy` | Blocked By |
| `acceptanceCriteria` | Acceptance Criteria |
| `executionMode` | Execution Mode |
| `filesToTouch` | Files To Touch |
| `implementationBrief` | Implementation Brief |
| `validationCommands` | Validation Commands |
| `commitMessage` | Commit Message |
| `automationPolicy` | Automation Policy |
| `agentOutput` | Agent Output |
| `runId` | Run ID |
| `lastUpdatedByAgent` | Last Updated By Agent |
| `lastSyncAt` | Last Sync At |
| `link` | Link |

Unknown role keys are rejected at startup.

## Status conventions

The runner picks a task when:

- `Status` matches the configured ready status (default `Todo`)
- `Sprint` matches `--sprint`/`SPRINT_FILTER` (or no filter is set)
- `Blocked By` is empty or all blockers are themselves resolved
- `Acceptance Criteria` is non-empty

After execution it transitions:

- `Done` if a commit was pushed
- `In Review` if the change was produced but pushing is disabled
- `Blocked` if execution failed or the task is malformed
- `Todo` if `Execution Mode` is `manual` (deliberately skipped)

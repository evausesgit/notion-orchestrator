# Notion database setup

The orchestrator drives execution from a Notion database. Every column it reads or writes has a default name; you can rename any of them by passing a JSON map through `NOTION_PROPS_JSON` (see the bottom of this page).

## 1. Create the integration

1. Go to <https://www.notion.so/my-integrations> and create a new internal integration.
2. Copy the integration token (`secret_…`). This becomes `NOTION_TOKEN`.
3. Open your database, click `…` → `Connections` → add the integration. Without this, the API will return 404 on every page.

## 2. Find the data source ID

The data source ID is the long identifier in the database URL. Example:

```
https://www.notion.so/your-workspace/514bed22d8164f8698e7255afd0d30d9?v=...
```

Here `514bed22-d816-4f86-98e7-255afd0d30d9` is the data source ID. Use it as `NOTION_DATA_SOURCE_ID`.

## 3. Required properties

Add the following properties to the database. Default names are listed; the **Role** column is the canonical key used in `NOTION_PROPS_JSON`.

| Role | Default name | Notion type | Used for | Notes |
| --- | --- | --- | --- | --- |
| `title` | Title | title | task display | Notion's built-in page title |
| `taskId` | ID | rich_text | identity | Stable, appears in commit messages |
| `status` | Status | select | scheduling | Options: `Inbox`, `Todo`, `In Progress`, `In Review`, `Done`, `Blocked` |
| `priority` | Priority | select | sort order | Options: `P0`, `P1`, `P2`, `P3` |
| `type` | Type | select | classification | Free option set |
| `sprint` | Sprint | select | filter | Free option set; runner filters via `--sprint`/`SPRINT_FILTER` |
| `repoArea` | Repo Area | multi_select | review context | Free option set |
| `blockedBy` | Blocked By | relation | dependencies | Self-relation on the same database |
| `acceptanceCriteria` | Acceptance Criteria | rich_text | gating | Empty value blocks the task |
| `executionMode` | Execution Mode | select | dispatch | Options: `manual`, `manual_handler`, `generic_markdown`, `generic_spec` |
| `filesToTouch` | Files To Touch | rich_text | execution | Newline- or comma-separated relative paths |
| `implementationBrief` | Implementation Brief | rich_text | execution | The body the executor writes |
| `validationCommands` | Validation Commands | rich_text | verification | Newline-separated shell commands |
| `commitMessage` | Commit Message | rich_text | git | Falls back to `Autonomous {taskId} ({runId})` |
| `automationPolicy` | Automation Policy | select | informational | `autonomous` / `needs_review` / `manual_only` |
| `agentOutput` | Agent Output | rich_text | writeback | Filled by the runner; truncated to ~1900 chars |
| `runId` | Run ID | rich_text | writeback | Generated per execution |
| `lastUpdatedByAgent` | Last Updated By Agent | rich_text | writeback | Configured via `--agent-name` |
| `lastSyncAt` | Last Sync At | date | writeback | ISO timestamp |
| `link` | Link | url | writeback | Commit URL once pushed |

## 4. Status conventions

The runner picks a task when:

- `Status` matches the configured ready status (default `Todo`)
- `Sprint` matches `--sprint`/`SPRINT_FILTER` (or no filter is set)
- `Blocked By` is empty or all blockers are themselves resolved (the runner does not yet recursively dereference)
- `Acceptance Criteria` is non-empty

After execution it transitions:

- `Done` if a commit was pushed
- `In Review` if the change was produced but pushing is disabled
- `Blocked` if execution failed or the task is malformed
- `Todo` if `Execution Mode` is `manual`/`manual_handler` (the runner deliberately skipped)

## 5. Renaming columns

If your database already uses different column names, override the mapping at runtime:

```bash
NOTION_PROPS_JSON='{"taskId":"Key","blockedBy":"Depends On"}'
```

The keys must be valid role names from the table above. Unknown keys are rejected at startup, and `notion-orchestrator doctor` will report the resolved property names.

## 6. Test the wiring

```bash
docker run --rm \
  -e NOTION_TOKEN=$NOTION_TOKEN \
  -e NOTION_DATA_SOURCE_ID=$NOTION_DATA_SOURCE_ID \
  ghcr.io/evausesgit/notion-orchestrator:latest list --json
```

You should see a JSON array of the rows currently in `Todo` with no unresolved blockers.

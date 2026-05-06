# Configuration reference

Every setting is reachable via an environment variable and an equivalent CLI flag. Flags override env. Where listed, an `_FILE` env variant reads the value from a file (Docker secrets / Kubernetes secrets idiom).

## Notion

| Env | Flag | Default | Required | Notes |
| --- | --- | --- | --- | --- |
| `NOTION_TOKEN` (`_FILE`) | `--notion-token` | — | yes | Integration token from notion.so/my-integrations |
| `NOTION_DATA_SOURCE_ID` | `--notion-data-source` | — | yes | Database identifier |
| `NOTION_API_VERSION` | `--notion-api-version` | `2025-09-03` | no | Pinned default; bump if you've migrated your integration |
| `NOTION_PROPS_JSON` (`_FILE`) | `--notion-props` | — | no | JSON object overriding column names by role key |

## Task selection

| Env | Flag | Default | Notes |
| --- | --- | --- | --- |
| `SPRINT_FILTER` | `--sprint` | empty | If set, only tasks with this Sprint value are eligible |
| `READY_STATUS` | `--ready-status` | `Todo` | Status considered "ready" for pickup |
| `AGENT_NAME` | `--agent-name` | `notion-orchestrator` | Written to `Last Updated By Agent` |

## Target git repository

| Env | Flag | Default | Required | Notes |
| --- | --- | --- | --- | --- |
| `GIT_REPO_URL` | `--repo` | — | yes for `run` | https or ssh URL |
| `GIT_BRANCH` | `--branch` | `main` | no | Branch cloned and pushed back to |
| `GIT_TOKEN` (`_FILE`) | `--git-token` | — | yes if `ALLOW_PUSH=true` | PAT or installation token |
| `GIT_USERNAME` | `--git-username` | `x-access-token` | no | HTTPS auth username |
| `GIT_AUTHOR_NAME` | `--author-name` | `notion-orchestrator` | no | Commit identity |
| `GIT_AUTHOR_EMAIL` | `--author-email` | `bot@notion-orchestrator.local` | no | Commit identity |

For SSH URLs, mount `~/.ssh` into the container yourself; the runner does not manage SSH keys.

## Workspace and execution

| Env | Flag | Default | Notes |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | — | empty | Required when `AGENT_COMMAND_JSON` invokes the Codex CLI inside the container |
| `WORKSPACE_DIR` | `--workspace` | `/workspace` | Mounted volume root; runner clones into `<dir>/repo` |
| `REVIEW_ARTIFACT_DIR` | `--review-dir` | `.notion-orchestrator/runs` | Relative to the cloned repo |
| `DEFAULT_VALIDATION_COMMANDS` | `--default-validation` | empty | Used when a task supplies no `Validation Commands` |
| `AGENT_COMMAND_JSON` (`_FILE`) | `--agent-command` | empty | JSON array command for `Execution Mode = agent`; receives the prompt on stdin and via `NOTION_ORCHESTRATOR_PROMPT_FILE` |
| `AGENT_TIMEOUT_MS` | `--agent-timeout-ms` | `900000` | Agent command timeout in milliseconds |
| `AGENT_REPAIR_ATTEMPTS` | `--agent-repair-attempts` | `0` | Number of times to rerun the agent when validation fails before blocking the task |
| `ALLOW_PUSH` | `--allow-push` | `false` | Master switch for committing and pushing |

## Run-mode flags

| Flag | Default | Notes |
| --- | --- | --- |
| `--watch <seconds>` | unset (one-shot) | Enables daemon mode |
| `--max-iterations <n>` | unbounded | Cap watch iterations (CI/testing) |
| `--watch-backoff-max <seconds>` (env: `WATCH_BACKOFF_MAX`) | `300` | Max backoff after an error |
| `--dry-run` | off | Skip git push and Notion writeback paths where applicable |
| `--json` | off | Machine-readable output for `list`/`run` |

## Logging

| Env | Flag | Default | Notes |
| --- | --- | --- | --- |
| `LOG_FORMAT` | `--log-format` | `text` (Docker image: `json`) | `json` or `text` |
| `LOG_LEVEL` | `--log-level` | `info` | `debug`, `info`, `warn`, `error` |

The logger redacts any string equal to a known token before writing.

## Web control panel

| Env | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port for `notion-orchestrator serve` |
| `WEB_CONFIG_PATH` | `/workspace/orchestrator-config.json` | File where the web UI stores runtime configuration |

The web UI can start without Notion or git settings. It writes saved values to `WEB_CONFIG_PATH` with mode `0600`, then launches the existing CLI commands as child processes with those values injected into the environment.

## Precedence

CLI flag > environment variable > built-in default.

## `_FILE` secret reads

For Docker secrets / Kubernetes secrets, append `_FILE` to the env var to point at a path:

```bash
docker run --secret notion-token \
  -e NOTION_TOKEN_FILE=/run/secrets/notion-token \
  -e NOTION_DATA_SOURCE_ID=... \
  ghcr.io/evausesgit/notion-orchestrator:0.1.0 doctor
```

Supported keys: `NOTION_TOKEN_FILE`, `NOTION_PROPS_JSON_FILE`, `GIT_TOKEN_FILE`, `AGENT_COMMAND_JSON_FILE`.

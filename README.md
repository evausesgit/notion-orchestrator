# notion-orchestrator

Pick ready tasks from a Notion database, turn them into verifiable git commits.

It is shipped as a single Docker image. No code lives inside your target repo — only Notion property values drive what the runner does.

```
Notion (Todo) ──▶ notion-orchestrator ──▶ git commit on your repo
                  └─ writes a review artifact alongside the change
                  └─ moves the Notion task to In Review (or Done if push is enabled)
```

## What you need before testing

- Docker Desktop running on your machine
- A Notion workspace where you can create a database (~3 minutes of setup)
- A GitHub repo you don't mind committing to (we recommend creating a fresh sandbox repo named e.g. `notion-orch-sandbox`)
- A GitHub Personal Access Token with `Contents: Read & Write` on that sandbox repo

That's it. The runner is self-contained inside the container; you don't need Node, npm, or anything else installed.

## Test it in 5 minutes

### Step 1 — Get a Notion token + database

1. Open <https://www.notion.so/my-integrations>, click **New integration**, name it `notion-orchestrator-test`. Save the `secret_…` token — this is `NOTION_TOKEN`.
2. Create a Notion database. The fastest path is to follow [`docs/notion-setup.md`](docs/notion-setup.md) — it lists the 7 columns you must create yourself plus the 5 the runner will fill. Should take about 3 minutes.
3. Open the database in Notion, click **`…`** (top right) → **Connections** → add the integration you just created. Without this step, the API returns 404.
4. Copy the database URL from your browser. Example:

   ```
   https://www.notion.so/your-workspace/514bed22d8164f8698e7255afd0d30d9?v=...
   ```

   The 32-char hash (`514bed22…d30d9`) is your `NOTION_DATA_SOURCE_ID`. Add dashes if you like (`514bed22-d816-4f86-98e7-255afd0d30d9`); both forms work.

### Step 2 — Create one test task

In the database, add a row with these exact values:

| Field | Value |
| --- | --- |
| Title | `Hello from the orchestrator` |
| ID | `TEST-001` |
| Status | `Todo` |
| Acceptance Criteria | `File docs/hello-from-orchestrator.md exists` |
| Execution Mode | `agent` |
| Files To Touch | `docs/hello-from-orchestrator.md` |
| Implementation Brief | `This file was created by notion-orchestrator from a Notion task.` |

Leave the rest empty. The runner will fill `Run ID`, `Agent Output`, `Last Sync At`, `Last Updated By Agent`, `Link`.

### Step 3 — Get a GitHub token

Go to <https://github.com/settings/personal-access-tokens/new>, create a fine-grained PAT:

- Repository access: **only the sandbox repo**
- Permissions: **Contents → Read and write**

Save the `github_pat_…` token — this is `GIT_TOKEN`.

### Step 3.5 — Configure the agent command

Rows with `Execution Mode = agent` require an agent command. The runner launches this command inside the cloned repo, passes the task prompt on stdin, and also writes the prompt path to `NOTION_ORCHESTRATOR_PROMPT_FILE`.

For example, when running locally with a Codex CLI available on `PATH`:

```bash
export AGENT_COMMAND_JSON='["codex","exec","-"]'
export AGENT_REPAIR_ATTEMPTS=2
```

`AGENT_REPAIR_ATTEMPTS` controls how many times the orchestrator reruns the agent after validation fails. Each repair prompt includes the original task, the validation commands, the validation error, and a git diff summary.

The Docker image installs the OpenAI Codex CLI. If you use Codex in `AGENT_COMMAND_JSON`, also set `OPENAI_API_KEY` in the container environment.

### Step 4 — Run the doctor

> **Note**: until version `v0.1.0` is tagged, the image is not yet on `ghcr.io`. See **Building locally** below for the dev path. Once `v0.1.0` ships, the image is at `ghcr.io/evausesgit/notion-orchestrator:0.1.0`.

```bash
docker run --rm \
  -e NOTION_TOKEN="secret_xxx" \
  -e NOTION_DATA_SOURCE_ID="514bed22-d816-4f86-98e7-255afd0d30d9" \
  -e GIT_REPO_URL="https://github.com/your-name/notion-orch-sandbox.git" \
  -e GIT_TOKEN="github_pat_xxx" \
  ghcr.io/evausesgit/notion-orchestrator:0.1.0 doctor
```

**Expected output**:

```
notion: ok (reachable, 1 tasks total)
git remote: ok (configured: https://github.com/your-name/notion-orch-sandbox.git@main)
workspace: ok (will use /workspace/repo)
```

If anything says `fail`, jump to **Troubleshooting** below.

### Step 5 — Execute the task (without pushing)

```bash
docker run --rm \
  -e NOTION_TOKEN="secret_xxx" \
  -e NOTION_DATA_SOURCE_ID="..." \
  -e GIT_REPO_URL="https://github.com/your-name/notion-orch-sandbox.git" \
  -e GIT_TOKEN="github_pat_xxx" \
  -e AGENT_COMMAND_JSON='["codex","exec","-"]' \
  -e AGENT_REPAIR_ATTEMPTS=2 \
  ghcr.io/evausesgit/notion-orchestrator:0.1.0 run
```

**Expected output**:

```
[info] workspace: cloned https://github.com/your-name/notion-orch-sandbox.git
[info] TEST-001: changes prepared but not committed (allowPush=false, dryRun=false).
[info] completed runId=run_TEST-001_abc12345 taskId=TEST-001 outcome=in_review
```

Open Notion: the `TEST-001` row should now be in `In Review` with a populated `Run ID` and `Agent Output`.

> The runner did **not** push because `ALLOW_PUSH=false` is the default. Your sandbox repo is unchanged. The execution is dry-runnable: re-run the same command and it stays idempotent.

### Step 6 — Allow the push (the real thing)

Reset the task back to `Status = Todo` in Notion, then re-run with `ALLOW_PUSH=true`:

```bash
docker run --rm \
  -e NOTION_TOKEN="..." -e NOTION_DATA_SOURCE_ID="..." \
  -e GIT_REPO_URL="..." -e GIT_TOKEN="..." \
  -e AGENT_COMMAND_JSON='["codex","exec","-"]' \
  -e AGENT_REPAIR_ATTEMPTS=2 \
  -e ALLOW_PUSH=true \
  ghcr.io/evausesgit/notion-orchestrator:0.1.0 run
```

**Expected outcome**:

- `docs/hello-from-orchestrator.md` appears in your sandbox repo on `main`
- The Notion task moves to `Done`
- The `Link` column on the Notion task is filled with the commit URL
- A review artifact is committed at `.notion-orchestrator/runs/run_TEST-001_*.md`

🎉 You've now done a full Notion → repo round trip.

## Building locally (until the image is published on GHCR)

```bash
git clone https://github.com/evausesgit/notion-orchestrator.git
cd notion-orchestrator
docker build -t notion-orchestrator:dev .
```

Then replace `ghcr.io/evausesgit/notion-orchestrator:0.1.0` with `notion-orchestrator:dev` in the commands above.

## Run it for real

For unattended operation, run as a daemon:

```bash
docker run -d --name notion-orchestrator \
  -e NOTION_TOKEN="..." -e NOTION_DATA_SOURCE_ID="..." \
  -e GIT_REPO_URL="..." -e GIT_TOKEN="..." \
  -e AGENT_COMMAND_JSON='["codex","exec","-"]' \
  -e AGENT_REPAIR_ATTEMPTS=2 \
  -e ALLOW_PUSH=true \
  -v notion-orch-workspace:/workspace \
  ghcr.io/evausesgit/notion-orchestrator:0.1.0 run --watch 60
```

The container polls every 60 seconds, with exponential backoff up to 5 minutes when an iteration fails, and shuts down cleanly on `SIGTERM`. Mounting a named volume at `/workspace` keeps the clone between runs (faster fetches).

A complete `docker-compose.yml` is in [`examples/docker-compose.yml`](examples/docker-compose.yml).
A scheduled GitHub Actions workflow is in [`examples/github-actions-runner.yml`](examples/github-actions-runner.yml).

## Web control panel

The Docker image starts a small web UI by default:

```bash
docker run --rm -p 3000:3000 -v notion-orch-workspace:/workspace \
  ghcr.io/evausesgit/notion-orchestrator:0.1.0
```

Open `http://localhost:3000` to save configuration, run `doctor`, run once, or start/stop watch mode. The UI stores configuration at `/workspace/orchestrator-config.json` by default, so mount a persistent volume at `/workspace`.

For Coolify, use the Dockerfile build pack, expose port `3000`, keep a persistent volume mounted at `/workspace`, and let the default command run `serve`. You can still run the raw worker by overriding the command to `run --watch 60`.

## Commands reference

| Command | Description |
| --- | --- |
| `run` (default) | Pick the next ready task, execute it. Add `--watch <seconds>` for daemon mode. |
| `list` | Print the queue of ready tasks. Add `--json` for machine-readable output. |
| `doctor` | Validate config, ping Notion, check the git remote URL is set. |
| `serve` | Start the web control panel on `PORT` (`3000` by default). |
| `version` | Print the package version. |
| `help [command]` | Show extended help. |

Full configuration reference: [`docs/configuration.md`](docs/configuration.md).

## What gets written to your repo

For an `Execution Mode = agent` task: the runner launches the command configured by `AGENT_COMMAND_JSON` inside the cloned repo. The command receives a task prompt on stdin and can also read the same prompt from `NOTION_ORCHESTRATOR_PROMPT_FILE`. The prompt includes the task title, acceptance criteria, implementation brief, repo areas, and files to touch.

The runner refuses to write to forbidden paths: `.git/`, `.env`, `.env.*` except `.env.example`, `.ssh/`, the review artifact directory itself, or anything outside the cloned repo.

A review artifact is written to `.notion-orchestrator/runs/<run-id>.md` inside the clone, listing the changed files and a review checklist.

## Troubleshooting

**`notion: fail (... 401 Unauthorized)`** — token is wrong or the integration was not added to the database. In Notion, open the database → `…` → Connections → add the integration.

**`notion: fail (... 404 Not Found)`** — the data source ID is wrong, OR the integration is not connected to the database. Double-check the 32-character hash from the URL.

**`git remote: fail`** — `GIT_REPO_URL` is empty. Set it.

**`fatal: Authentication failed for ...`** during a real run — `GIT_TOKEN` is missing, expired, or doesn't have `Contents: Write` on the target repo. Recreate the PAT.

**`Workspace at /workspace/repo already tracks <other repo>`** — you reused a workspace volume between two different repos. Delete the volume: `docker volume rm notion-orch-workspace`.

**Task stuck in `In Progress`** — the runner crashed mid-execution. Manually flip the task back to `Todo` in Notion. The runner intentionally never re-picks `In Progress` rows to avoid duplicate work.

**The runner says "No ready tasks"** — only tasks with `Status = Todo`, no blockers, and `Execution Mode = agent` are picked. Manual tasks can remain in `Todo` without being selected by watch mode.

**The runner says "blocked"** — `AGENT_COMMAND_JSON` is not configured, `Files To Touch` includes a forbidden path, or validation still fails after `AGENT_REPAIR_ATTEMPTS`. `Files To Touch`, `Implementation Brief`, and `Acceptance Criteria` are optional; when omitted, the agent prompt falls back to generic guidance. Check the `Agent Output` field in Notion for the exact reason.

## Safety

- `ALLOW_PUSH=false` by default. Without opt-in, the runner never commits or pushes.
- The credential helper writes the token to `/home/runner/.git-credentials` (mode `0600`); the URL stored in `.git/config` does not contain the token.
- The logger redacts any string equal to a known token before writing to stdout/stderr.
- The container runs as a non-root user (`runner`). `/workspace` is the only writable shared volume.

See [`docs/security.md`](docs/security.md).

## Library use

The package also exposes the runner, adapter, and executor as a library (ESM):

```ts
import {
  TaskRunner,
  NotionApiTaskTrackerAdapter,
  createExecutor,
} from "notion-orchestrator";
```

This is convenient for embedding the runner into a custom orchestrator process. See [`src/index.ts`](src/index.ts) for the full export surface.

## Status

`v0.x` — interface may shift across minor versions until `v1.0`. Pin to a tag in production.

## License

Apache-2.0 — see [`LICENSE`](LICENSE).

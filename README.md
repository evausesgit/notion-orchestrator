# notion-orchestrator

Pick ready tasks from a Notion database, turn them into verifiable git commits.

`notion-orchestrator` is a small, opinionated runner that:
- polls a Notion database for tasks in a configurable status (default `Todo`)
- writes the requested file changes into a target git repository (clone managed by the runner)
- moves the task through `In Progress` → `In Review` (or `Done` when push is enabled)
- writes a review artifact next to the changes so a human can inspect what was produced

It is shipped as a single Docker image. No code lives inside your target repo — only Notion property values drive what the runner does.

## Quick start

### 1. Prepare a Notion database

Follow [`docs/notion-setup.md`](docs/notion-setup.md). The runner expects 20 properties; you can rename any of them via `NOTION_PROPS_JSON`.

Minimum viable task: `Title`, `ID`, `Status = Todo`, `Acceptance Criteria`, `Execution Mode = generic_markdown`, `Files To Touch`, `Implementation Brief`.

### 2. Pull and run the image

```bash
docker run --rm \
  -e NOTION_TOKEN=secret_xxx \
  -e NOTION_DATA_SOURCE_ID=... \
  -e GIT_REPO_URL=https://github.com/you/sandbox.git \
  -e GIT_TOKEN=ghp_xxx \
  -e GIT_BRANCH=main \
  ghcr.io/evausesgit/notion-orchestrator:latest doctor
```

If `doctor` reports `notion: ok` and `git remote: ok`, you're ready to execute work:

```bash
docker run --rm \
  -e NOTION_TOKEN=... -e NOTION_DATA_SOURCE_ID=... \
  -e GIT_REPO_URL=https://github.com/you/sandbox.git \
  -e GIT_TOKEN=... \
  ghcr.io/evausesgit/notion-orchestrator:latest run
```

By default, `run` performs a dry execution: it clones the repo, applies the change, writes a review artifact, and moves the Notion task to `In Review` — but it does **not** push anything. Add `-e ALLOW_PUSH=true` to allow committing and pushing.

### 3. Watch mode

For unattended operation, run the container as a daemon:

```bash
docker run -d --name notion-orchestrator \
  -e NOTION_TOKEN=... -e NOTION_DATA_SOURCE_ID=... \
  -e GIT_REPO_URL=... -e GIT_TOKEN=... \
  -e ALLOW_PUSH=true \
  ghcr.io/evausesgit/notion-orchestrator:latest run --watch 60
```

The container polls every 60 seconds, with exponential backoff up to 5 minutes when an iteration fails, and shuts down cleanly on `SIGTERM`.

## Commands

| Command | Description |
| --- | --- |
| `run` (default) | Pick the next ready task, execute it. Add `--watch <seconds>` for daemon mode. |
| `list` | Print the queue of ready tasks. Add `--json` for machine-readable output. |
| `doctor` | Validate config, ping Notion, check the git remote URL is set. |
| `version` | Print the package version. |
| `help [command]` | Show extended help. |

Full reference: [`docs/configuration.md`](docs/configuration.md).

## What gets written

For an `Execution Mode = generic_markdown` task, the runner appends a section to each path listed in `Files To Touch`, using the `Implementation Brief` as the body.

For `Execution Mode = generic_spec`, the runner creates the first listed file as a spec doc (Title + Scope + Acceptance Criteria) and any subsequent files as TypeScript placeholders that export the brief.

The runner refuses to write to forbidden paths: `.git/`, `.env*`, `.ssh/`, the review artifact directory itself, or anything outside the cloned repo.

A review artifact is written to `.notion-orchestrator/runs/<run-id>.md` inside the clone, listing the changed files and a review checklist.

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

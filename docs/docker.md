# Running the Docker image

The image is published to `ghcr.io/evausesgit/notion-orchestrator`. Tags follow the package version (`v0.1.0`, `v0.2.0`, …) plus a moving `:latest`.

## One-shot

```bash
docker run --rm \
  -e NOTION_TOKEN=secret_xxx \
  -e NOTION_DATA_SOURCE_ID=... \
  -e GIT_REPO_URL=https://github.com/you/sandbox.git \
  -e GIT_TOKEN=ghp_xxx \
  -e AGENT_COMMAND_JSON='["codex","exec","-"]' \
  -e AGENT_REPAIR_ATTEMPTS=2 \
  -e ALLOW_PUSH=true \
  ghcr.io/evausesgit/notion-orchestrator:0.1.0 run
```

Each `docker run` re-clones the target repo into the container's `/workspace/repo`, executes one ready task, then exits.

`AGENT_COMMAND_JSON` must point to a command available inside the container. The base image does not install a coding agent CLI; build a custom image if you want to run Codex, Claude, or another agent inside Docker. `AGENT_REPAIR_ATTEMPTS` controls how many times the same command is rerun with validation failure context before the task is marked blocked.

## Daemon

```bash
docker run -d --name notion-orchestrator \
  -e NOTION_TOKEN=... -e NOTION_DATA_SOURCE_ID=... \
  -e GIT_REPO_URL=... -e GIT_TOKEN=... \
  -e AGENT_COMMAND_JSON='["codex","exec","-"]' \
  -e AGENT_REPAIR_ATTEMPTS=2 \
  -e ALLOW_PUSH=true \
  -v notion-orch-workspace:/workspace \
  ghcr.io/evausesgit/notion-orchestrator:0.1.0 run --watch 60
```

Mounting a named volume at `/workspace` keeps the clone between runs, so subsequent fetches are fast (`fetch + reset --hard origin/<branch>`).

## docker-compose

See [`examples/docker-compose.yml`](../examples/docker-compose.yml).

## Image internals

- Base: `node:20-bookworm-slim`
- Adds `git`, `ca-certificates`, `openssh-client`
- Non-root user `runner` (UID/GID 999 by default — exact value depends on base image)
- `/workspace` declared as a volume
- Exposes port `3000` for the web control panel
- ENTRYPOINT: `node /home/runner/app/dist/cli.js`
- Default CMD: `serve`

## Web control panel

Running the image without a command starts the web UI:

```bash
docker run --rm -p 3000:3000 \
  -v notion-orch-workspace:/workspace \
  ghcr.io/evausesgit/notion-orchestrator:0.1.0
```

The UI stores its configuration in `/workspace/orchestrator-config.json` by default and can run `doctor`, run once, or start/stop `run --watch 60`.

## Bind-mounting a host directory

If you bind-mount a host directory at `/workspace`, ownership must be writable by the `runner` user. The simplest approach is to use a named Docker volume.

## SSH-based git auth

To use SSH instead of HTTPS, mount your SSH config:

```bash
docker run --rm \
  -v "$HOME/.ssh:/home/runner/.ssh:ro" \
  -e NOTION_TOKEN=... -e NOTION_DATA_SOURCE_ID=... \
  -e GIT_REPO_URL=git@github.com:you/sandbox.git \
  ghcr.io/evausesgit/notion-orchestrator:0.1.0 run
```

The runner does not touch SSH config; it relies on the standard `ssh` CLI behaviour.

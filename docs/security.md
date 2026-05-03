# Security model

`notion-orchestrator` runs as a Notion-authorized integration that can write to one git repository. Treat its tokens as sensitive.

## What the runner can do

- Read every page in the configured Notion data source.
- Patch the Status, Run ID, Last Updated By Agent, Last Sync At, Agent Output, and Link properties on those pages.
- Create or modify any file in the target git repository (subject to forbidden-path rules below).
- Push commits to the configured branch when `ALLOW_PUSH=true`.

## What the runner does NOT do

- Touch `.git/`, `.env`, `.env.*` except `.env.example`, `.ssh/`, or `.notion-orchestrator/` paths via task input (rejected before write).
- Walk outside the cloned repository (`..` or absolute paths in `Files To Touch` are rejected).
- Force-push or rewrite history. `commitAndPush` performs a fast-forward `push origin HEAD:<branch>` and will fail if the remote diverged.
- Log secrets. The logger redacts known tokens before writing.
- Pass `NOTION_TOKEN`, `GIT_TOKEN`, or their `_FILE` variants to the configured agent subprocess.

## Token handling

- `NOTION_TOKEN` and `GIT_TOKEN` may be passed as env vars or via `_FILE` variants reading from disk (Docker / Kubernetes secrets).
- The credential helper writes `~/.git-credentials` with mode `0600` and configures `git credential.helper store`. The token is **not** persisted in `.git/config`'s remote URL.
- The agent subprocess receives a sanitized environment. It gets the repo path and prompt path, but not the Notion or Git write tokens.
- The container runs as the non-root user `runner`. The home directory `/home/runner` is the only place tokens are persisted on disk.

## Recommendations

1. **Use a dedicated branch.** Aim the runner at something like `bot/notion-orchestrator` rather than `main`, and gate merges through a PR.
2. **Use a fine-grained PAT.** Restrict the `GIT_TOKEN` to a single repository, with only `Contents: Read & Write` scope.
3. **Use a Notion integration with no extra database access.** Connect it only to the orchestration database.
4. **Enable `ALLOW_PUSH` deliberately.** The default is off; turn it on only after you've verified the diffs the runner produces.
5. **Avoid mounting your full `~/.ssh` for SSH auth.** Mount a single-key directory whose key is added to a deploy-key on the target repo.

## Reporting vulnerabilities

Open a private security advisory on the GitHub repository. Do not file public issues for security-sensitive bugs.

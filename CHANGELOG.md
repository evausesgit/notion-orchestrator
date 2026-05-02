# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Initial extraction from `mon-super-agent`'s `orchestration/` package.
- Generic Notion-driven execution: `generic_markdown` and `generic_spec` modes.
- Configurable Notion property names via `NOTION_PROPS_JSON`.
- `run`, `list`, `doctor`, `version`, `help` CLI subcommands.
- `--watch` daemon mode with exponential backoff and `SIGTERM`/`SIGINT` handling.
- Workspace bootstrap that clones a target git repository and writes a credential helper.
- `--allow-push` opt-in to commit and push back to the configured branch.
- Multi-stage Dockerfile based on `node:20-bookworm-slim`, runs as non-root user `runner`.
- Vitest suite covering property mapping, in-memory adapter, runner, executor, git utilities.

[Unreleased]: https://github.com/evausesgit/notion-orchestrator/commits/main

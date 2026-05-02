import { chmod, mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { cloneOrFetch, configureCommitter, stripCredentials } from "./git-ops.js";
import type { Logger } from "./logger.js";

const execFileAsync = promisify(execFile);

export type WorkspaceConfig = {
  workspaceDir: string;
  repoUrl: string;
  branch: string;
  gitToken?: string;
  gitUsername: string;
  authorName: string;
  authorEmail: string;
};

export type WorkspaceResult = {
  repoDir: string;
  cloned: boolean;
  remoteUrl: string;
};

export async function setupWorkspace(
  config: WorkspaceConfig,
  logger: Logger,
): Promise<WorkspaceResult> {
  await mkdir(config.workspaceDir, { recursive: true });
  const repoDir = path.join(config.workspaceDir, "repo");
  const authUrl = buildAuthUrl(config);

  await ensureCredentialHelper(config, logger);

  logger.info(
    `workspace: preparing ${repoDir} for ${stripCredentials(config.repoUrl)}@${config.branch}`,
  );

  const { cloned } = await cloneOrFetch({
    repoUrl: config.repoUrl,
    dir: repoDir,
    branch: config.branch,
    authUrl,
  });

  await configureCommitter(repoDir, config.authorName, config.authorEmail);

  logger.info(
    cloned
      ? `workspace: cloned ${stripCredentials(config.repoUrl)}`
      : `workspace: refreshed existing clone`,
  );

  return {
    repoDir,
    cloned,
    remoteUrl: config.repoUrl,
  };
}

export function buildAuthUrl(config: WorkspaceConfig): string {
  const url = config.repoUrl;

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return url;
  }

  if (!config.gitToken) {
    return url;
  }

  const protocolEnd = url.indexOf("://") + 3;
  const protocol = url.slice(0, protocolEnd);
  const rest = url.slice(protocolEnd);
  const username = encodeURIComponent(config.gitUsername);
  const token = encodeURIComponent(config.gitToken);
  return `${protocol}${username}:${token}@${rest}`;
}

async function ensureCredentialHelper(config: WorkspaceConfig, logger: Logger) {
  if (!config.gitToken) {
    return;
  }

  if (!config.repoUrl.startsWith("http://") && !config.repoUrl.startsWith("https://")) {
    return;
  }

  const home = os.homedir();
  const credentialsPath = path.join(home, ".git-credentials");

  const { protocol, host } = parseHost(config.repoUrl);
  const username = encodeURIComponent(config.gitUsername);
  const token = encodeURIComponent(config.gitToken);
  const line = `${protocol}//${username}:${token}@${host}\n`;

  await writeFile(credentialsPath, line, { encoding: "utf8" });
  await chmod(credentialsPath, 0o600);

  await execFileAsync("git", [
    "config",
    "--global",
    "credential.helper",
    "store",
  ]);

  logger.debug(`workspace: wrote credential helper for ${host}`);
}

function parseHost(url: string) {
  const match = url.match(/^(https?:)\/\/(?:[^@/]+@)?([^/]+)/);

  if (!match) {
    throw new Error(`Cannot parse git URL host from ${url}`);
  }

  return {
    protocol: match[1] as string,
    host: match[2] as string,
  };
}

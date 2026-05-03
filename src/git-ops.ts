import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function getRemoteOrigin(repoRoot: string) {
  const { stdout } = await execFileAsync("git", [
    "-C",
    repoRoot,
    "remote",
    "get-url",
    "origin",
  ]);

  return stdout.trim();
}

export async function listChangedFiles(repoRoot: string) {
  const { stdout } = await execFileAsync("git", ["-C", repoRoot, "status", "--short"]);

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[A-Z? ]{1,2}\s+/, ""));
}

export async function getRepoDiffSummary(repoRoot: string) {
  const [status, diffStat] = await Promise.all([
    execFileAsync("git", ["-C", repoRoot, "status", "--short"]).then(
      ({ stdout }) => stdout.trim(),
    ),
    execFileAsync("git", ["-C", repoRoot, "diff", "--stat"]).then(
      ({ stdout }) => stdout.trim(),
    ),
  ]);

  return [
    "git status --short:",
    status || "(clean)",
    "",
    "git diff --stat:",
    diffStat || "(no tracked diff)",
  ].join("\n");
}

export type RunRepoChecksOptions = {
  shell?: string;
};

export async function runRepoChecks(
  repoRoot: string,
  commands: string[] | undefined,
  options: RunRepoChecksOptions = {},
) {
  if (!commands || commands.length === 0) {
    return { ranAny: false };
  }

  const shell = options.shell ?? "bash";
  await execFileAsync(shell, [
    "-lc",
    `cd ${shellEscape(repoRoot)} && ${commands.join(" && ")}`,
  ]);

  return { ranAny: true };
}

export type CommitAndPushInput = {
  repoRoot: string;
  taskId: string;
  runId: string;
  files: string[];
  commitMessage?: string;
  branch: string;
  push: boolean;
};

export type CommitResult = {
  commitSha: string;
  pushed: boolean;
};

export async function commitAndPush(input: CommitAndPushInput): Promise<CommitResult> {
  if (input.files.length === 0) {
    throw new Error(`No files were changed for ${input.taskId}; refusing to auto-commit.`);
  }

  await execFileAsync("git", ["-C", input.repoRoot, "add", ...input.files]);
  await execFileAsync("git", [
    "-C",
    input.repoRoot,
    "commit",
    "-m",
    input.commitMessage ?? `Autonomous ${input.taskId} (${input.runId})`,
  ]);

  if (input.push) {
    await execFileAsync("git", [
      "-C",
      input.repoRoot,
      "push",
      "origin",
      `HEAD:${input.branch}`,
    ]);
  }

  const { stdout } = await execFileAsync("git", [
    "-C",
    input.repoRoot,
    "rev-parse",
    "HEAD",
  ]);

  return {
    commitSha: stdout.trim(),
    pushed: input.push,
  };
}

export function toCommitUrl(remoteUrl: string, commitSha: string) {
  const normalized = remoteUrl
    .replace(/^git@github.com:/, "https://github.com/")
    .replace(/\.git$/, "");

  return `${normalized}/commit/${commitSha}`;
}

export type CloneOrFetchInput = {
  repoUrl: string;
  dir: string;
  branch: string;
  authUrl: string;
};

export async function cloneOrFetch(input: CloneOrFetchInput) {
  const exists = await pathExists(`${input.dir}/.git`);

  if (exists) {
    const remote = await getRemoteOrigin(input.dir).catch(() => "");

    if (remote && stripCredentials(remote) !== stripCredentials(input.repoUrl)) {
      throw new Error(
        `Workspace at ${input.dir} already tracks ${stripCredentials(remote)}; refusing to mix with ${stripCredentials(input.repoUrl)}.`,
      );
    }

    await execFileAsync("git", ["-C", input.dir, "fetch", "origin", input.branch]);
    await execFileAsync("git", ["-C", input.dir, "checkout", input.branch]);
    await execFileAsync("git", [
      "-C",
      input.dir,
      "reset",
      "--hard",
      `origin/${input.branch}`,
    ]);
    return { cloned: false };
  }

  await execFileAsync("git", [
    "clone",
    "--branch",
    input.branch,
    "--depth",
    "1",
    input.authUrl,
    input.dir,
  ]);

  await execFileAsync("git", [
    "-C",
    input.dir,
    "remote",
    "set-url",
    "origin",
    input.repoUrl,
  ]);

  return { cloned: true };
}

export async function configureCommitter(
  repoRoot: string,
  name: string,
  email: string,
) {
  await execFileAsync("git", ["-C", repoRoot, "config", "user.name", name]);
  await execFileAsync("git", ["-C", repoRoot, "config", "user.email", email]);
}

export async function currentRevision(repoRoot: string) {
  const { stdout } = await execFileAsync("git", [
    "-C",
    repoRoot,
    "rev-parse",
    "HEAD",
  ]);
  return stdout.trim();
}

function shellEscape(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function pathExists(target: string) {
  const { stat } = await import("node:fs/promises");
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export function stripCredentials(url: string) {
  return url.replace(/^(https?:\/\/)[^@/]+@/, "$1");
}

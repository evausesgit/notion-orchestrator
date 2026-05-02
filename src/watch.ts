import type { Logger } from "./logger.js";
import type { TaskRunner } from "./runner.js";

export type WatchOptions = {
  intervalSec: number;
  backoffMaxSec: number;
  maxIterations?: number;
  signal?: AbortSignal;
};

export async function watch(
  runner: TaskRunner,
  options: WatchOptions,
  logger: Logger,
): Promise<void> {
  let iteration = 0;
  let backoffSec = options.intervalSec;

  while (!options.signal?.aborted) {
    if (options.maxIterations !== undefined && iteration >= options.maxIterations) {
      logger.info(`watch: reached max-iterations cap (${options.maxIterations}); exiting.`);
      return;
    }
    iteration += 1;

    try {
      const outcome = await runner.runNextReadyTask();

      if (outcome.kind === "idle") {
        logger.debug(`watch: idle, sleeping ${options.intervalSec}s`);
        await sleep(options.intervalSec, options.signal);
        backoffSec = options.intervalSec;
        continue;
      }

      logger.info(`watch: completed run`, {
        runId: outcome.runId,
        taskId: outcome.task.taskId,
        outcome: outcome.execution.outcome,
      });
      backoffSec = options.intervalSec;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`watch: iteration failed: ${message}`);

      backoffSec = Math.min(backoffSec * 2, options.backoffMaxSec);
      logger.warn(`watch: backing off ${backoffSec}s before retrying`);
      await sleep(backoffSec, options.signal);
    }
  }
}

function sleep(seconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, seconds * 1000);

    const onAbort = () => {
      cleanup();
      resolve();
    };

    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

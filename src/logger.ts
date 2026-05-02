export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "text" | "json";

export type LoggerConfig = {
  level: LogLevel;
  format: LogFormat;
  redactions?: string[];
};

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type Logger = {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(extra: Record<string, unknown>): Logger;
};

export function createLogger(config: LoggerConfig, baseFields: Record<string, unknown> = {}): Logger {
  const threshold = LEVELS[config.level];
  const redactions = (config.redactions ?? []).filter((value) => value && value.length > 4);

  function emit(level: LogLevel, message: string, fields?: Record<string, unknown>) {
    if (LEVELS[level] < threshold) {
      return;
    }

    const merged = {
      ...baseFields,
      ...fields,
    };

    const safeMessage = redact(message, redactions);
    const safeFields = redactObject(merged, redactions);

    if (config.format === "json") {
      const payload = {
        ts: new Date().toISOString(),
        level,
        msg: safeMessage,
        ...safeFields,
      };
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return;
    }

    const fieldString =
      Object.keys(safeFields).length > 0 ? ` ${formatFields(safeFields)}` : "";
    const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
    stream.write(`[${level}] ${safeMessage}${fieldString}\n`);
  }

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    child(extra) {
      return createLogger(config, { ...baseFields, ...extra });
    },
  };
}

function redact(input: string, secrets: string[]): string {
  let output = input;

  for (const secret of secrets) {
    if (!secret) {
      continue;
    }
    output = output.split(secret).join("***");
  }

  return output;
}

function redactObject(
  fields: Record<string, unknown>,
  secrets: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string") {
      out[key] = redact(value, secrets);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = redactObject(value as Record<string, unknown>, secrets);
    } else {
      out[key] = value;
    }
  }

  return out;
}

function formatFields(fields: Record<string, unknown>) {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" ");
}

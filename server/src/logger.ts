/**
 * Structured JSON logs, one line per event. Any log platform (Datadog, Grafana Loki,
 * CloudWatch, Render's log viewer) can filter and chart these fields without parsing.
 */
export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export function createJsonLogger(write: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): Logger {
  const log = (level: string, message: string, fields: Record<string, unknown> = {}) => {
    write(JSON.stringify({ time: new Date().toISOString(), level, message, ...fields }));
  };
  return {
    info: (message, fields) => log('info', message, fields),
    warn: (message, fields) => log('warn', message, fields),
    error: (message, fields) => log('error', message, fields),
  };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

/** Errors don't serialize with JSON.stringify; keep the useful parts. */
export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return { message: String(err) };
}

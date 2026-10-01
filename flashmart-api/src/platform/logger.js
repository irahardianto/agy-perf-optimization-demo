const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40, silent: 100 });

/**
 * Minimal structured (JSON lines) logger with level filtering.
 * @param {{ level?: keyof LEVELS, stream?: { write(chunk: string): unknown }, base?: Record<string, unknown> }} [options]
 */
export function createLogger({ level = 'info', stream = process.stdout, base = {} } = {}) {
  if (!(level in LEVELS)) {
    throw new Error(`Unknown log level "${level}". Expected one of: ${Object.keys(LEVELS).join(', ')}`);
  }
  const threshold = LEVELS[level];

  function write(entryLevel, msg, fields) {
    if (LEVELS[entryLevel] < threshold) return;
    const entry = { ts: new Date().toISOString(), level: entryLevel, msg, ...base, ...fields };
    stream.write(`${JSON.stringify(entry)}\n`);
  }

  return {
    level,
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
    child: (fields) => createLogger({ level, stream, base: { ...base, ...fields } }),
  };
}

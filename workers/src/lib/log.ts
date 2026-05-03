/** Structured JSON logging. Never log raw secrets or PII bodies. */
type Level = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  requestId?: string;
  msg: string;
  [k: string]: unknown;
}

function emit(level: Level, fields: LogFields) {
  const line = JSON.stringify({ level, ts: new Date().toISOString(), ...fields });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const log = {
  debug: (f: LogFields) => emit('debug', f),
  info: (f: LogFields) => emit('info', f),
  warn: (f: LogFields) => emit('warn', f),
  error: (f: LogFields) => emit('error', f),
};

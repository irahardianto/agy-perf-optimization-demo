import { existsSync } from 'node:fs';
import http from 'node:http';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './platform/logger.js';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel });

for (const file of [config.catalogPath, config.apiKeysPath]) {
  if (!existsSync(file)) {
    logger.error('data file not found — run `npm run setup` first', { file });
    process.exit(1);
  }
}

const app = buildApp({ config, logger });
const server = http.createServer(app.handler);
server.keepAliveTimeout = 5_000;

server.listen(config.port, config.host, () => {
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  logger.info('FlashMart API listening', { url: `http://${config.host}:${port}`, pid: process.pid });
  // Lets tooling that forks the server (bench, profiler) know which port was bound.
  process.send?.({ type: 'ready', port });
});

let shuttingDown = false;

// Graceful shutdown. Tooling uses the IPC message because signals are not portable to Windows,
// and a clean exit is required for --cpu-prof / --heap-prof to write their files.
function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { reason });
  setTimeout(() => process.exit(0), 2_000).unref();
  server.close(() => {
    app.close();
    process.exit(0);
  });
  server.closeAllConnections?.();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('message', (message) => {
  if (message?.type === 'shutdown') shutdown('ipc');
});

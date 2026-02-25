import { ServerContext } from '../server/ServerContext.js';

type LogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';

/**
 * MCP-standard logging via server.sendLoggingMessage().
 * Falls back to console.error() before server connection is established.
 */
export const mcpLogger = {
  log(level: LogLevel, logger: string, data: unknown): void {
    if (ServerContext.isInitialized()) {
      ServerContext.getInstance().server
        .sendLoggingMessage({ level, logger, data })
        .catch(() => {
          // Swallow send errors — client may have disconnected
        });
    } else {
      console.error(`[${level.toUpperCase()}] [${logger}]`, data);
    }
  },

  debug(logger: string, data: unknown): void {
    if (ServerContext.isInitialized()) {
      this.log('debug', logger, data);
    } else if (process.env.DEBUG) {
      console.error(`[DEBUG] [${logger}]`, data);
    }
  },

  info(logger: string, data: unknown): void {
    this.log('info', logger, data);
  },

  warning(logger: string, data: unknown): void {
    this.log('warning', logger, data);
  },

  error(logger: string, data: unknown): void {
    this.log('error', logger, data);
  },
};

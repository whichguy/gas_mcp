/**
 * Simple logger utility wrapping console.error for structured logging
 */

export const log = {
  debug: (message: string, ...args: any[]) => {
    if (process.env.DEBUG) {
      console.error(`[DEBUG] ${message}`, ...args);
    }
  },

  info: (message: string, ...args: any[]) => {
    console.error(`[INFO] ${message}`, ...args);
  },

  warn: (message: string, ...args: any[]) => {
    console.error(`[WARN] ${message}`, ...args);
  },

  error: (message: string, ...args: any[]) => {
    console.error(`[ERROR] ${message}`, ...args);
  }
};

#!/usr/bin/env node

import { MCPGasServer } from './server/mcpServer.js';
import { SessionAuthManager } from './auth/sessionManager.js';
import { McpGasConfigManager } from './config/mcpGasConfig.js';
import { LockManager } from './utils/lockManager.js';
import path from 'path';
import os from 'os';

/**
 * Parse command line arguments
 */
function parseArgs(): { configPath?: string } {
  const args = process.argv.slice(2);
  const result: { configPath?: string } = {};
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' || args[i] === '-c') {
      if (i + 1 < args.length) {
        result.configPath = args[i + 1];
        i++; // Skip the next argument since we consumed it
      } else {
        console.error('Error: --config requires a file path');
        process.exit(1);
      }
    }
  }
  
  return result;
}

/**
 * Main entry point for MCP Gas Server
 */
async function main() {
  const { configPath } = parseArgs();

  console.error('🚀 Starting MCP Gas Server with forced desktop authentication...');

  // Initialize configuration with explicit config file path
  if (configPath) {
    const absoluteConfigPath = path.resolve(configPath);
    console.error(`🔧 Using config file: ${absoluteConfigPath}`);
    await McpGasConfigManager.initializeFromFile(absoluteConfigPath);
  } else {
    console.error(`⚠️  No config file specified. Use --config <path> to specify configuration file.`);
    console.error(`   Example: node dist/index.js --config ./gas-config.json`);
    process.exit(1);
  }

  // Authentication tokens now persist across server restarts
  // Tokens are cached at: ~/.auth/mcp-gas/tokens/
  // To manually clear tokens: rm -rf ~/.auth/mcp-gas/tokens/
  console.error('✅ Token persistence enabled - credentials will survive server restarts');
  console.error(`📁 Token cache location: ${os.homedir()}/.auth/mcp-gas/tokens/`);

  // Cleanup stale locks from previous sessions
  const lockManager = LockManager.getInstance();
  await lockManager.cleanupStaleLocks();

  const server = new MCPGasServer();

  // MEMORY LEAK FIX: Store handler references for cleanup in long-running sessions
  const signalHandlers = new Map<string, (...args: any[]) => void>();

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    console.error(`\nReceived ${signal}, shutting down gracefully...`);

    // Release all held locks before shutdown
    await lockManager.releaseAllLocks();

    // MEMORY LEAK FIX: Remove all registered event listeners
    for (const [eventName, handler] of signalHandlers) {
      process.removeListener(eventName as any, handler);
    }
    signalHandlers.clear();

    try {
      await server.stop();
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  // Helper to register handlers with tracking (MEMORY LEAK FIX)
  const registerSignalHandler = (event: string, handler: (...args: any[]) => void) => {
    signalHandlers.set(event, handler);
    process.on(event as any, handler);
  };

  // Register signal handlers with tracking
  registerSignalHandler('SIGINT', () => shutdown('SIGINT'));
  registerSignalHandler('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught exceptions and unhandled rejections with tracking
  registerSignalHandler('uncaughtException', async (error: Error) => {
    console.error('Uncaught Exception:', error);
    await shutdown('uncaughtException');
  });

  registerSignalHandler('unhandledRejection', async (reason: any, promise: Promise<any>) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    await shutdown('unhandledRejection');
  });

  try {
    // Start the server
    await server.start();
  } catch (error) {
    console.error('Failed to start MCP Gas Server:', error);
    process.exit(1);
  }
}

// Only run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
} 
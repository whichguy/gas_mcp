#!/usr/bin/env node

import { MCPGasServer } from './server/mcpServer.js';
import { SessionAuthManager } from './auth/sessionManager.js';
import { McpGasConfigManager } from './config/mcpGasConfig.js';
import path from 'path';

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

  // FORCE CLEAR ALL CACHED TOKENS ON STARTUP (skip in test mode)
  if (process.env.MCP_TEST_MODE !== 'true') {
    console.error('🗑️  Clearing all cached authentication tokens (forced restart behavior)...');
    const clearedCount = SessionAuthManager.clearAllSessions();
    console.error(`✅ Cleared ${clearedCount} cached session(s) - fresh authentication required`);
  } else {
    console.error('🧪 Test mode: preserving cached authentication tokens');
  }

  const server = new MCPGasServer();

  // MEMORY LEAK FIX: Store handler references for cleanup in long-running sessions
  const signalHandlers = new Map<string, (...args: any[]) => void>();

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    console.error(`\nReceived ${signal}, shutting down gracefully...`);

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
  registerSignalHandler('uncaughtException', (error: Error) => {
    console.error('Uncaught Exception:', error);
    shutdown('uncaughtException');
  });

  registerSignalHandler('unhandledRejection', (reason: any, promise: Promise<any>) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    shutdown('unhandledRejection');
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
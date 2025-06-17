#!/usr/bin/env node

import { MCPGasServer } from './server/mcpServer.js';
import { SessionAuthManager } from './auth/sessionManager.js';

/**
 * Main entry point for MCP Gas Server
 */
async function main() {
  console.error('🚀 Starting MCP Gas Server with forced desktop authentication...');
  
  // FORCE CLEAR ALL CACHED TOKENS ON STARTUP
  console.error('🗑️  Clearing all cached authentication tokens (forced restart behavior)...');
  const clearedCount = SessionAuthManager.clearAllSessions();
  console.error(`✅ Cleared ${clearedCount} cached session(s) - fresh authentication required`);
  
  const server = new MCPGasServer();

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    console.error(`\nReceived ${signal}, shutting down gracefully...`);
    try {
      await server.stop();
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  // Register signal handlers
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught exceptions and unhandled rejections
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason, promise) => {
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
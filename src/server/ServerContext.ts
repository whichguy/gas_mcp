import { Server } from '@modelcontextprotocol/sdk/server/index.js';

/**
 * Singleton providing BaseTool access to the MCP Server instance.
 * Initialized once in mcpServer.ts after server creation.
 */
export class ServerContext {
  private static instance: ServerContext;
  public server: Server;

  private constructor(server: Server) {
    this.server = server;
  }

  static initialize(server: Server): void {
    ServerContext.instance = new ServerContext(server);
  }

  static getInstance(): ServerContext {
    if (!ServerContext.instance) {
      throw new Error('ServerContext not initialized. Call ServerContext.initialize(server) first.');
    }
    return ServerContext.instance;
  }

  static isInitialized(): boolean {
    return !!ServerContext.instance;
  }
}

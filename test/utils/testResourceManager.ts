import { MCPTestClient } from '../system/mcpClient.js';
import { createServer, Server } from 'http';

export interface ClientOptions {
  port?: number;
  sessionId?: string;
  mockMode?: boolean;
}

export class TestResourceManager {
  private static instance: TestResourceManager;
  private portRange = { min: 3001, max: 3999 };
  private allocatedPorts = new Set<number>();
  private testClients: MCPTestClient[] = [];
  private testServers: Server[] = [];

  private constructor() {}

  public static getInstance(): TestResourceManager {
    if (!TestResourceManager.instance) {
      TestResourceManager.instance = new TestResourceManager();
    }
    return TestResourceManager.instance;
  }

  /**
   * Allocate a random port for testing, avoiding common conflicts
   */
  allocatePort(): number {
    // Avoid common service ports and OAuth callback port
    const conflictPorts = [3000, 3001, 8080, 8081, 9000, 9001, 5000, 5001];
    const maxAttempts = 20;
    
    for (let i = 0; i < maxAttempts; i++) {
      const port = Math.floor(Math.random() * (65535 - 10000) + 10000);
      if (!conflictPorts.includes(port) && !this.allocatedPorts.has(port)) {
        this.allocatedPorts.add(port);
        console.log(`🔌 Allocated random port: ${port} (avoiding OAuth port 3000)`);
        return port;
      }
    }
    
    // Fallback to a higher range if we can't find a free port
    const fallbackPort = Math.floor(Math.random() * (60000 - 50000) + 50000);
    this.allocatedPorts.add(fallbackPort);
    console.log(`🔌 Allocated fallback port: ${fallbackPort} (avoiding OAuth port 3000)`);
    return fallbackPort;
  }

  /**
   * Release a previously allocated port
   */
  releasePort(port: number): void {
    this.allocatedPorts.delete(port);
    console.log(`🔌 Released port: ${port}`);
  }

  /**
   * Check if a port is free
   */
  private async isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer();
      let resolved = false;
      
      const cleanup = (result: boolean) => {
        if (!resolved) {
          resolved = true;
          server.close(() => resolve(result));
        }
      };
      
      // Set a timeout to avoid hanging
      const timeout = setTimeout(() => cleanup(false), 1000);
      
      server.listen(port, () => {
        clearTimeout(timeout);
        cleanup(true);
      });
      
      server.on('error', (err: any) => {
        clearTimeout(timeout);
        cleanup(false);
      });
    });
  }

  /**
   * Create an isolated test client with dedicated resources
   */
  async createIsolatedClient(options: ClientOptions = {}): Promise<MCPTestClient> {
    const client = new MCPTestClient();
    
    // Set up isolated environment
    const env = { ...process.env };
    env.MCP_TEST_MODE = 'true';
    env.NODE_ENV = 'test';
    
    if (options.port) {
      env.MCP_OAUTH_PORT = options.port.toString();
    }
    
    if (options.sessionId) {
      env.MCP_SESSION_ID = options.sessionId;
    }
    
    if (options.mockMode) {
      env.GAS_MOCK_AUTH = 'true';
    }
    
    await client.startAndConnect();
    this.testClients.push(client);
    
    return client;
  }

  /**
   * Clean up all allocated resources
   */
  async cleanupAllResources(): Promise<void> {
    // Disconnect all test clients
    const clientPromises = this.testClients.map(client => 
      client.disconnect().catch(err => 
        console.warn('Error disconnecting client:', err)
      )
    );
    
    await Promise.all(clientPromises);
    this.testClients = [];
    
    // Close all test servers
    const serverPromises = this.testServers.map(server => 
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      })
    );
    
    await Promise.all(serverPromises);
    this.testServers = [];
    
    // Release all ports
    this.allocatedPorts.clear();
  }

  /**
   * Get statistics about resource usage
   */
  getResourceStats(): {
    allocatedPorts: number[];
    activeClients: number;
    activeServers: number;
  } {
    return {
      allocatedPorts: Array.from(this.allocatedPorts),
      activeClients: this.testClients.length,
      activeServers: this.testServers.length
    };
  }
}

export const testResourceManager = TestResourceManager.getInstance(); 
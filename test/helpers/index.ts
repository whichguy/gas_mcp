/**
 * Centralized test helpers for MCP Gas test suite
 * Re-exports all test utilities from a single import
 */

// MCP Client helpers
export * from './mcpClient.js';
export * from './mcpTestHelpers.js';
export * from './mcpGasTestHelpers.js';

// Test utilities
export * from './testFactory.js';
export * from './assertions.js';
export * from './testResourceManager.js';

// Type definitions for test helpers
export interface TestConfig {
  timeout?: number;
  retries?: number;
  skipAuth?: boolean;
  useRealAPI?: boolean;
}

export interface MockProjectData {
  scriptId: string;
  title: string;
  files: Array<{
    name: string;
    type: 'SERVER_JS' | 'HTML' | 'JSON';
    source: string;
  }>;
}

export interface TestCredentials {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
}
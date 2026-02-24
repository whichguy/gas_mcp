/**
 * Shared Integration Test Setup
 *
 * This file provides a simple setup function that integration tests can
 * explicitly call in their before() hooks.
 *
 * KEY PRINCIPLE: ONE SERVER, ONE AUTH
 * - Global setup starts ONE MCP server for entire test suite
 * - Global setup authenticates ONCE with Google
 * - Server handles tokens internally
 * - All tests reuse the same authenticated server
 * - No per-test authentication or session management needed
 *
 * Usage in integration tests:
 * ```typescript
 * import { setupIntegrationTest, globalAuthState } from '../../setup/integrationSetup.js';
 *
 * describe('My Integration Test', () => {
 *   before(async function() {
 *     this.timeout(30000); // Reduced from 130s - no auth needed per test
 *     await setupIntegrationTest();
 *   });
 * });
 * ```
 */

import { globalAuthState, mochaHooks } from './globalAuth.js';
import { TestProjectManager } from '../helpers/testProjectManager.js';

// Track if setup has been called to prevent multiple initializations
let setupInProgress = false;
let setupComplete = false;
let setupPromise: Promise<void> | null = null;

/**
 * Setup function for integration tests
 * Call this in your test's before() hook
 *
 * This function ensures that the global server is started and authenticated.
 * After the first call, all subsequent calls just verify the server is ready.
 */
export async function setupIntegrationTest(): Promise<void> {
  // If already setup and authenticated, return immediately
  if (setupComplete && globalAuthState.isAuthenticated && globalAuthState.client) {
    console.log('✅ Using existing authenticated MCP server');
    return;
  }

  // If setup is in progress, wait for it to complete
  if (setupInProgress && setupPromise) {
    console.log('⏳ Server setup in progress, waiting...');
    await setupPromise;
    return;
  }

  // Mark setup as in progress and create the promise
  setupInProgress = true;
  setupPromise = (async () => {
    try {
      console.log('🚀 Initializing global MCP server (one-time setup)...');
      // Call the global auth setup - this starts the server and authenticates
      await mochaHooks.beforeAll.call({ timeout: (ms: number) => {} });
      setupComplete = true;
      console.log('✅ Global server ready - all tests will use this authenticated server');
    } catch (error) {
      setupInProgress = false;
      setupComplete = false;
      throw error;
    }
  })();

  await setupPromise;
}

/**
 * Teardown function for integration tests
 * Usually NOT needed - the global afterAll hook handles cleanup
 */
export async function teardownIntegrationTest(): Promise<void> {
  // Global afterAll hook will clean up the server
  // Don't call this unless you explicitly want to tear down mid-suite
}

/**
 * Check if integration tests should run
 * Returns true if server is authenticated and ready
 */
export function shouldRunIntegrationTests(): boolean {
  return globalAuthState.isAuthenticated && !!globalAuthState.client;
}

/**
 * Export global state for test access
 */
export { globalAuthState };

/**
 * Get the shared test project scriptId.
 * Throws if globalAuth setup has not run.
 */
export function getSharedProjectId(): string {
  const id = globalAuthState.sharedProjectId;
  if (!id) throw new Error('Shared test project not initialized — ensure globalAuth beforeAll ran');
  return id;
}

/**
 * Reset the shared test project to its infrastructure baseline.
 * Call this at the start of each integration test suite's before() hook.
 */
export async function resetSharedProject(): Promise<void> {
  if (!globalAuthState.client) {
    throw new Error('No client available — ensure globalAuth beforeAll ran');
  }
  await TestProjectManager.getInstance().resetToBaseline(globalAuthState.client);
}

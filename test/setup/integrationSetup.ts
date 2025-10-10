/**
 * Shared Integration Test Setup
 *
 * This file provides a simple setup function that integration tests can
 * explicitly call in their before() hooks. This approach is clearer than
 * mocha's "require" config option.
 *
 * Usage in integration tests:
 * ```typescript
 * import { setupIntegrationTest, teardownIntegrationTest } from '../../setup/integrationSetup.js';
 *
 * describe('My Integration Test', () => {
 *   before(async function() {
 *     this.timeout(130000);
 *     await setupIntegrationTest();
 *   });
 *
 *   after(async function() {
 *     await teardownIntegrationTest();
 *   });
 * });
 * ```
 */

import { globalAuthState, mochaHooks } from './globalAuth.js';

// Track if setup has been called to prevent multiple OAuth flows
let setupInProgress = false;
let setupComplete = false;
let setupPromise: Promise<void> | null = null;

/**
 * Setup function for integration tests
 * Call this in your test's before() hook
 *
 * This function ensures that authentication only happens ONCE, even if
 * multiple test files call it. All subsequent calls will wait for the
 * first setup to complete and reuse the same session.
 */
export async function setupIntegrationTest(): Promise<void> {
  // If already setup, return immediately
  if (setupComplete && globalAuthState.isAuthenticated && globalAuthState.client) {
    console.log('✅ Auth already initialized, reusing existing session');
    return;
  }

  // If setup is in progress, wait for it to complete
  if (setupInProgress && setupPromise) {
    console.log('⏳ Auth setup in progress, waiting...');
    await setupPromise;
    return;
  }

  // Mark setup as in progress and create the promise
  setupInProgress = true;
  setupPromise = (async () => {
    try {
      console.log('🔐 Starting one-time auth setup for all integration tests...');
      // Call the global auth setup
      await mochaHooks.beforeAll.call({ timeout: (ms: number) => {} });
      setupComplete = true;
      console.log('✅ Auth setup complete - all test files will share this session');
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
 * Call this in your test's after() hook (optional, usually not needed)
 */
export async function teardownIntegrationTest(): Promise<void> {
  // Usually we want to keep the session alive between test suites
  // Only call this if you explicitly want to tear down
  // await mochaHooks.afterAll();
}

/**
 * Check if integration tests should run
 * Returns true if authenticated, false otherwise
 */
export function shouldRunIntegrationTests(): boolean {
  return globalAuthState.isAuthenticated && !!globalAuthState.client;
}

/**
 * Export global state for test access
 */
export { globalAuthState };

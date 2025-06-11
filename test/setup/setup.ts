// This file is the single entry point for all test setup.
// It's referenced in .mocharc.json's "require" field.

import { mochaHooks } from './globalAuth.js';

// Export the hooks for Mocha to use.
// This ensures our global beforeAll and afterAll run for the entire test suite.
export { mochaHooks }; 
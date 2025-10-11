#!/usr/bin/env node

/**
 * Direct test of OAuth flow to verify browser launch
 */

import { auth } from './dist/src/tools/auth.js';

console.log('🔍 Testing OAuth browser launch directly...\n');

try {
    // Start auth with browser launch
    console.log('Calling auth with openBrowser=true, waitForCompletion=false\n');

    const result = await auth({
        mode: 'start',
        openBrowser: true,
        waitForCompletion: false  // Don't block, just see if browser launches
    });

    console.log('\n✅ Auth started successfully');
    console.log('Result:', JSON.stringify(result, null, 2));

} catch (error) {
    console.error('\n❌ Auth failed:', error.message);
    console.error('Error details:', error);
}

console.log('\nPress Ctrl+C to exit...');
// Keep process alive briefly to see output
setTimeout(() => process.exit(0), 5000);

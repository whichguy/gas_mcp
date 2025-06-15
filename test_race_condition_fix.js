#!/usr/bin/env node

/**
 * Test script for OAuth race condition fix
 * This tests that the callback server responds immediately when started
 */

import { GASAuthClient } from './dist/src/auth/oauthClient.js';

const config = {
  client_id: '428972970708-jtm1ou5838lv7vbjdv5kgp5222s7d8f0.apps.googleusercontent.com',
  type: 'uwp',
  redirect_uris: ['http://127.0.0.1/*', 'http://localhost/*'],
  scopes: [
    'https://www.googleapis.com/auth/script.projects',
    'https://www.googleapis.com/auth/script.processes',
    'https://www.googleapis.com/auth/script.deployments',
    'https://www.googleapis.com/auth/script.scriptapp'
  ]
};

async function testRaceConditionFix() {
  console.log('🧪 Testing OAuth race condition fix...');
  
  try {
    const authClient = new GASAuthClient(config);
    
    // Start auth flow (should set up server with handlers immediately)
    console.log('🚀 Starting auth flow...');
    const authUrl = await authClient.startAuthFlow(false); // Don't open browser
    
    console.log('✅ Auth flow started successfully');
    console.log('📍 Auth URL:', authUrl);
    
    // Extract the port from the auth URL
    const urlMatch = authUrl.match(/redirect_uri=http%3A%2F%2F127\.0\.0\.1%3A(\d+)%2Fcallback/);
    if (!urlMatch) {
      throw new Error('Could not extract port from auth URL');
    }
    
    const port = urlMatch[1];
    console.log(`🔍 OAuth server should be running on port ${port}`);
    
    // Test health endpoint immediately (this is where the race condition would show)
    console.log('🏥 Testing health endpoint...');
    
    const fetch = (await import('node-fetch')).default;
    
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        timeout: 5000
      });
      
      if (response.ok) {
        const healthData = await response.json();
        console.log('✅ Health endpoint responded:', healthData);
        console.log('🎉 Race condition fix SUCCESSFUL! Server responds immediately.');
      } else {
        console.error('❌ Health endpoint returned error:', response.status, response.statusText);
      }
    } catch (fetchError) {
      console.error('❌ Health endpoint request failed:', fetchError.message);
      console.error('💀 Race condition fix FAILED! Server not responding.');
    }
    
    // Clean up
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

testRaceConditionFix(); 
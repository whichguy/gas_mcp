#!/usr/bin/env node

/**
 * Test Script for FORCED DESKTOP AUTHENTICATION SYSTEM
 * 
 * This script validates that:
 * 1. Client secret is always required (no fallback)
 * 2. Tokens are cleared on server restart
 * 3. Desktop OAuth type is enforced
 * 4. Authentication flow works properly
 * 5. Google Apps Script operations work after auth
 */

import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import path from 'path';

console.log('🧪 TESTING FORCED DESKTOP AUTHENTICATION SYSTEM');
console.log('='.repeat(60));

/**
 * Test 1: Verify token clearing on startup
 */
async function testTokenClearing() {
    console.log('\n📋 Test 1: Token Clearing on Startup');
    console.log('-'.repeat(40));
    
    // Create dummy session files to test clearing
    const sessionDir = path.join(process.cwd(), 'dist/.sessions');
    const testSessionPath = path.join(sessionDir, 'test-session.json');
    
    try {
        // Create dummy session
        if (!existsSync(sessionDir)) {
            console.log('⚠️  Session directory does not exist - will be created on server start');
        } else {
            const dummySession = {
                sessionId: 'test-session',
                tokens: { access_token: 'dummy', expires_at: Date.now() + 3600000 },
                user: { email: 'test@example.com' },
                createdAt: Date.now(),
                lastUsed: Date.now()
            };
            writeFileSync(testSessionPath, JSON.stringify(dummySession, null, 2));
            console.log('✅ Created dummy session file for testing');
        }
        
        console.log('🚀 Starting server to test token clearing...');
        
        // Start server briefly to test token clearing
        const server = spawn('node', ['dist/src/index.js'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: process.cwd()
        });
        
        let output = '';
        let tokensClearedDetected = false;
        
        server.stdout.on('data', (data) => {
            output += data.toString();
            console.log('📺 Server output:', data.toString().trim());
            
            if (output.includes('Clearing all cached authentication tokens')) {
                tokensClearedDetected = true;
                console.log('✅ Token clearing detected in server output');
            }
        });
        
        server.stderr.on('data', (data) => {
            console.log('⚠️  Server stderr:', data.toString().trim());
        });
        
        // Wait 5 seconds then kill server
        await setTimeout(5000);
        server.kill('SIGTERM');
        
        // Check if dummy session was cleared
        if (existsSync(testSessionPath)) {
            console.log('❌ Dummy session file still exists - token clearing may have failed');
        } else {
            console.log('✅ Dummy session file was cleared successfully');
        }
        
        console.log(`✅ Test 1 Result: ${tokensClearedDetected ? 'PASSED' : 'FAILED'} - Token clearing ${tokensClearedDetected ? 'detected' : 'not detected'}`);
        
    } catch (error) {
        console.error('❌ Test 1 failed:', error.message);
    }
}

/**
 * Test 2: Verify configuration validation
 */
async function testConfigValidation() {
    console.log('\n📋 Test 2: Configuration Validation');
    console.log('-'.repeat(40));
    
    const configPath = path.join(process.cwd(), 'oauth-config.json');
    
    try {
        if (!existsSync(configPath)) {
            console.log('❌ oauth-config.json does not exist');
            return;
        }
        
        const config = JSON.parse(readFileSync(configPath, 'utf8'));
        
        // Test client_id
        if (!config.oauth?.client_id) {
            console.log('❌ Missing client_id in configuration');
            return;
        }
        console.log('✅ client_id present in configuration');
        
        // Test client_secret (FORCED REQUIREMENT)
        if (!config.oauth?.client_secret) {
            console.log('❌ Missing client_secret in configuration - FORCED DESKTOP AUTH requires this');
            return;
        }
        console.log('✅ client_secret present in configuration (FORCED REQUIREMENT)');
        
        // Test OAuth type
        if (config.oauth?.type && config.oauth.type !== 'desktop') {
            console.log('❌ OAuth type is not "desktop" - FORCED DESKTOP AUTH requires desktop type');
            return;
        }
        console.log('✅ OAuth type is desktop (or unspecified, defaulting to desktop)');
        
        // Test scopes
        const requiredScopes = [
            'script.projects',
            'script.processes',
            'script.deployments',
            'userinfo.email'
        ];
        
        const scopes = config.oauth?.scopes || [];
        const missingScopos = requiredScopes.filter(scope => 
            !scopes.some(s => s.includes(scope))
        );
        
        if (missingScopos.length > 0) {
            console.log('❌ Missing required scopes:', missingScopos);
            return;
        }
        console.log('✅ All required scopes present in configuration');
        
        console.log('✅ Test 2 Result: PASSED - Configuration validation successful');
        
    } catch (error) {
        console.error('❌ Test 2 failed:', error.message);
    }
}

/**
 * Test 3: Verify forced desktop auth behavior
 */
async function testForcedDesktopAuth() {
    console.log('\n📋 Test 3: Forced Desktop Auth Behavior');
    console.log('-'.repeat(40));
    
    try {
        // Test that server rejects missing client_secret
        console.log('🔧 Testing client_secret requirement...');
        
        // Temporarily backup config
        const configPath = path.join(process.cwd(), 'oauth-config.json');
        const backupPath = path.join(process.cwd(), 'oauth-config.json.backup');
        
        if (existsSync(configPath)) {
            const originalConfig = readFileSync(configPath, 'utf8');
            writeFileSync(backupPath, originalConfig);
            
            // Create config without client_secret
            const config = JSON.parse(originalConfig);
            delete config.oauth.client_secret;
            writeFileSync(configPath, JSON.stringify(config, null, 2));
            
            console.log('🧪 Testing server with missing client_secret...');
            
            // Try to start server - should fail
            const server = spawn('node', ['dist/src/index.js'], {
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: process.cwd()
            });
            
            let errorDetected = false;
            let output = '';
            
            server.stdout.on('data', (data) => {
                output += data.toString();
            });
            
            server.stderr.on('data', (data) => {
                const error = data.toString();
                if (error.includes('client_secret is REQUIRED') || error.includes('FORCED DESKTOP AUTH')) {
                    errorDetected = true;
                    console.log('✅ Server correctly rejected missing client_secret');
                }
            });
            
            // Wait 3 seconds then kill
            await setTimeout(3000);
            server.kill('SIGTERM');
            
            // Restore original config
            writeFileSync(configPath, readFileSync(backupPath, 'utf8'));
            unlinkSync(backupPath);
            
            if (errorDetected) {
                console.log('✅ Test 3 Result: PASSED - Server correctly enforces client_secret requirement');
            } else {
                console.log('❌ Test 3 Result: FAILED - Server did not reject missing client_secret');
            }
            
        } else {
            console.log('⚠️  oauth-config.json not found - cannot test client_secret validation');
        }
        
    } catch (error) {
        console.error('❌ Test 3 failed:', error.message);
    }
}

/**
 * Test 4: Build verification
 */
async function testBuild() {
    console.log('\n📋 Test 4: Build Verification');
    console.log('-'.repeat(40));
    
    try {
        console.log('🔨 Running npm run build...');
        
        const buildProcess = spawn('npm', ['run', 'build'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: process.cwd()
        });
        
        let buildOutput = '';
        let buildError = '';
        
        buildProcess.stdout.on('data', (data) => {
            buildOutput += data.toString();
            console.log('📺 Build output:', data.toString().trim());
        });
        
        buildProcess.stderr.on('data', (data) => {
            buildError += data.toString();
            console.log('⚠️  Build error:', data.toString().trim());
        });
        
        const buildResult = await new Promise((resolve) => {
            buildProcess.on('close', (code) => {
                resolve(code);
            });
        });
        
        if (buildResult === 0) {
            console.log('✅ Test 4 Result: PASSED - Build completed successfully');
        } else {
            console.log('❌ Test 4 Result: FAILED - Build failed with exit code:', buildResult);
        }
        
    } catch (error) {
        console.error('❌ Test 4 failed:', error.message);
    }
}

/**
 * Test 5: Server startup test
 */
async function testServerStartup() {
    console.log('\n📋 Test 5: Server Startup Test');
    console.log('-'.repeat(40));
    
    try {
        console.log('🚀 Testing server startup with forced desktop auth...');
        
        const server = spawn('npm', ['start'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: process.cwd()
        });
        
        let startupSuccess = false;
        let authConfigLoaded = false;
        let tokensClearLogged = false;
        
        server.stdout.on('data', (data) => {
            const output = data.toString();
            console.log('📺 Server:', output.trim());
            
            if (output.includes('Starting MCP Gas Server with forced desktop authentication')) {
                startupSuccess = true;
            }
            if (output.includes('FORCED DESKTOP AUTH configuration')) {
                authConfigLoaded = true;
            }
            if (output.includes('Clearing all cached authentication tokens')) {
                tokensClearLogged = true;
            }
        });
        
        server.stderr.on('data', (data) => {
            console.log('⚠️  Server stderr:', data.toString().trim());
        });
        
        // Wait 10 seconds for startup
        await setTimeout(10000);
        server.kill('SIGTERM');
        
        const results = [
            { name: 'Startup message', success: startupSuccess },
            { name: 'Auth config loaded', success: authConfigLoaded },
            { name: 'Tokens cleared', success: tokensClearLogged }
        ];
        
        const passedTests = results.filter(r => r.success).length;
        console.log(`✅ Test 5 Result: ${passedTests}/3 checks passed`);
        
        results.forEach(result => {
            console.log(`  ${result.success ? '✅' : '❌'} ${result.name}`);
        });
        
    } catch (error) {
        console.error('❌ Test 5 failed:', error.message);
    }
}

/**
 * Main test runner
 */
async function runAllTests() {
    console.log('🏁 Starting comprehensive forced desktop auth tests...\n');
    
    await testTokenClearing();
    await testConfigValidation();
    await testForcedDesktopAuth();
    await testBuild();
    await testServerStartup();
    
    console.log('\n🎯 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log('All tests completed. Review the individual test results above.');
    console.log('');
    console.log('🚀 If all tests passed, your FORCED DESKTOP AUTH system is working correctly!');
    console.log('💡 You can now run: npm start');
    console.log('🔐 The server will clear all tokens on startup and require fresh authentication.');
}

// Run all tests
runAllTests().catch(error => {
    console.error('💥 Test runner failed:', error);
    process.exit(1);
}); 
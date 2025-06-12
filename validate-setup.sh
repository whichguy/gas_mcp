#!/bin/bash

echo "🔍 MCP Google Apps Script Server - Setup Validation"
echo "================================================="

# Function to print status
print_status() {
    if [ $1 -eq 0 ]; then
        echo "✅ $2"
    else
        echo "❌ $2"
        echo "   Error: $3"
    fi
}

# Check Node.js version
echo
echo "📋 Prerequisites Check"
echo "---------------------"
node_version=$(node --version 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "✅ Node.js: $node_version"
else
    echo "❌ Node.js not found or not working"
    exit 1
fi

npm_version=$(npm --version 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "✅ npm: $npm_version"
else
    echo "❌ npm not found or not working"
    exit 1
fi

# Check if dependencies are installed
if [ -d "node_modules" ]; then
    echo "✅ Dependencies installed"
else
    echo "❌ Dependencies not installed - run 'npm install'"
    exit 1
fi

# Test build process
echo
echo "🏗️  Build Process Validation"
echo "----------------------------"

echo "Cleaning previous build..."
npm run clean > /dev/null 2>&1
print_status $? "Clean command executed" "npm run clean failed"

echo "Building project..."
npm run build > /dev/null 2>&1
print_status $? "TypeScript compilation" "npm run build failed"

# Check if dist directory exists with correct structure
if [ -d "dist/src" ]; then
    echo "✅ Compiled JavaScript files created"
else
    echo "❌ Compiled JavaScript files missing"
fi

if [ -d "dist/config" ]; then
    echo "✅ Config files copied to dist"
else
    echo "❌ Config files not copied to dist"
fi

# Check config file
echo
echo "⚙️  Configuration Validation"
echo "----------------------------"

if [ -f "config/oauth.json" ]; then
    echo "✅ OAuth config file exists"
    
    # Parse client_id and check if it's the test value
    client_id=$(node -e "
        try {
            const config = JSON.parse(require('fs').readFileSync('config/oauth.json'));
            console.log(config.oauth.client_id);
        } catch(e) {
            console.log('ERROR');
        }
    " 2>/dev/null)
    
    if [ "$client_id" = "test_client_id" ]; then
        echo "⚠️  Using test OAuth credentials (expected for initial setup)"
        echo "   📘 See CURSOR_INTEGRATION.md for real OAuth setup instructions"
    elif [ "$client_id" = "ERROR" ]; then
        echo "❌ OAuth config file has invalid JSON format"
    else
        echo "✅ OAuth config has real client_id configured"
    fi
else
    echo "❌ OAuth config file missing - run 'npm run setup'"
fi

# Test server startup (brief test)
echo
echo "🚀 Server Startup Test"
echo "----------------------"

echo "Testing server startup (3 second test)..."

# Create a test script to verify server startup
cat > test-startup.js << 'EOF'
import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

const server = spawn('node', ['dist/src/index.js'], {
    stdio: ['pipe', 'pipe', 'pipe']
});

let output = '';
let success = false;

server.stdout.on('data', (data) => {
    output += data.toString();
    if (output.includes('Auth tool loaded OAuth config')) {
        success = true;
        console.log('✅ Server starts and loads config successfully');
        server.kill();
        process.exit(0);
    }
});

server.stderr.on('data', (data) => {
    const error = data.toString();
    if (error.includes('ENOENT') && error.includes('oauth.json')) {
        console.log('❌ Server startup failed - config file not found in dist/');
        server.kill();
        process.exit(1);
    }
});

// Timeout after 5 seconds
setTimeout(5000).then(() => {
    if (!success) {
        console.log('❌ Server startup test timed out');
        server.kill();
        process.exit(1);
    }
});

// Send test data to prevent hanging on stdin
setTimeout(1000).then(() => {
    server.stdin.write('{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0"}}}\n');
});
EOF

node test-startup.js 2>/dev/null
startup_result=$?
rm -f test-startup.js

if [ $startup_result -eq 0 ]; then
    echo "✅ MCP server startup validation passed"
else
    echo "❌ MCP server startup validation failed"
fi

# Final summary
echo
echo "📊 Validation Summary"
echo "===================="

if [ -d "dist/src" ] && [ -d "dist/config" ] && [ -f "config/oauth.json" ]; then
    if [ "$client_id" = "test_client_id" ]; then
        echo "🟡 Setup partially complete - ready for OAuth configuration"
        echo
        echo "Next Steps:"
        echo "1. Follow 'Google OAuth Configuration' in CURSOR_INTEGRATION.md"
        echo "2. Configure Cursor MCP settings with this path:"
        echo "   $(pwd)"
        echo "3. Restart Cursor to load the MCP server"
    else
        echo "🟢 Setup complete - ready for Cursor integration!"
        echo
        echo "Next Steps:"
        echo "1. Configure Cursor MCP settings with this path:"
        echo "   $(pwd)"
        echo "2. Restart Cursor to load the MCP server"
    fi
else
    echo "🔴 Setup incomplete - fix the issues above"
fi

echo
echo "📚 Documentation:"
echo "   • Cursor Integration: ./CURSOR_INTEGRATION.md"
echo "   • Project Structure: ./REPOSITORY_STRUCTURE.md"
echo "   • Examples: ./examples/README.md"
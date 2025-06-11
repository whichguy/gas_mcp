#!/bin/bash

# MCP Gas Server Integration Test Runner
# This script runs comprehensive tests in the correct order for CI/CD environments

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
RUN_LIVE_TESTS=${GAS_INTEGRATION_TEST:-false}
VERBOSE=${MCP_TEST_VERBOSE:-false}
EXIT_CODE=0

echo -e "${BLUE}=== MCP Gas Server Integration Test Runner ===${NC}"
echo "Starting comprehensive test suite..."
echo ""

# Function to run a test command with proper error handling
run_test() {
    local test_name="$1"
    local test_command="$2"
    local required="$3"
    
    echo -e "${BLUE}Running: ${test_name}${NC}"
    
    if [ "$VERBOSE" = "true" ]; then
        echo "Command: $test_command"
    fi
    
    if eval "$test_command"; then
        echo -e "${GREEN}✓ ${test_name} passed${NC}"
        echo ""
    else
        echo -e "${RED}✗ ${test_name} failed${NC}"
        if [ "$required" = "true" ]; then
            echo -e "${RED}Required test failed. Stopping execution.${NC}"
            exit 1
        else
            echo -e "${YELLOW}Optional test failed. Continuing...${NC}"
            EXIT_CODE=1
        fi
        echo ""
    fi
}

# Build the project first
echo -e "${BLUE}Building project...${NC}"
if npm run build; then
    echo -e "${GREEN}✓ Build successful${NC}"
    echo ""
else
    echo -e "${RED}✗ Build failed${NC}"
    exit 1
fi

# 1. Unit Tests (Required)
echo -e "${YELLOW}=== Phase 1: Unit Tests ===${NC}"
run_test "Error Handling Tests" "npm run test -- test/errors/**/*.test.ts" true
run_test "Rate Limiter Tests" "npm run test -- test/api/rateLimiter.test.ts" true
run_test "Path Parser Tests" "npm run test -- test/api/pathParser.test.ts" true
run_test "Auth State Tests" "npm run test -- test/auth/authState.test.ts" true

# 2. System Tests - Basic (Required)
echo -e "${YELLOW}=== Phase 2: Basic System Tests ===${NC}"
run_test "MCP Protocol Compliance" "npm run test:system:basic" true

# 3. System Tests - Authentication (Required)
echo -e "${YELLOW}=== Phase 3: Authentication Tests ===${NC}"
run_test "OAuth Flow Tests" "npm run test:system:auth" true

# 4. Live Integration Tests (Optional)
echo -e "${YELLOW}=== Phase 4: Live Integration Tests ===${NC}"
if [ "$RUN_LIVE_TESTS" = "true" ]; then
    echo -e "${BLUE}Live integration tests enabled${NC}"
    echo -e "${YELLOW}Note: These tests require manual OAuth completion${NC}"
    
    # Check if we're in an interactive environment
    if [ -t 0 ]; then
        echo "Running in interactive mode - OAuth prompts will be displayed"
        run_test "Live Google Apps Script API Tests" "npm run test:system:live" false
    else
        echo -e "${YELLOW}Running in non-interactive mode - skipping live tests${NC}"
        echo "Set up automated OAuth tokens to run these tests in CI"
    fi
else
    echo -e "${YELLOW}Live integration tests disabled${NC}"
    echo "Set GAS_INTEGRATION_TEST=true to enable live Google Apps Script API testing"
fi

# 5. Summary
echo -e "${YELLOW}=== Test Summary ===${NC}"

if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}All tests completed successfully!${NC}"
    echo ""
    echo "Test Coverage:"
    echo "  ✓ Unit Tests (Error handling, Rate limiting, Path parsing, Auth state)"
    echo "  ✓ MCP Protocol Compliance"
    echo "  ✓ Authentication Flows"
    
    if [ "$RUN_LIVE_TESTS" = "true" ]; then
        echo "  ✓ Live Google Apps Script Integration"
    else
        echo "  - Live Google Apps Script Integration (disabled)"
    fi
    
    echo ""
    echo -e "${GREEN}🎉 MCP Gas Server is ready for production!${NC}"
else
    echo -e "${RED}Some tests failed or were skipped${NC}"
    echo ""
    echo "Check the output above for details."
    echo "All required tests must pass for production readiness."
fi

echo ""
echo "For detailed test documentation, see:"
echo "  - test/system/README.md"
echo "  - README.md"

exit $EXIT_CODE 
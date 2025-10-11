import { expect } from 'chai';
import { describe, it, before, after } from 'mocha';
import { InProcessTestClient, InProcessAuthHelper, InProcessGASTestHelper } from '../../helpers/inProcessClient.js';
import { globalAuthState } from '../../setup/globalAuth.js';
import { estimateTokenCount, filterLoggerOutput, protectResponseSize } from '../../../src/tools/execution/utilities/response-protection.js';

describe('Response Protection Integration Tests', () => {
  let client: InProcessTestClient;
  let auth: InProcessAuthHelper;
  let gas: InProcessGASTestHelper;
  let testProjects: string[] = [];

  before(function() {
    if (!globalAuthState.client || !globalAuthState.auth) {
      this.skip();
    }
    client = globalAuthState.client!;
    auth = globalAuthState.auth!;  // Reuse global auth with sessionId
    gas = globalAuthState.gas!;
    console.log('Using shared global MCP client for response protection integration tests');
  });

  after(async function() {
    for (const projectId of testProjects) {
      try {
        await gas.cleanupTestProject(projectId);
      } catch (error) {
        console.warn(`Failed to cleanup project ${projectId}:`, error);
      }
    }
    testProjects = [];
    console.log('Response protection integration tests completed');
  });

  describe('estimateTokenCount', () => {
    it('should estimate tokens for real exec responses', async function() {
      this.timeout(60000);

      const authStatus = await auth.getAuthStatus();
      if (!authStatus.authenticated) {
        this.skip();
      }

      // Create test project
      const projectName = `Token Estimation Test ${Date.now()}`;
      const project = await gas.createTestProject(projectName);
      testProjects.push(project.scriptId);

      // Write test code that returns various sized outputs
      const testCode = `
function smallOutput() {
  return "Hello World";
}

function mediumOutput() {
  const data = [];
  for (let i = 0; i < 100; i++) {
    data.push({ id: i, name: "Item " + i, value: Math.random() });
  }
  return data;
}

function largeOutput() {
  const data = [];
  for (let i = 0; i < 1000; i++) {
    data.push({
      id: i,
      name: "Item " + i,
      description: "This is a longer description for item " + i,
      value: Math.random(),
      timestamp: new Date().toISOString()
    });
  }
  return data;
}
`;

      await gas.writeTestFile(project.scriptId, 'tokenTest.gs', testCode);

      // Test small output
      const smallResult = await client.callAndParse('exec', {
        scriptId: project.scriptId,
        js_statement: 'smallOutput()',
        autoRedeploy: true
      });

      const smallJson = JSON.stringify(smallResult);
      const smallTokens = estimateTokenCount(smallJson);

      expect(smallTokens).to.be.a('number');
      expect(smallTokens).to.be.greaterThan(0);
      expect(smallTokens).to.be.lessThan(1000);
      console.log(`Small output: ${smallJson.length} chars → ${smallTokens} tokens`);

      // Test medium output
      const mediumResult = await client.callAndParse('exec', {
        scriptId: project.scriptId,
        js_statement: 'mediumOutput()',
        autoRedeploy: true
      });

      const mediumJson = JSON.stringify(mediumResult);
      const mediumTokens = estimateTokenCount(mediumJson);

      expect(mediumTokens).to.be.greaterThan(smallTokens);
      expect(mediumTokens).to.be.lessThan(10000);
      console.log(`Medium output: ${mediumJson.length} chars → ${mediumTokens} tokens`);

      // Test large output
      const largeResult = await client.callAndParse('exec', {
        scriptId: project.scriptId,
        js_statement: 'largeOutput()',
        autoRedeploy: true
      });

      const largeJson = JSON.stringify(largeResult);
      const largeTokens = estimateTokenCount(largeJson);

      expect(largeTokens).to.be.greaterThan(mediumTokens);
      console.log(`Large output: ${largeJson.length} chars → ${largeTokens} tokens`);

      console.log('Token estimation validated with real exec responses');
    });
  });

  describe('filterLoggerOutput', () => {
    it('should filter real Logger.log output with regex patterns', async function() {
      this.timeout(60000);

      const authStatus = await auth.getAuthStatus();
      if (!authStatus.authenticated) {
        this.skip();
      }

      // Create test project
      const projectName = `Logger Filter Test ${Date.now()}`;
      const project = await gas.createTestProject(projectName);
      testProjects.push(project.scriptId);

      // Write test code with extensive logging
      const testCode = `
function testLogging() {
  Logger.log("INFO: Starting test");
  Logger.log("DEBUG: Processing item 1");
  Logger.log("DEBUG: Processing item 2");
  Logger.log("WARNING: Potential issue detected");
  Logger.log("DEBUG: Processing item 3");
  Logger.log("ERROR: Failed to process item");
  Logger.log("INFO: Test completed");

  return { status: "completed", items: 3 };
}
`;

      await gas.writeTestFile(project.scriptId, 'loggerTest.gs', testCode);

      // Execute and get logger output
      const result = await client.callAndParse('exec', {
        scriptId: project.scriptId,
        js_statement: 'testLogging()',
        autoRedeploy: true
      });

      const loggerOutput = result.logger_output || '';
      expect(loggerOutput).to.include('INFO');
      expect(loggerOutput).to.include('DEBUG');
      expect(loggerOutput).to.include('ERROR');

      // Test regex filtering - only ERROR messages
      const errorFiltered = filterLoggerOutput(loggerOutput, 'ERROR');
      expect(errorFiltered.filteredOutput).to.include('ERROR');
      expect(errorFiltered.filteredOutput).to.not.include('DEBUG');
      expect(errorFiltered.metadata).to.include('Filtered');
      console.log('ERROR filter:', errorFiltered.metadata.trim());

      // Test regex filtering - INFO or WARNING
      const infoWarningFiltered = filterLoggerOutput(loggerOutput, 'INFO|WARNING');
      expect(infoWarningFiltered.filteredOutput).to.include('INFO');
      expect(infoWarningFiltered.filteredOutput).to.include('WARNING');
      expect(infoWarningFiltered.filteredOutput).to.not.include('DEBUG');
      console.log('INFO|WARNING filter:', infoWarningFiltered.metadata.trim());

      // Test tail filtering - last 2 lines
      const tailFiltered = filterLoggerOutput(loggerOutput, undefined, 2);
      const lines = tailFiltered.filteredOutput.split('\n').filter(l => l.trim());
      expect(lines.length).to.be.at.most(2);
      expect(tailFiltered.metadata).to.include('last 2');
      console.log('Tail filter:', tailFiltered.metadata.trim());

      // Test combined filtering - ERROR messages, last 1
      const combinedFiltered = filterLoggerOutput(loggerOutput, 'ERROR', 1);
      expect(combinedFiltered.filteredOutput).to.include('ERROR');
      expect(combinedFiltered.metadata).to.include('Filtered');
      expect(combinedFiltered.metadata).to.include('last 1');
      console.log('Combined filter:', combinedFiltered.metadata.trim());

      console.log('Logger output filtering validated with real exec output');
    });
  });

  describe('protectResponseSize', () => {
    it('should handle real responses within token limits', async function() {
      this.timeout(60000);

      const authStatus = await auth.getAuthStatus();
      if (!authStatus.authenticated) {
        this.skip();
      }

      // Create test project
      const projectName = `Response Protection Test ${Date.now()}`;
      const project = await gas.createTestProject(projectName);
      testProjects.push(project.scriptId);

      // Write test code with small output
      const testCode = `
function normalOutput() {
  Logger.log("Processing started");
  const result = { status: "success", count: 42 };
  Logger.log("Processing completed");
  return result;
}
`;

      await gas.writeTestFile(project.scriptId, 'protectionTest.gs', testCode);

      // Execute
      const result = await client.callAndParse('exec', {
        scriptId: project.scriptId,
        js_statement: 'normalOutput()',
        autoRedeploy: true
      });

      // Protect response (should pass through unchanged)
      const protected1 = protectResponseSize(result, 22000);

      expect(protected1.status).to.equal('success');
      expect(protected1.result).to.deep.equal(result.result);
      expect(protected1.logger_output).to.equal(result.logger_output);
      expect(protected1.logger_output).to.not.include('LOGGER TRUNCATED');

      console.log('Small response passed through unchanged');

      // Test with artificially low limit to trigger truncation
      const protected2 = protectResponseSize(result, 100); // Very low limit

      // Should have truncated logger output
      if (protected2.logger_output && protected2.logger_output.length > 0) {
        expect(protected2.logger_output).to.include('LOGGER TRUNCATED');
        console.log('Low limit triggered truncation as expected');
      }
    });

    it('should truncate real large logger outputs when over limit', async function() {
      this.timeout(90000);

      const authStatus = await auth.getAuthStatus();
      if (!authStatus.authenticated) {
        this.skip();
      }

      // Create test project
      const projectName = `Large Logger Test ${Date.now()}`;
      const project = await gas.createTestProject(projectName);
      testProjects.push(project.scriptId);

      // Write test code with extensive logging
      const testCode = `
function verboseLogging() {
  for (let i = 0; i < 500; i++) {
    Logger.log("Processing iteration " + i + " with detailed information about the operation including timestamps, status codes, and metadata");
  }
  return { status: "completed", iterations: 500 };
}
`;

      await gas.writeTestFile(project.scriptId, 'verboseTest.gs', testCode);

      // Execute - should generate large logger output
      const result = await client.callAndParse('exec', {
        scriptId: project.scriptId,
        js_statement: 'verboseLogging()',
        autoRedeploy: true
      });

      const originalSize = JSON.stringify(result).length;
      const originalTokens = estimateTokenCount(JSON.stringify(result));

      console.log(`Original response: ${originalSize} chars, ${originalTokens} tokens`);

      // Test with moderate limit that should trigger truncation
      const protectedResult = protectResponseSize(result, 5000);

      const protectedSize = JSON.stringify(protectedResult).length;
      const protectedTokens = estimateTokenCount(JSON.stringify(protectedResult));

      console.log(`Protected response: ${protectedSize} chars, ${protectedTokens} tokens`);

      // Should be smaller
      expect(protectedTokens).to.be.lessThan(originalTokens);

      // Should have truncation message
      if (protectedResult.logger_output) {
        expect(protectedResult.logger_output).to.include('LOGGER TRUNCATED');
      }

      // Should preserve result
      expect(protectedResult.result).to.deep.equal(result.result);
      expect(protectedResult.status).to.equal('completed');

      console.log('Large logger output successfully truncated while preserving result');
    });
  });

  describe('end-to-end protection flow', () => {
    it('should integrate all protection utilities in real execution flow', async function() {
      this.timeout(90000);

      const authStatus = await auth.getAuthStatus();
      if (!authStatus.authenticated) {
        this.skip();
      }

      // Create test project
      const projectName = `E2E Protection Test ${Date.now()}`;
      const project = await gas.createTestProject(projectName);
      testProjects.push(project.scriptId);

      // Write test code with mixed output
      const testCode = `
function complexExecution() {
  Logger.log("TRACE: Execution started");
  Logger.log("DEBUG: Loading configuration");
  Logger.log("INFO: Processing 100 items");

  for (let i = 0; i < 100; i++) {
    if (i % 10 === 0) {
      Logger.log("INFO: Progress " + i + "%");
    }
    Logger.log("TRACE: Processing item " + i);
  }

  Logger.log("WARNING: Some items required retry");
  Logger.log("INFO: Execution completed successfully");

  return {
    status: "success",
    processed: 100,
    warnings: 1,
    timestamp: new Date().toISOString()
  };
}
`;

      await gas.writeTestFile(project.scriptId, 'e2eTest.gs', testCode);

      // Execute
      const rawResult = await client.callAndParse('exec', {
        scriptId: project.scriptId,
        js_statement: 'complexExecution()',
        autoRedeploy: true
      });

      // Step 1: Estimate tokens
      const rawTokens = estimateTokenCount(JSON.stringify(rawResult));
      console.log(`Raw response: ${rawTokens} tokens`);

      // Step 2: Filter logger (only INFO and WARNING)
      const filtered = filterLoggerOutput(
        rawResult.logger_output || '',
        'INFO|WARNING',
        undefined
      );
      console.log(`Filtered logger: ${filtered.metadata.trim()}`);

      // Step 3: Apply filtered output to response
      const filteredResult = {
        ...rawResult,
        logger_output: filtered.filteredOutput + filtered.metadata
      };

      // Step 4: Protect response size
      const finalResult = protectResponseSize(filteredResult, 10000);
      const finalTokens = estimateTokenCount(JSON.stringify(finalResult));

      console.log(`Final response: ${finalTokens} tokens`);

      // Verify end-to-end flow
      expect(finalResult.status).to.equal('success');
      expect(finalResult.result.processed).to.equal(100);
      expect(finalTokens).to.be.lessThanOrEqual(10000);

      // Should not have TRACE messages (filtered out)
      expect(finalResult.logger_output).to.not.include('TRACE');

      // Should have INFO/WARNING messages
      expect(finalResult.logger_output).to.include('INFO');

      console.log('End-to-end protection flow validated successfully');
    });
  });
});

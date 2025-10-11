import { expect } from 'chai';
import { describe, it, before, after } from 'mocha';
import { globalAuthState } from '../../setup/globalAuth.js';

/**
 * Real GAS Operations Tests
 *
 * Uses a SINGLE test project for all tests to avoid domain authorization delays.
 * Tests verify end-to-end functionality of:
 * - Project creation with CommonJS infrastructure
 * - Code execution via exec tool
 * - Module system (require/exports)
 * - File operations
 */
describe('Real GAS Operations - End-to-End Tests', () => {
  let testProjectId: string | null = null;

  before(async function() {
    this.timeout(600000); // 10 minutes for setup (includes project creation time)

    if (!globalAuthState.isAuthenticated) {
      console.log('⚠️  Skipping real GAS operations - not authenticated');
      this.skip();
      return;
    }

    console.log('\n🎯 Creating single test project for all tests...');

    const project = await globalAuthState.gas!.createTestProject('Real GAS E2E Test ' + Date.now());
    testProjectId = project.scriptId;

    console.log(`✅ Created test project: ${testProjectId}`);
    console.log(`   All tests will use this same project`);
  });

  after(async function() {
    if (testProjectId) {
      console.log(`\n⚠️  Manual cleanup required for test project: ${testProjectId}`);
      console.log(`   Visit: https://script.google.com/home to delete`);
    }
  });

  describe('Project Setup Verification', () => {
    it('should have CommonJS infrastructure', async function() {
      this.timeout(30000);

      const files = await globalAuthState.gas!.listFiles(testProjectId!);
      const fileNames = files.map((f: any) => f.name);

      console.log(`📋 Files found in project: ${JSON.stringify(fileNames)}`);

      expect(fileNames).to.include('CommonJS');
      // Check for .git file which is created by project_create
      const hasGitFile = fileNames.some((name: string) => name.includes('git'));
      expect(hasGitFile).to.be.true;
      console.log(`✅ CommonJS infrastructure verified (found ${fileNames.length} files)`);
    });
  });

  describe('Basic Code Execution', () => {
    it('should execute simple JavaScript expressions', async function() {
      this.timeout(600000); // 10 minutes - first exec needs domain auth in browser

      console.log('\n🧮 Testing simple expression execution...');

      const result = await globalAuthState.gas!.runFunction(testProjectId!, 'Math.PI * 2');

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.be.closeTo(6.283185, 0.0001);
      console.log(`✅ Executed: Math.PI * 2 = ${result.result}`);
    });

    it('should execute complex expressions', async function() {
      this.timeout(120000);

      console.log('\n🧪 Testing complex JavaScript...');

      const result = await globalAuthState.gas!.runFunction(
        testProjectId!,
        '[1,2,3,4,5].reduce((sum, n) => sum + n, 0)'
      );

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.equal(15);
      console.log('✅ Array reduction: [1,2,3,4,5] sum = 15');
    });

    it('should capture Logger.log output', async function() {
      this.timeout(120000);

      console.log('\n📝 Testing Logger.log capture...');

      const result = await globalAuthState.gas!.runFunction(
        testProjectId!,
        'Logger.log("Test message"); return 42;'
      );

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.equal(42);
      expect(result.logger_output).to.include('Test message');
      console.log('✅ Logger.log captured successfully');
    });
  });

  describe('File Operations', () => {
    it('should write and read files', async function() {
      this.timeout(90000);

      console.log('\n📝 Testing file write/read...');

      const testCode = 'function hello() { return "world"; }';
      await globalAuthState.gas!.writeTestFile(testProjectId!, 'hello.gs', testCode);
      console.log('✅ File written');

      const content = await globalAuthState.gas!.readFile(testProjectId!, 'hello');
      expect(content).to.include('hello');
      expect(content).to.include('world');
      console.log('✅ File read successfully');
    });

    it('should list files in project', async function() {
      this.timeout(60000);

      console.log('\n📋 Testing file listing...');

      await globalAuthState.gas!.writeTestFile(testProjectId!, 'file1.gs', '// Test 1');
      await globalAuthState.gas!.writeTestFile(testProjectId!, 'file2.gs', '// Test 2');

      const files = await globalAuthState.gas!.listFiles(testProjectId!);
      expect(files.length).to.be.at.least(5); // CommonJS + __mcp_gas_run + hello + file1 + file2
      console.log(`✅ Listed ${files.length} files`);
    });
  });

  describe('Module System Integration', () => {
    it('should execute module functions via require()', async function() {
      this.timeout(120000);

      console.log('\n📦 Testing module system...');

      // Write a simple module
      await globalAuthState.gas!.writeTestFile(
        testProjectId!,
        'Calculator.gs',
        'function add(a, b) { return a + b; }\n' +
        'function multiply(a, b) { return a * b; }\n' +
        'module.exports = { add, multiply };'
      );
      console.log('✅ Created Calculator module');

      // Execute using require()
      const result = await globalAuthState.gas!.runFunction(
        testProjectId!,
        'const calc = require("Calculator"); return calc.add(5, 7);'
      );

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.equal(12);
      console.log('✅ Module require() works: 5 + 7 = 12');
    });

    it('should handle multiple module functions', async function() {
      this.timeout(120000);

      console.log('\n📦 Testing multiple module functions...');

      const result = await globalAuthState.gas!.runFunction(
        testProjectId!,
        `const calc = require("Calculator");
         const sum = calc.add(10, 20);
         const product = calc.multiply(5, 6);
         Logger.log("Sum: " + sum);
         Logger.log("Product: " + product);
         return { sum: sum, product: product };`
      );

      expect(result).to.have.property('status', 'success');
      expect(result.result).to.deep.equal({ sum: 30, product: 30 });
      expect(result.logger_output).to.include('Sum: 30');
      expect(result.logger_output).to.include('Product: 30');
      console.log('✅ Multiple module functions work');
    });
  });
});

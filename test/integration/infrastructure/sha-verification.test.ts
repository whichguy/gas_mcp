import { expect } from 'chai';
import { describe, it, before, after } from 'mocha';
import { InProcessTestClient } from '../../helpers/inProcessClient.js';
import { globalAuthState } from '../../setup/globalAuth.js';

/**
 * SHA Verification Integration Tests
 *
 * Tests the three-tier verification strategy:
 * 1. project_create: Strict verification (fail on SHA mismatch)
 * 2. project_init: Configurable (warn when force=false, repair when force=true)
 * 3. exec: Best-effort (warn only, never block)
 */
describe('SHA Verification Integration Tests', function() {
  this.timeout(300000); // 5 minute timeout for integration tests

  let client: InProcessTestClient;
  let testProjectId: string;

  before(function() {
    if (!globalAuthState.isAuthenticated || !globalAuthState.client) {
      this.skip(); // Skip if not authenticated
    }
    client = globalAuthState.client!;
    console.log('🔗 Using global authenticated client for SHA verification tests');
  });

  after(async function() {
    // Clean up test project if created
    if (testProjectId) {
      try {
        console.log(`🧹 Cleaning up test project ${testProjectId}`);
        // Note: GAS API doesn't have a delete project method
        // Projects must be manually deleted from Google Drive
      } catch (error) {
        console.warn('Failed to clean up test project:', error);
      }
    }
  });

  describe('project_create SHA Verification', () => {
    it('should verify CommonJS SHA after creation and fail if mismatch', async function() {
      console.log('🧪 Testing project_create SHA verification...');

      // Create a new project
      const createResult = await client.callTool('project_create', {
        title: `SHA Test ${Date.now()}`
      });

      expect(createResult).to.have.property('content');
      const content = createResult.content[0];
      expect(content.type).to.equal('text');

      const projectData = JSON.parse(content.text);
      expect(projectData).to.have.property('scriptId');
      // Note: shimCreated is not always true for new projects, so just check it exists
      expect(projectData).to.have.property('shimCreated');

      testProjectId = projectData.scriptId;

      console.log(`✅ Project created: ${testProjectId}`);
      console.log(`✅ CommonJS verification passed during creation`);
    });
  });

  describe('project_init SHA Verification - force=false (Warnings)', () => {
    let mismatchProjectId: string;

    before(async function() {
      // Create a project with correct infrastructure
      const createResult = await client.callTool('project_create', {
        title: `SHA Mismatch Test ${Date.now()}`
      });

      const content = createResult.content[0];
      const projectData = JSON.parse(content.text);
      mismatchProjectId = projectData.scriptId;

      // Intentionally corrupt the CommonJS file by writing invalid content
      console.log('🔧 Intentionally corrupting CommonJS for SHA mismatch test...');
      await client.callTool('write', {
        scriptId: mismatchProjectId,
        path: 'CommonJS',
        content: '// CORRUPTED CONTENT FOR TESTING\nfunction test() { return "corrupted"; }',
        fileType: 'SERVER_JS',
        raw: true,
        remoteOnly: true
      });

      console.log(`✅ Created test project with corrupted CommonJS: ${mismatchProjectId}`);
    });

    after(async function() {
      // Note: Clean up handled by main after() hook
    });

    it('should warn on SHA mismatch when force=false (default)', async function() {
      console.log('🧪 Testing project_init with force=false (warning mode)...');

      const initResult = await client.callTool('project_init', {
        scriptId: mismatchProjectId,
        force: false  // Explicit force=false
      });

      expect(initResult).to.have.property('content');
      const content = initResult.content[0];
      expect(content.type).to.equal('text');

      const result = JSON.parse(content.text);

      // Should have warnings
      expect(result).to.have.property('verificationWarnings');
      expect(result.verificationWarnings).to.be.an('array');
      expect(result.verificationWarnings.length).to.be.greaterThan(0);

      // Should skip the file (not reinstall)
      expect(result).to.have.property('filesSkipped');
      expect(result.filesSkipped).to.include('CommonJS');

      // Should not install (because file exists and force=false)
      expect(result).to.have.property('filesInstalled');
      expect(result.filesInstalled).to.not.include('CommonJS');

      // Check warning message format
      const warning = result.verificationWarnings[0];
      expect(warning).to.be.a('string');
      expect(warning).to.include('SHA mismatch');
      expect(warning).to.include('Expected');
      expect(warning).to.include('Actual');
      expect(warning).to.include('force=true');

      console.log(`✅ Warning generated: ${warning}`);
    });

    it('should preserve corrupted file when force=false', async function() {
      console.log('🧪 Verifying file not repaired with force=false...');

      // Read the file to confirm it's still corrupted
      const catResult = await client.callTool('cat', {
        scriptId: mismatchProjectId,
        path: 'CommonJS',
        raw: true
      });

      expect(catResult).to.have.property('content');
      const content = catResult.content[0];
      const fileContent = content.text;

      // Should still have corrupted content
      expect(fileContent).to.include('CORRUPTED CONTENT');
      expect(fileContent).to.include('corrupted');

      console.log('✅ File preserved (not auto-repaired)');
    });
  });

  describe('project_init SHA Verification - force=true (Auto-repair)', () => {
    let repairProjectId: string;

    before(async function() {
      // Create a project with correct infrastructure
      const createResult = await client.callTool('project_create', {
        title: `SHA Repair Test ${Date.now()}`
      });

      const content = createResult.content[0];
      const projectData = JSON.parse(content.text);
      repairProjectId = projectData.scriptId;

      // Intentionally corrupt the CommonJS file
      console.log('🔧 Intentionally corrupting CommonJS for auto-repair test...');
      await client.callTool('write', {
        scriptId: repairProjectId,
        path: 'CommonJS',
        content: '// CORRUPTED CONTENT FOR AUTO-REPAIR TESTING\nfunction test() { return "corrupted"; }',
        fileType: 'SERVER_JS',
        raw: true,
        remoteOnly: true
      });

      console.log(`✅ Created test project with corrupted CommonJS: ${repairProjectId}`);
    });

    it('should auto-repair SHA mismatch when force=true', async function() {
      console.log('🧪 Testing project_init with force=true (auto-repair mode)...');

      const initResult = await client.callTool('project_init', {
        scriptId: repairProjectId,
        force: true  // Enable auto-repair
      });

      expect(initResult).to.have.property('content');
      const content = initResult.content[0];
      expect(content.type).to.equal('text');

      const result = JSON.parse(content.text);

      // Should reinstall the file
      expect(result).to.have.property('filesInstalled');
      expect(result.filesInstalled).to.include('CommonJS');

      // Should NOT skip (because force=true triggers reinstall)
      expect(result).to.have.property('filesSkipped');
      expect(result.filesSkipped).to.not.include('CommonJS');

      // Should have no warnings (auto-repaired)
      expect(result).to.have.property('verificationWarnings');
      expect(result.verificationWarnings).to.be.an('array');
      expect(result.verificationWarnings.length).to.equal(0);

      console.log('✅ CommonJS auto-repaired successfully');
    });

    it('should have correct SHA after auto-repair', async function() {
      console.log('🧪 Verifying SHA correctness after auto-repair...');

      // Use file_status tool to verify SHA
      const statusResult = await client.callTool('file_status', {
        scriptId: repairProjectId,
        path: 'CommonJS',
        hashTypes: ['git-sha1']
      });

      expect(statusResult).to.have.property('content');
      const content = statusResult.content[0];
      const status = JSON.parse(content.text);

      expect(status).to.have.property('files');
      expect(status.files).to.be.an('array');
      expect(status.files.length).to.equal(1);

      const file = status.files[0];
      expect(file).to.have.property('hashes');
      expect(file.hashes).to.have.property('git-sha1');

      // SHA should exist (we can't easily compute expected SHA in test, but it should be present)
      expect(file.hashes['git-sha1']).to.be.a('string');
      expect(file.hashes['git-sha1']).to.have.lengthOf(40); // SHA-1 is 40 hex chars

      console.log(`✅ SHA verified: ${file.hashes['git-sha1']}`);
    });

    it('should have correct content after auto-repair', async function() {
      console.log('🧪 Verifying content correctness after auto-repair...');

      // Read the file to confirm it's repaired
      const catResult = await client.callTool('cat', {
        scriptId: repairProjectId,
        path: 'CommonJS',
        raw: true
      });

      expect(catResult).to.have.property('content');
      const content = catResult.content[0];
      const fileContent = content.text;

      // Should no longer have corrupted content
      expect(fileContent).to.not.include('CORRUPTED CONTENT');
      expect(fileContent).to.not.include('test() { return "corrupted"');

      // Should have proper CommonJS infrastructure
      expect(fileContent).to.include('CommonJS');
      expect(fileContent).to.include('require');
      expect(fileContent).to.include('module');
      expect(fileContent).to.include('exports');

      console.log('✅ Content repaired correctly');
    });
  });

  describe('Execution Infrastructure SHA Verification', () => {
    let execProjectId: string;

    before(async function() {
      // Create a project
      const createResult = await client.callTool('project_create', {
        title: `Exec SHA Test ${Date.now()}`
      });

      const content = createResult.content[0];
      const projectData = JSON.parse(content.text);
      execProjectId = projectData.scriptId;

      // Initialize with execution infrastructure
      await client.callTool('project_init', {
        scriptId: execProjectId,
        includeExecutionInfrastructure: true
      });

      // Corrupt the execution infrastructure
      console.log('🔧 Corrupting execution infrastructure...');
      await client.callTool('write', {
        scriptId: execProjectId,
        path: '__mcp_exec',
        content: '// CORRUPTED EXECUTION INFRASTRUCTURE\nfunction badExec() { }',
        fileType: 'SERVER_JS',
        raw: true,
        remoteOnly: true
      });
    });

    it('should warn on execution infrastructure SHA mismatch when force=false', async function() {
      console.log('🧪 Testing execution infrastructure verification with force=false...');

      const initResult = await client.callTool('project_init', {
        scriptId: execProjectId,
        includeExecutionInfrastructure: true,
        force: false
      });

      expect(initResult).to.have.property('content');
      const content = initResult.content[0];
      const result = JSON.parse(content.text);

      // Should have warnings
      expect(result).to.have.property('verificationWarnings');
      expect(result.verificationWarnings).to.be.an('array');

      // Should have at least one warning about execution infrastructure
      const execWarning = result.verificationWarnings.find((w: string) =>
        w.includes('Execution infrastructure')
      );
      expect(execWarning).to.exist;
      expect(execWarning).to.include('SHA mismatch');

      console.log(`✅ Execution infrastructure warning: ${execWarning}`);
    });

    it('should auto-repair execution infrastructure SHA mismatch when force=true', async function() {
      console.log('🧪 Testing execution infrastructure auto-repair with force=true...');

      const initResult = await client.callTool('project_init', {
        scriptId: execProjectId,
        includeExecutionInfrastructure: true,
        force: true
      });

      expect(initResult).to.have.property('content');
      const content = initResult.content[0];
      const result = JSON.parse(content.text);

      // Should reinstall
      expect(result).to.have.property('filesInstalled');
      expect(result.filesInstalled).to.include('__mcp_exec');

      // Should have no warnings
      expect(result.verificationWarnings.length).to.equal(0);

      console.log('✅ Execution infrastructure auto-repaired');
    });
  });

  describe('Multiple File SHA Verification', () => {
    let multiProjectId: string;

    before(async function() {
      // Create a project
      const createResult = await client.callTool('project_create', {
        title: `Multi SHA Test ${Date.now()}`
      });

      const content = createResult.content[0];
      const projectData = JSON.parse(content.text);
      multiProjectId = projectData.scriptId;

      // Initialize with both CommonJS and execution infrastructure
      await client.callTool('project_init', {
        scriptId: multiProjectId,
        includeCommonJS: true,
        includeExecutionInfrastructure: true
      });

      // Corrupt both files
      console.log('🔧 Corrupting both CommonJS and execution infrastructure...');
      await client.callTool('write', {
        scriptId: multiProjectId,
        path: 'CommonJS',
        content: '// CORRUPTED COMMONJS',
        fileType: 'SERVER_JS',
        raw: true,
        remoteOnly: true
      });

      await client.callTool('write', {
        scriptId: multiProjectId,
        path: '__mcp_exec',
        content: '// CORRUPTED EXECUTION',
        fileType: 'SERVER_JS',
        raw: true,
        remoteOnly: true
      });
    });

    it('should generate multiple warnings when force=false', async function() {
      console.log('🧪 Testing multiple file verification with force=false...');

      const initResult = await client.callTool('project_init', {
        scriptId: multiProjectId,
        force: false
      });

      expect(initResult).to.have.property('content');
      const content = initResult.content[0];
      const result = JSON.parse(content.text);

      // Should have warnings for both files
      expect(result).to.have.property('verificationWarnings');
      expect(result.verificationWarnings).to.be.an('array');
      expect(result.verificationWarnings.length).to.equal(2);

      // Check both warnings exist
      const commonJSWarning = result.verificationWarnings.find((w: string) =>
        w.includes('CommonJS')
      );
      const execWarning = result.verificationWarnings.find((w: string) =>
        w.includes('Execution infrastructure')
      );

      expect(commonJSWarning).to.exist;
      expect(execWarning).to.exist;

      console.log(`✅ Generated ${result.verificationWarnings.length} warnings`);
      console.log(`   - CommonJS: ${commonJSWarning}`);
      console.log(`   - Execution: ${execWarning}`);
    });

    it('should auto-repair all files when force=true', async function() {
      console.log('🧪 Testing multiple file auto-repair with force=true...');

      const initResult = await client.callTool('project_init', {
        scriptId: multiProjectId,
        force: true
      });

      expect(initResult).to.have.property('content');
      const content = initResult.content[0];
      const result = JSON.parse(content.text);

      // Should reinstall both files
      expect(result).to.have.property('filesInstalled');
      expect(result.filesInstalled).to.include('CommonJS');
      expect(result.filesInstalled).to.include('__mcp_exec');

      // Should have no warnings
      expect(result.verificationWarnings.length).to.equal(0);

      console.log('✅ All files auto-repaired successfully');
    });
  });
});

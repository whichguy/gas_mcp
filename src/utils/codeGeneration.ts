/**
 * Consolidated code generation utilities for Google Apps Script
 * Replaces duplicate functions from gasClient.ts and execution.ts
 * 
 * This utility consolidates:
 * - GASClient.generateMcpGasRunClass() (87 lines) -> System with built-in execution
 * - GASRunTool.getProxyFunctionCode() (140 lines) -> Web app proxy
 * 
 * Architecture: Self-contained system with dynamic execution
 * - __mcp_gas_run: System shim ONLY - never modified after creation
 * - User code: Separate .gs files (e.g., Code.gs, UserFunctions.gs)
 * - Dynamic code execution via Function constructor
 */

import { GASFile } from '../api/gasClient.js';
import * as fs from 'fs';
import * as path from 'path';

export interface ProxyCodeOptions {
  type: 'head_deployment' | 'execution_api';
  userCode?: string;
  timezone?: string;
  includeTestFunctions?: boolean;
  mcpVersion?: string;
  responseFormat?: 'structured' | 'legacy';
}

export interface CodeGenerationResult {
  files: GASFile[];
  totalLines: number;
  description: string;
}

/**
 * Simple template reader that reads template content from src directory
 * @param templateName - The template filename (e.g., '__mcp_gas_run.js', 'CommonJS.js')
 * @returns Template content as string
 */
function getTemplate(templateName: string): string {
  try {
    // Get the directory of this file - when compiled, this will be in dist/src/utils/
    const currentDir = path.dirname(new URL(import.meta.url).pathname);
    
    // Determine if we're running from compiled code (dist/) or source code (src/)
    let srcDir: string;
    if (currentDir.includes('/dist/')) {
      // Running from compiled code: dist/src/utils -> go up to project root, then to src
      const projectRoot = currentDir.replace(/\/dist\/.*$/, '');
      srcDir = path.join(projectRoot, 'src');
    } else {
      // Running from source code: src/utils -> go up to src
      srcDir = path.join(currentDir, '..');
    }
    
    const templatePath = path.join(srcDir, templateName);
    
    return fs.readFileSync(templatePath, 'utf8');
  } catch (error) {
    throw new Error(`Template ${templateName} not found: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Comprehensive code generation for Google Apps Script projects
 * Supports multiple deployment types and user code integration
 */
export class CodeGenerator {
  /**
   * Generate complete GAS project files based on options
   * @param options - Configuration for code generation
   * @returns Generated files with metadata
   */
  static generateProjectFiles(options: ProxyCodeOptions): CodeGenerationResult {
    const { 
      type, 
      userCode = '', 
      timezone = 'America/New_York', 
      includeTestFunctions = false,
      mcpVersion = '1.3.3',
      responseFormat = 'structured'
    } = options;

    const files: GASFile[] = [];
    let totalLines = 0;

    // Always include the MCP system file
    const mcpSystemContent = this.generateMcpClassFile(timezone, mcpVersion);
    files.push({
      name: '__mcp_gas_run',
      type: 'SERVER_JS',
      source: mcpSystemContent
    });
    totalLines += mcpSystemContent.split('\n').length;

    // Always include the CommonJS module system
    const shimContent = this.generateShimFile();
    files.push({
      name: 'CommonJS',
      type: 'SERVER_JS', 
      source: shimContent
    });
    totalLines += shimContent.split('\n').length;

    // Add user code if provided
    if (userCode.trim()) {
      files.push({
        name: 'Code',
        type: 'SERVER_JS',
        source: userCode
      });
      totalLines += userCode.split('\n').length;
    }

    // Add test functions if requested
    if (includeTestFunctions) {
      const testContent = this.generateTestFunctions();
      files.push({
        name: 'TestFunctions',
        type: 'SERVER_JS',
        source: testContent
      });
      totalLines += testContent.split('\n').length;
    }

    return {
      files,
      totalLines,
      description: `Generated ${files.length} files for ${type} deployment (${totalLines} total lines)`
    };
  }

  /**
   * Generate the main MCP system file
   * Contains:
   * - doGet/doPost handlers for web app endpoints
   * - Built-in __gas_run function for dynamic code execution
   * - System exception handler (__mcp_handleMcpException)
   * - Uses Function constructor for runtime code execution
   * - ALL USER CODE MUST BE IN SEPARATE .GS FILES
   */
  private static generateMcpClassFile(timezone: string, mcpVersion: string): string {
    return getTemplate('__mcp_gas_run.js');
  }

  /**
   * Generate the CommonJS module system file
   * Contains the module loading and require() system
   */
  private static generateShimFile(): string {
    return getTemplate('CommonJS.js');
  }

  /**
   * Generate test functions for debugging and validation
   */
  private static generateTestFunctions(): string {
    return `
/**
 * Test functions for MCP Gas integration
 * These functions help validate the system is working correctly
 */

function testBasicExecution() {
  return "Basic execution test passed";
}

function testMathOperations() {
  return {
    addition: 2 + 3,
    multiplication: 4 * 5,
    timestamp: new Date().toISOString()
  };
}

function testLoggerCapture() {
  Logger.log("Test log message 1");
  Logger.log("Test log message 2");
  return "Logger test completed";
}
`.trim();
  }

  /**
   * Utility method to get available generation types
   * Helpful for documentation and validation
   */
  static getAvailableTypes(): string[] {
    return ['head_deployment', 'execution_api'];
  }

  /**
   * Get template content by name (for external use)
   */
  static getTemplateContent(templateName: string): string {
    return getTemplate(templateName);
  }
} 
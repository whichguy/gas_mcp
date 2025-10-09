/**
 * Helper utilities for testing MCP tool arguments
 */

import { expect } from 'chai';
import { MCPTestClient } from '../../../helpers/mcpClient.js';

export class ArgumentTestHelper {
  /**
   * Test that a tool call succeeds with given arguments
   */
  static async expectSuccess(
    client: MCPTestClient,
    toolName: string,
    args: any,
    message?: string
  ): Promise<any> {
    try {
      const result = await client.callAndParse(toolName, args);
      return result;
    } catch (error: any) {
      expect.fail(`Expected success but got error: ${error.message}${message ? ` (${message})` : ''}`);
    }
  }

  /**
   * Test that a tool call fails with expected error pattern
   */
  static async expectError(
    client: MCPTestClient,
    toolName: string,
    args: any,
    errorPattern: RegExp | string,
    message?: string
  ): Promise<void> {
    try {
      await client.callAndParse(toolName, args);
      expect.fail(`Expected error matching ${errorPattern} but call succeeded${message ? ` (${message})` : ''}`);
    } catch (error: any) {
      if (typeof errorPattern === 'string') {
        expect(error.message).to.include(errorPattern, message);
      } else {
        expect(error.message).to.match(errorPattern, message);
      }
    }
  }

  /**
   * Test multiple invalid arguments against a tool
   */
  static async testInvalidArguments(
    client: MCPTestClient,
    toolName: string,
    invalidCases: Array<{
      args: any;
      expectedError: RegExp | string;
      description: string;
    }>
  ): Promise<void> {
    for (const testCase of invalidCases) {
      await this.expectError(
        client,
        toolName,
        testCase.args,
        testCase.expectedError,
        testCase.description
      );
    }
  }

  /**
   * Test multiple valid arguments against a tool
   */
  static async testValidArguments(
    client: MCPTestClient,
    toolName: string,
    validCases: Array<{
      args: any;
      description: string;
      validator?: (result: any) => void;
    }>
  ): Promise<void> {
    for (const testCase of validCases) {
      const result = await this.expectSuccess(
        client,
        toolName,
        testCase.args,
        testCase.description
      );

      if (testCase.validator) {
        testCase.validator(result);
      }
    }
  }

  /**
   * Generate a valid 44-character scriptId for testing
   */
  static generateValidScriptId(): string {
    return '1234567890123456789012345678901234567890abcd';
  }

  /**
   * Generate invalid scriptId examples
   */
  static getInvalidScriptIds(): string[] {
    return [
      'too_short',
      '12345',
      'contains spaces here',
      'way_too_long_' + 'x'.repeat(100),
      'special!chars@here#',
      ''
    ];
  }

  /**
   * Generate path traversal examples
   */
  static getPathTraversalExamples(): string[] {
    return [
      '../escape',
      '../../etc',
      'project/../escape',
      '/absolute/path',
      'project//double-slash'
    ];
  }

  /**
   * Generate valid path examples
   */
  static getValidPaths(): string[] {
    return [
      'test',
      'test-file',
      'test_file',
      'test.file',
      'test123',
      'lib/utils',
      'api/v1/client'
    ];
  }

  /**
   * Sleep utility for delays
   */
  static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

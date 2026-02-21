/**
 * Context-aware hint generators for exec operations
 *
 * Following the sheet_sql pattern of generating hints based on actual results
 * to provide LLM-friendly guidance for next steps and troubleshooting.
 */

import type { InfrastructureStatus } from '../types/infrastructureTypes.js';

export interface ExecHints {
  context?: string;
  suggestions?: string[];
  warning?: string;
  nextSteps?: string[];
  performance?: string;
  debugging?: string[];
}

/**
 * Generate hints based on exec execution results
 */
export function generateExecHints(
  status: 'success' | 'error',
  jsStatement: string,
  result: any,
  loggerOutput: string,
  executionTimeMs?: number,
  outputWrittenToFile?: boolean,
  environment?: 'dev' | 'staging' | 'prod'
): ExecHints {
  const hints: ExecHints = {};

  // Success case hints
  if (status === 'success') {
    // Large output written to file
    if (outputWrittenToFile) {
      hints.context = 'Large response written to file (>8KB)';
      hints.nextSteps = [
        'Use Read tool to access full result from outputFile path',
        'Consider filtering result in js_statement to reduce output size',
        'Use logTail parameter to limit logger_output lines'
      ];
    }

    // No logger output when using require()
    if (jsStatement.includes('require(') && (!loggerOutput || !loggerOutput.trim())) {
      hints.debugging = hints.debugging || [];
      hints.debugging.push(
        'No logs captured. Enable module logging: setModuleLogging("ModuleName", true)',
        'Or use "*" pattern to log all modules: setModuleLogging("*", true)'
      );
    }

    // Check for empty result
    if (result === null || result === undefined) {
      hints.context = hints.context || 'Function returned null/undefined';
      hints.suggestions = hints.suggestions || [];
      hints.suggestions.push('Verify the function returns a value');
      hints.suggestions.push('Check logger_output for any logged data');
    }

    // Large array result
    if (Array.isArray(result) && result.length > 100) {
      hints.warning = `Large array result (${result.length} items)`;
      hints.suggestions = hints.suggestions || [];
      hints.suggestions.push('Consider paginating or filtering in js_statement');
      hints.suggestions.push('Use .slice(0, N) to limit results');
    }

    // Successful GAS API call hints
    if (jsStatement.includes('SpreadsheetApp')) {
      hints.nextSteps = hints.nextSteps || [];
      hints.nextSteps.push('Use sheet_sql for complex spreadsheet queries');
    }

    // Performance hints
    if (executionTimeMs && executionTimeMs > 30000) {
      hints.performance = `Execution took ${Math.round(executionTimeMs / 1000)}s`;
      hints.suggestions = hints.suggestions || [];
      hints.suggestions.push('Consider breaking into smaller operations');
      hints.suggestions.push('Use Logger.log() checkpoints to identify slow sections');
    }
  }

  // Error case hints
  if (status === 'error') {
    const errorStr = typeof result === 'string' ? result : JSON.stringify(result || '');

    // Reference error - common module/function not found
    if (errorStr.includes('ReferenceError')) {
      hints.context = 'Function or variable not found';
      hints.suggestions = [
        'Check function/variable name spelling',
        'For modules: use require("ModuleName").functionName()',
        'Verify file is deployed: ls({scriptId}) to check files'
      ];
      hints.debugging = [
        'Enable module logging: setModuleLogging("*", true)',
        'Check file order: require.gs must be first'
      ];
    }

    // Syntax error
    else if (errorStr.includes('SyntaxError')) {
      hints.context = 'JavaScript syntax error';
      hints.suggestions = [
        'Check for missing brackets, quotes, or semicolons',
        'Verify string escaping in js_statement',
        'For complex code, write to a module file and require() it'
      ];
    }

    // Type error
    else if (errorStr.includes('TypeError')) {
      hints.context = 'Type mismatch or null/undefined access';
      hints.suggestions = [
        'Check if object exists before accessing properties',
        'Verify function parameters are correct types',
        'Use optional chaining: obj?.property'
      ];
    }

    // Module not found
    else if (errorStr.includes('Cannot find module') || errorStr.includes('Factory not found')) {
      hints.context = 'CommonJS module not found';
      hints.suggestions = [
        'Verify module file exists: ls({scriptId})',
        'Check module name spelling (case-sensitive)',
        'Ensure module exports functions: module.exports = { fn }'
      ];
      hints.debugging = [
        'setModuleLogging("*", true) to see module loading',
        'Check require.gs is in position 0'
      ];
    }

    // Permission/quota errors
    else if (errorStr.includes('quota') || errorStr.includes('limit')) {
      hints.context = 'GAS quota or limit reached';
      hints.suggestions = [
        'Wait and retry for temporary quotas',
        'Reduce batch size for bulk operations',
        'Check GAS quotas: https://developers.google.com/apps-script/guides/services/quotas'
      ];
    }

    // Authorization errors
    else if (errorStr.includes('Authorization') || errorStr.includes('permission')) {
      hints.context = 'Authorization or permission error';
      hints.suggestions = [
        'Check OAuth scopes in appsscript.json',
        'Re-authorize: auth(mode="start")',
        'Verify script has access to the resource'
      ];
    }

    // Timeout
    else if (errorStr.includes('timeout') || errorStr.includes('Timeout')) {
      hints.context = 'Execution timeout';
      hints.suggestions = [
        'Increase executionTimeout parameter (max 3600s)',
        'Break into smaller operations',
        'Use triggers for long-running tasks'
      ];
      hints.performance = 'GAS has 6-minute limit for web apps, 30-minute for triggers';
    }

    // AutoRedeploy disabled
    else if (errorStr.includes('AutoRedeployDisabled')) {
      hints.context = 'autoRedeploy is disabled and deployment may need setup';
      hints.suggestions = [
        'Set autoRedeploy:true to auto-configure infrastructure',
        'Or manually deploy: deploy_config({operation:"reset", scriptId})'
      ];
    }

    // HTML instead of JSON
    else if (errorStr.includes('HTML') || errorStr.includes('DOCTYPE')) {
      hints.context = 'Web app returned HTML instead of JSON';
      hints.suggestions = [
        'Deployment may not be ready - retry in a few seconds',
        'Check __mcp_exec shim is installed correctly',
        'Use autoRedeploy:true to reset infrastructure'
      ];
    }

    // Generic error with logger output
    if (loggerOutput && loggerOutput.trim()) {
      hints.debugging = hints.debugging || [];
      hints.debugging.push('Review logger_output for additional context');
    }

    // Always suggest checking IDE for errors
    hints.nextSteps = hints.nextSteps || [];
    hints.nextSteps.push('Check ide_url_hint in response to view script in browser');
  }

  // Environment-specific hints
  if (environment === 'prod' && status === 'error') {
    hints.warning = 'Error in production environment';
    hints.suggestions = hints.suggestions || [];
    hints.suggestions.push('Test in dev environment first: environment:"dev"');
    hints.suggestions.push('Check staging version before promoting to prod');
  }

  return hints;
}

/**
 * Generate hints for CommonJS module-specific issues
 */
export function generateModuleHints(
  errorType: string,
  moduleName?: string,
  functionName?: string
): ExecHints {
  const hints: ExecHints = {};

  switch (errorType) {
    case 'module_not_found':
      hints.context = `Module "${moduleName}" not found`;
      hints.suggestions = [
        `Verify file exists: ls({scriptId})`,
        `Check module name spelling (case-sensitive)`,
        `Ensure module.exports is defined in the file`
      ];
      hints.debugging = [
        'setModuleLogging("*", true) to see all module loading',
        'Check require.gs is in position 0 in file order'
      ];
      break;

    case 'function_not_exported':
      hints.context = `Function "${functionName}" not exported from module`;
      hints.suggestions = [
        `Add to exports: module.exports.${functionName} = ${functionName}`,
        `Or: exports.${functionName} = ${functionName}`,
        `Check spelling matches exactly`
      ];
      break;

    case 'circular_dependency':
      hints.context = 'Circular dependency detected';
      hints.suggestions = [
        'Run deps({scriptId, analysisType:"circular"}) to find cycles',
        'Refactor to break the circular reference',
        'Consider lazy require() inside functions'
      ];
      break;

    case 'load_order':
      hints.context = 'File load order issue';
      hints.suggestions = [
        'require.gs must be first file (position 0)',
        '__mcp_exec should be early in order',
        'Use reorder({scriptId}) to fix file positions'
      ];
      hints.debugging = [
        'ls({scriptId}) shows current file order',
        'Check require.gs loadNow:true setting'
      ];
      break;
  }

  return hints;
}

/**
 * Merge multiple hint objects (same as searchHints)
 */
export function mergeExecHints(...hintObjects: ExecHints[]): ExecHints {
  const merged: ExecHints = {};

  for (const hints of hintObjects) {
    if (hints.context) {
      merged.context = merged.context ? `${merged.context} | ${hints.context}` : hints.context;
    }
    if (hints.warning) {
      merged.warning = merged.warning ? `${merged.warning}; ${hints.warning}` : hints.warning;
    }
    if (hints.performance) {
      merged.performance = hints.performance;
    }
    if (hints.suggestions) {
      merged.suggestions = merged.suggestions || [];
      merged.suggestions.push(...hints.suggestions);
    }
    if (hints.nextSteps) {
      merged.nextSteps = merged.nextSteps || [];
      merged.nextSteps.push(...hints.nextSteps);
    }
    if (hints.debugging) {
      merged.debugging = merged.debugging || [];
      merged.debugging.push(...hints.debugging);
    }
  }

  // Deduplicate arrays
  if (merged.suggestions) {
    merged.suggestions = [...new Set(merged.suggestions)];
  }
  if (merged.nextSteps) {
    merged.nextSteps = [...new Set(merged.nextSteps)];
  }
  if (merged.debugging) {
    merged.debugging = [...new Set(merged.debugging)];
  }

  return merged;
}

/**
 * Generate hints for infrastructure sync issues
 *
 * When infrastructure files (like __mcp_exec) are out of sync with MCP server templates,
 * provides actionable guidance on how to update them.
 *
 * @param infraStatus - Infrastructure verification status from setup
 * @param scriptId - Script project ID (for command suggestions)
 * @returns ExecHints with remediation guidance
 */
export function generateInfrastructureHints(
  infraStatus: InfrastructureStatus | undefined,
  scriptId: string
): ExecHints {
  if (!infraStatus || infraStatus.inSync) {
    return {}; // No hints needed
  }

  const hints: ExecHints = {};
  const shim = infraStatus.execShim;

  hints.context = '__mcp_exec infrastructure file metadata mismatch (does not affect this execution)';

  if (shim.error) {
    hints.warning = `Infrastructure verification failed: ${shim.error}`;
  } else {
    hints.warning = `Infrastructure metadata: __mcp_exec cached SHA differs from remote (expected ${shim.expectedSHA?.slice(0, 12) || 'unknown'}..., got ${shim.actualSHA?.slice(0, 12) || 'unknown'}...)`;
  }

  hints.suggestions = [
    '__mcp_exec local metadata hash differs from remote — execution still works, but infrastructure may be outdated',
    'To update: cat({scriptId, path:"__mcp_exec"}) or project_init({scriptId, force:true})',
    'This is a metadata-only check — your code execution result above is valid regardless'
  ];

  hints.nextSteps = [
    `Sync local cache: cat({scriptId:"${scriptId}", path:"${shim.file}"}) to pull remote and update local hash`,
    `Or full sync: rsync({scriptId:"${scriptId}", direction:"pull"}) to pull all remote files to local`,
    `Or force reinstall: project_init({scriptId:"${scriptId}", force:true}) to reinstall from MCP template`
  ];

  hints.debugging = [
    `File: ${shim.file}`,
    `Expected SHA: ${shim.expectedSHA || 'unknown'}`,
    `Actual SHA: ${shim.actualSHA || 'unknown'}`,
    `Verify with: file_status({scriptId:"${scriptId}", path:"${shim.file}", hashTypes:["git-sha1"]})`
  ];

  return hints;
}

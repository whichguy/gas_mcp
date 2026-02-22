// ExecTool: ad-hoc JS execution in GAS runtime with Logger capture
import { BaseTool } from '../base.js';
import { GASClient } from '../../api/gasClient.js';
import { ValidationError, GASApiError, AuthenticationError, SyncDriftError } from '../../errors/mcpErrors.js';
import { SessionAuthManager } from '../../auth/sessionManager.js';
import { CodeGenerator } from '../../utils/codeGeneration.js';
import { GASFile } from '../../api/gasClient.js';
import { ProjectResolver, ProjectParam } from '../../utils/projectResolver.js';
import { getSuccessHtmlTemplate, getErrorHtmlTemplate } from '../project-lifecycle.js';
import { SchemaFragments } from '../../utils/schemaFragments.js';
import { checkSyncStatus, type DriftDetails, type FileSyncStatus } from '../../utils/syncStatusChecker.js';
import { DiffGenerator, generateFolderDiff } from '../../utils/diffGenerator.js';
import type { DriftFileInfo } from '../../errors/mcpErrors.js';
import type { CollisionInfo, StaleFile } from '../../types/collisionTypes.js';
import { buildMultiFileCollision, NO_COLLISIONS } from '../../types/collisionTypes.js';
import { fileNameMatches } from '../../api/pathParser.js';
import { validateCommonJSOrdering, formatCommonJSOrderingIssues } from '../../utils/validation.js';
import { generateExecHints, generateInfrastructureHints, mergeExecHints, ExecHints } from '../../utils/execHints.js';

import type { InfrastructureStatus } from '../../types/infrastructureTypes.js';
import { mcpLogger } from '../../utils/mcpLogger.js';
import open from 'open';

// Import extracted utilities
import {
  estimateTokenCount,
  filterLoggerOutput,
  protectResponseSize
} from './utilities/response-protection.js';
import { ensureManifestEntryPoints } from './utilities/manifest-config.js';
import { setupInfrastructure } from './infrastructure/setup-manager.js';
import { performDomainAuth } from './auth/domain-auth.js';

// Import output file manager
import { wrapLargeResponse } from './outputFileManager.js';

// Import response formatters
import { buildExecErrorResponse, getStackSafe } from './execResponseFormatter.js';

/**
 * Execute functions via doGet() proxy pattern with JSON response handling and automatic deployment
 *
 * AUTOMATIC DEPLOYMENT BEHAVIOR:
 * - AUTOMATICALLY CREATES fresh web app deployment by default when autoRedeploy=true
 * - Creates new version with latest code changes before deployment
 * - Creates new web app deployment for each execution to ensure latest code
 * - autoRedeploy=true (default): Always creates NEW VERSION + NEW DEPLOYMENT
 * - autoRedeploy=false: Uses existing deployment only (requires manual deployment)
 *
 *  AUTOMATIC SHIM CODE CREATION:
 * - This tool AUTOMATICALLY creates __mcp_exec shim code if missing
 * - Provides dynamic code execution via Function constructor
 * - Enables execution of any JavaScript expression (e.g., fib(13), Math.PI * 2)
 * - Shim is added before deployment for zero-setup dynamic execution
 *
 * WEB APP DEPLOYMENT BY DEFAULT:
 * - Creates web app deployments by default for doGet() proxy pattern
 * - Web app deployments support HTTP-based function execution
 * - Uses 'MYSELF' access level for secure authenticated execution
 * - Automatically configures proper entry points and access controls
 *
 * FUNCTION EXECUTION PATTERN:
 * - This tool calls doGet() which handles dynamic JavaScript execution
 * - The target function/expression is executed via Function constructor
 * - Supports both function calls and JavaScript expressions
 * - Returns structured JSON responses with execution results
 *
 * This tool provides zero-setup dynamic JavaScript execution with automatic infrastructure setup.
 * Perfect for web app scenarios with proper JSON serialization and fresh deployment guarantee.
 *
 * Note: This is the primary exec implementation that creates fresh deployments. An alternative
 * implementation (GASHeadDeployTool) exists that checks for existing web app deployments first
 * and uses the most recent version, creating new ones only if none exist.
 *
 * Requirements:
 * - Script project will be auto-deployed as Web App by default
 * - Execution shim (__mcp_exec) will be auto-added if missing
 * - Returns JSON responses that can be properly dehydrated/rehydrated
 * - Must have script.scriptapp OAuth scope
 */
export class ExecTool extends BaseTool {
  public name = 'exec';
  public description = '[EXEC] Execute any JavaScript statement in a GAS project — supports Math, Date, all GAS services (SpreadsheetApp, DriveApp, etc.), and require() for CommonJS modules. WHEN: running ad-hoc code, testing expressions, or calling module functions. AVOID: use exec_api for calling existing module functions; exec for ad-hoc code and multi-service operations. Example: exec({scriptId, js_statement: "require(\'Utils\').process([1,2,3])"})';

  public outputSchema = {
    type: 'object' as const,
    properties: {
      success: { type: 'boolean', description: 'Whether execution succeeded' },
      result: { description: 'Execution return value' },
      logger_output: { type: 'string', description: 'Captured Logger.log() output' },
      execution_type: { type: 'string', description: 'How the code was executed' }
    }
  };

  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      environment: {
        type: 'string',
        enum: ['dev', 'staging', 'prod'],
        description: 'Execution environment (default: dev). dev=HEAD (latest), staging=snapshot, prod=stable.',
        default: 'dev'
      },
      js_statement: {
        type: 'string',
        description: 'JavaScript to execute in GAS. Supports: ES6+ expressions, require("Module").func() for project code, all GAS services (DriveApp/SpreadsheetApp/etc), Logger.log() auto-captured. CommonJS resolves dependencies automatically.',
        minLength: 1,
        examples: [
          'Math.PI * 2',
          'require("Utils").myFunc()',
          'DriveApp.createFile("x","y").getId()',
          'GmailApp.sendEmail("user@example.com", "Subject", "Body")'
        ]
      },
      autoRedeploy: {
        type: 'boolean',
        description: 'Auto-deploy setup. true (default)=create as needed, false=use existing, "force"=always new. Set false for speed on pre-configured projects.',
        default: true
      },
      executionTimeout: {
        type: 'number',
        description: 'Max execution timeout in seconds (default: 780=13min, max: 3600=1hr). Increase for long-running ops.',
        default: 780,
        minimum: 780,
        maximum: 3600
      },
      responseTimeout: {
        type: 'number',
        description: 'Max response timeout in seconds (default: 780=13min, max: 3600=1hr). Increase for large payloads.',
        default: 780,
        minimum: 780,
        maximum: 3600
      },
      ...SchemaFragments.accessToken,
      logFilter: {
        type: 'string',
        description: 'Optional regex to filter logger_output lines (ripgrep-style). Only matching lines included. Unspecified=all output.',
        examples: [
          'ERROR|WARN',           // Show only error/warning lines
          '^\\[.*\\]',             // Lines starting with brackets
          'TODO|FIXME',           // Show TODO/FIXME comments
          'result.*:',            // Lines with "result" followed by colon
        ]
      },
      logTail: {
        type: 'number',
        description: 'Optional: Return last N lines of logger_output. Useful for overwhelming logs. Applied after logFilter.',
        minimum: 1,
        maximum: 10000,
        examples: [10, 50, 100]
      },
      skipSyncCheck: {
        type: 'boolean',
        description: 'Bypass pre-flight sync check that detects local vs remote drift. Default: false. Set true to execute even if local files are stale.',
        default: false,
        examples: [true, false]
      },
    },
    required: ['scriptId', 'js_statement'],
    additionalProperties: false,
    llmGuidance: {
      moduleLogging: 'setModuleLogging(pattern,enabled) | getModuleLogging() | listLoggingEnabled() | clearModuleLogging(). Patterns: "*"=all | "auth/*"=folder. Check logger_output.',
      configManager: 'require("common-js/ConfigManager"); new CM("APP").get(key,default). Scopes: userDoc>document>user>domain>script. Deploy stores DEV_URL/STAGING_URL/PROD_URL.',
      response: 'Check status: "success"→result, "error"→error object. Errors: ExecutionError|EXECUTION_ERROR|AutoRedeployDisabled|TimeoutError. Stack: dev=full, staging/prod=hidden. >8KB auto-writes to /tmp file.',
      troubleshooting: 'Test: exec({scriptId, js_statement:"2*3"}). Check logger_output for "[DEFINE]","[ERROR]","Factory not found". Causes: missing loadNow:true, circular deps, syntax error, file order, typo in require().',
      htmlValidation: "createHtmlOutputFromFile('NAME') | createTemplateFromFile('NAME').evaluate(). Errors: 'Cannot find file'→check filename, 'Unexpected token'→scriptlet syntax, 'undefined is not a function'→wrap in include()",
      antiPatterns: 'exec for file ops→use cat/write | long js_statement→write module+require()'
    }
    // NOTE: responseSchema removed for token efficiency (~750 tokens saved)
    // Response format documented in llmGuidance.response block above
  };

  public annotations = {
    title: 'Execute Code',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  /**
   * Try to get auth token without throwing errors (optimistic approach)
   */
  private async tryGetAuthToken(): Promise<string | null> {
    try {
      return await this.getAuthToken({});
    } catch (error: any) {
      // Return null if authentication fails, so we can try without auth first
      return null;
    }
  }

  /**
   * Environment tags for deployment identification (same as deployment.ts)
   */
  private readonly ENV_TAGS = {
    dev: '[DEV]',
    staging: '[STAGING]',
    prod: '[PROD]'
  } as const;

  /**
   * Find environment-specific deployment by description tag
   */
  private async findEnvironmentDeployment(
    scriptId: string,
    environment: 'dev' | 'staging' | 'prod',
    accessToken: string
  ): Promise<{ deploymentId: string; versionNumber: number | null; url: string | null } | null> {
    try {
      const deployments = await this.gasClient.listDeployments(scriptId, accessToken);
      const envTag = this.ENV_TAGS[environment];

      const deployment = deployments.find((d: any) => d.description?.includes(envTag));

      if (!deployment) {
        return null;
      }

      // Extract web app URL from deployment
      let url: string | null = null;
      if (deployment.entryPoints) {
        const webAppEntry = deployment.entryPoints.find((ep: any) => ep.entryPointType === 'WEB_APP');
        url = webAppEntry?.webApp?.url || null;
      }

      return {
        deploymentId: deployment.deploymentId,
        versionNumber: deployment.versionNumber || null,
        url
      };
    } catch (error: any) {
      console.error(`[ENV LOOKUP] Failed to find ${environment} deployment: ${error.message}`);
      return null;
    }
  }

  async execute(params: any): Promise<any> {
    // Optimistic approach: validate inputs first, then try without authentication
    const scriptId = this.validate.scriptId(params.scriptId, 'dynamic JS execution');
    const environment = this.validate.enum(
      params.environment || 'dev',
      'environment',
      ['dev', 'staging', 'prod'],
      'code execution'
    );
    const js_statement = this.validate.string(params.js_statement, 'JavaScript statement');
    const autoRedeploy = params.autoRedeploy !== false;
    const executionTimeout = Math.min(Math.max(params.executionTimeout || 780, 780), 3600); // 13m-1h range
    const responseTimeout = Math.min(Math.max(params.responseTimeout || 780, 780), 3600); // 13m-1h range
    const logFilter = params.logFilter; // Optional regex pattern for filtering logs
    const logTail = params.logTail; // Optional number of lines to show from end

    if (!js_statement?.trim()) {
      throw new ValidationError('js_statement', js_statement, 'non-empty JavaScript statement');
    }

    const skipSyncCheck = params.skipSyncCheck === true;

    // Compact logging
    console.error(`[EXEC] ${scriptId.substring(0, 12)}... env:${environment} ${js_statement.substring(0, 60)}...${logFilter ? ` filter:"${logFilter.substring(0, 20)}"` : ''}${logTail ? ` tail:${logTail}` : ''}${skipSyncCheck ? ' (sync check skipped)' : ''}`);
    const execStartTime = Date.now();
    mcpLogger.info('exec', { event: 'exec_start', scriptId, statement: js_statement.substring(0, 100) });

    // PRE-FLIGHT SYNC CHECK: Detect drift between local and remote before execution
    // This prevents executing stale code when local files have diverged from remote
    // When skipSyncCheck=true, we still check but return collision info instead of throwing
    let collisionInfo: CollisionInfo | undefined;

    try {
      // Get auth token for sync check (best-effort, may be null)
      const syncCheckToken = params.accessToken || await this.tryGetAuthToken();

      if (syncCheckToken) {
        console.error(`[SYNC CHECK] Checking for local/remote drift...`);

        // Fetch remote files for comparison
        const remoteFiles = await this.gasClient.getProjectContent(scriptId, syncCheckToken);

        // Background deploy: detect and repair missing HTML templates without blocking exec
        const hasSuccessHtml = remoteFiles.some((f: GASFile) => fileNameMatches(f.name, 'common-js/__mcp_exec_success'));
        const hasErrorHtml = remoteFiles.some((f: GASFile) => fileNameMatches(f.name, 'common-js/__mcp_exec_error'));
        if (!hasSuccessHtml || !hasErrorHtml) {
          console.error(`[SYNC CHECK] Missing HTML templates (success:${hasSuccessHtml}, error:${hasErrorHtml}) — deploying in background`);
          const bgToken = syncCheckToken;
          void Promise.resolve().then(async () => {
            try {
              if (!hasSuccessHtml) {
                await this.gasClient.updateFile(scriptId, 'common-js/__mcp_exec_success', getSuccessHtmlTemplate(), undefined, bgToken, 'HTML');
                console.error(`[BACKGROUND] ✓ Deployed __mcp_exec_success.html`);
              }
              if (!hasErrorHtml) {
                await this.gasClient.updateFile(scriptId, 'common-js/__mcp_exec_error', getErrorHtmlTemplate(), undefined, bgToken, 'HTML');
                console.error(`[BACKGROUND] ✓ Deployed __mcp_exec_error.html`);
              }
            } catch (bgErr: any) {
              console.error(`[BACKGROUND] HTML template deployment failed (non-blocking): ${bgErr.message}`);
            }
          });
        }

        // Check sync status (excludes system files by default)
        // Include content for up to 5 files to generate diffs for LLM assistance
        const { summary, drift } = await checkSyncStatus(scriptId, remoteFiles, {
          excludeSystemFiles: true,  // Skip common-js/*, __mcp_exec*
          includeContent: true,      // Include content for diff generation
          maxContentFiles: 5         // Limit to prevent large responses
        });

        // If drift detected, either throw error or build collision info
        // Only local_stale counts as blocking drift — remote_only files were never locally
        // modified and can't be "stale" (they just haven't been pulled yet)
        if (summary.stale > 0) {
          console.error(`[SYNC CHECK] Drift detected: ${summary.stale} stale files${summary.remoteOnly > 0 ? `, ${summary.remoteOnly} remote-only (not blocking)` : ''}`);

          // Generate diffs for files with content
          const diffGenerator = new DiffGenerator();
          const MAX_DIFF_LINES = 200;      // Increased from 50 - LLM needs more context
          const MAX_PREVIEW_CHARS = 2000;  // Increased from 500 - show more of new files

          const staleWithDiffs: DriftFileInfo[] = drift.staleLocal.map((f: FileSyncStatus) => {
            const info: DriftFileInfo = {
              filename: f.filename,
              localHash: f.localHash,
              remoteHash: f.remoteHash || '',
              sizeDiff: f.sizeDiff
            };

            // Generate diff if we have both local and remote content
            if (f.localContent && f.remoteContent) {
              const fullDiff = diffGenerator.generateDiff(f.localContent, f.remoteContent, f.filename);
              const diffLines = fullDiff.split('\n');

              if (diffLines.length > MAX_DIFF_LINES) {
                info.diff = diffLines.slice(0, MAX_DIFF_LINES).join('\n') +
                  `\n... (${diffLines.length - MAX_DIFF_LINES} more lines truncated)`;
              } else {
                info.diff = fullDiff;
              }
            }

            return info;
          });

          const missingWithPreview: DriftFileInfo[] = drift.missingLocal.map((f: FileSyncStatus) => {
            const info: DriftFileInfo = {
              filename: f.filename,
              remoteHash: f.remoteHash || ''
            };

            // Include preview of remote content for new files
            if (f.remoteContent) {
              if (f.remoteContent.length > MAX_PREVIEW_CHARS) {
                info.remotePreview = f.remoteContent.substring(0, MAX_PREVIEW_CHARS) +
                  `\n... (${f.remoteContent.length - MAX_PREVIEW_CHARS} more chars truncated)`;
              } else {
                info.remotePreview = f.remoteContent;
              }
            }

            return info;
          });

          if (!skipSyncCheck) {
            // Default behavior: throw SyncDriftError to block execution
            throw new SyncDriftError(scriptId, {
              staleLocal: staleWithDiffs,
              missingLocal: missingWithPreview
            });
          } else {
            // skipSyncCheck=true: Build collision info for response (warning, not error)
            // Convert to StaleFile format for CollisionInfo
            const staleFiles: StaleFile[] = [
              ...drift.staleLocal.map((f: FileSyncStatus) => ({
                file: f.filename,
                expectedHash: f.localHash || '',
                actualHash: f.remoteHash || null,
                action: 'modified' as const,
              })),
              ...drift.missingLocal.map((f: FileSyncStatus) => ({
                file: f.filename,
                expectedHash: '',
                actualHash: f.remoteHash || null,
                action: 'created_externally' as const,
              })),
            ];

            collisionInfo = buildMultiFileCollision(staleFiles);
            console.error(`[SYNC CHECK] Drift warning: ${staleFiles.length} stale files (execution proceeding due to skipSyncCheck=true)`);
          }
        } else {
          console.error(`[SYNC CHECK] ✓ ${summary.inSync} files in sync${summary.remoteOnly > 0 ? ` (${summary.remoteOnly} remote-only, not blocking)` : ''}`);
        }

        // Validate CommonJS file ordering (critical for module system to work)
        const orderingResult = validateCommonJSOrdering(remoteFiles);
        if (!orderingResult.valid) {
          console.error(`[COMMONJS CHECK] ${formatCommonJSOrderingIssues(orderingResult)}`);
          // Log but don't block - the module system may still work in some cases
          // Severe ordering issues will manifest as runtime errors
        } else if (orderingResult.issues.length > 0) {
          // Warnings only - log but don't block
          console.error(`[COMMONJS CHECK] ${formatCommonJSOrderingIssues(orderingResult)}`);
        } else {
          console.error(`[COMMONJS CHECK] ✓ Critical files in correct order`);
        }
      } else {
        console.error(`[SYNC CHECK] Skipped (no auth token available)`);
      }
    } catch (error) {
      // If the error is SyncDriftError, re-throw it
      if (error instanceof SyncDriftError) {
        throw error;
      }
      // For other errors (network, API), log but don't block execution
      console.error(`[SYNC CHECK] Warning: Could not verify sync status: ${(error as Error).message}`);
    }

    // Try operation first with provided access token (if any) or session auth
    let accessToken: string | null = null;

    try {
      // First try: Use provided token or attempt to get from session (optimistic)
      accessToken = params.accessToken || await this.tryGetAuthToken();

      // ENVIRONMENT-AWARE EXECUTION: Look up environment-specific deployment
      let envDeployment = null;
      if (accessToken) {
        console.error(`[ENV EXECUTION] Looking up ${environment} deployment for execution...`);
        envDeployment = await this.findEnvironmentDeployment(scriptId, environment, accessToken);

        if (envDeployment) {
          console.error(`[ENV EXECUTION] Found ${environment} deployment: ${envDeployment.deploymentId} (version: ${envDeployment.versionNumber || 'HEAD'})`);
        } else {
          console.error(`[ENV EXECUTION] No ${environment} deployment found, falling back to default behavior`);
        }
      }

      // PERFORMANCE OPTIMIZATION: Optimistic execution with cached infrastructure
      const result = await this.executeOptimistic(
        scriptId,
        js_statement,
        accessToken || '',
        executionTimeout,
        responseTimeout,
        autoRedeploy,
        logFilter,
        logTail,
        environment,
        envDeployment
      );

      mcpLogger.info('exec', { event: 'exec_complete', scriptId, durationMs: Date.now() - execStartTime });

      // Include collision info if drift was detected but skipped
      if (collisionInfo && collisionInfo.hasCollisions) {
        return {
          ...result,
          collision: collisionInfo,
        };
      }

      return result;
    } catch (error: any) {
      mcpLogger.error('exec', { event: 'exec_error', scriptId, error: error.message, durationMs: Date.now() - execStartTime });

      // Check for authentication errors (401/403)
      const statusCode = error.statusCode || error.response?.status || error.data?.statusCode;

      if (statusCode === 401 || statusCode === 403) {
        // Include detailed HTTP response information in the error
        const httpDetails = {
          statusCode,
          statusText: error.response?.statusText || (statusCode === 401 ? 'Unauthorized' : 'Forbidden'),
          url: error.response?.url || 'Unknown URL',
          headers: error.response?.headers ? (typeof error.response.headers.entries === 'function' ? Object.fromEntries(error.response.headers.entries()) : error.response.headers) : {},
          responseBody: error.response?.text || error.message
        };

        const authError = new AuthenticationError(
          `Authentication required for exec operation (HTTP ${statusCode}). Use auth(mode="start") to authenticate and retry.`
        );

        // Add HTTP response details to error data
        authError.data = {
          ...authError.data,
          statusCode,
          operation: 'exec',
          scriptId,
          httpResponse: httpDetails,
          instructions: [
            'Use auth with mode="start" to begin authentication',
            'Complete the OAuth flow in your browser',
            'Then retry your exec request'
          ],
          command: 'auth({"mode": "start"})',
          statusCheck: 'auth({"mode": "status"})'
        };

        throw authError;
      }

      // 🔍 PERFORMANCE: Check infrastructure before expensive setup
      if (this.needsInfrastructureSetup(error)) {
        // Check if autoRedeploy is disabled FIRST (was previously dead code inside && autoRedeploy block)
        if (!autoRedeploy) {
          // Return structured error response when autoRedeploy is disabled
          return buildExecErrorResponse(
            scriptId,
            js_statement,
            {
              type: 'AutoRedeployDisabled',
              message: `Execution failed and autoRedeploy is disabled. ${error.message}`,
              stack: getStackSafe(error),
              originalError: error.message
            },
            error.loggerOutput || '',
            { environment: environment, versionNumber: null }
          );
        }

        // autoRedeploy is true - proceed with infrastructure setup
        // For infrastructure setup, we definitely need authentication
        if (!accessToken) {
          throw new AuthenticationError(
            `Authentication required for infrastructure setup. Use auth(mode="start") to authenticate first.`
          );
        }

        // Check if we have cached deployment URL (indicates infrastructure exists)
        const hasCachedUrl = this.sessionAuthManager ?
          await this.sessionAuthManager.getCachedDeploymentUrl(scriptId) : null;

        if (hasCachedUrl) {
          console.error(`⚡ [OPTIMISTIC RETRY] Infrastructure exists (cached URL found), retrying without setup...`);
          // Try one more time before full infrastructure setup
          try {
            return await this.executeOptimistic(scriptId, js_statement, accessToken, executionTimeout, responseTimeout, autoRedeploy, logFilter, logTail, environment, null);
          } catch (retryError: any) {
            console.error(`[OPTIMISTIC RETRY FAILED] Proceeding with infrastructure setup: ${retryError.message}`);
          }
        }

        // Set up infrastructure and retry
        console.error(`[INFRASTRUCTURE SETUP] Setting up deployment infrastructure...`);
        const infrastructureStatus = await setupInfrastructure(this.gasClient, scriptId, accessToken, this.sessionAuthManager);

        // NEW: Retry logic for deployment delays with test function validation
        return await this.executeWithDeploymentRetry(scriptId, js_statement, accessToken, executionTimeout, responseTimeout, logFilter, logTail, environment, infrastructureStatus);
      }

      // Return structured error response with logger output if available (Path 2 - general catch)
      return buildExecErrorResponse(
        scriptId,
        js_statement,
        {
          type: error.name || 'ExecutionError',
          message: error.message,
          stack: getStackSafe(error),
          statusCode: error.statusCode || 500
        },
        error.loggerOutput || '',
        { environment: environment, versionNumber: null }
      );
    }
  }

  /**
   * Execute with retry logic for deployment delays
   * Tests with a simple function first, then retries the actual function
   */
  private async executeWithDeploymentRetry(
    scriptId: string,
    js_statement: string,
    accessToken: string,
    executionTimeout: number = 780,
    responseTimeout: number = 780,
    logFilter?: string,
    logTail?: number,
    environment: 'dev' | 'staging' | 'prod' = 'dev',
    infrastructureStatus?: InfrastructureStatus
  ): Promise<any> {
    const maxRetryDuration = 60000; // 60 seconds total
    const retryInterval = 2000; // 2 seconds between retries
    const startTime = Date.now();

    console.error(`[DEPLOYMENT RETRY] Starting retry logic for potential deployment delay`);
    console.error(`   Script ID: ${scriptId}`);
    console.error(`   Max retry duration: ${maxRetryDuration}ms`);
    console.error(`   Retry interval: ${retryInterval}ms`);

    // Helper to add infrastructure status to response
    const addInfrastructureStatus = (result: any): any => {
      if (!infrastructureStatus) return result;

      // Add infrastructure status to response
      const enhanced = {
        ...result,
        infrastructure: {
          inSync: infrastructureStatus.inSync,
          file: infrastructureStatus.execShim.file,
          verified: infrastructureStatus.execShim.verified,
          ...(infrastructureStatus.execShim.expectedSHA && { expectedSHA: infrastructureStatus.execShim.expectedSHA }),
          ...(infrastructureStatus.execShim.actualSHA && { actualSHA: infrastructureStatus.execShim.actualSHA }),
          ...(infrastructureStatus.execShim.wasCreated && { wasCreated: infrastructureStatus.execShim.wasCreated }),
          ...(infrastructureStatus.execShim.error && { error: infrastructureStatus.execShim.error })
        }
      };

      // Add infrastructure hints if out of sync
      if (!infrastructureStatus.inSync) {
        const infraHints = generateInfrastructureHints(infrastructureStatus, scriptId);
        if (Object.keys(infraHints).length > 0) {
          enhanced.hints = result.hints
            ? mergeExecHints(result.hints, infraHints)
            : infraHints;
        }
      }

      return enhanced;
    };

    while (Date.now() - startTime < maxRetryDuration) {
      try {
        // First try the actual function
        const result = await this.executeOptimistic(scriptId, js_statement, accessToken, executionTimeout, responseTimeout, true, logFilter, logTail, environment, null);
        return addInfrastructureStatus(result);
      } catch (error: any) {
        const statusCode = error.statusCode || error.response?.status;

        // Only retry for HTTP 500 errors (deployment not ready)
        if (statusCode === 500) {
          const elapsedTime = Date.now() - startTime;
          console.error(`[DEPLOYMENT RETRY] HTTP ${statusCode} error, testing deployment readiness`);
          console.error(`   Elapsed time: ${elapsedTime}ms`);
          console.error(`   Error: ${error.message}`);

          // Test if deployment is ready with a simple function that requests JSON
          try {
            console.error(`[DEPLOYMENT TEST] Testing deployment with doGet function - requesting JSON response`);
            await this.executeOptimisticWithJsonRequest(scriptId, 'new Date().toISOString()', accessToken, executionTimeout, responseTimeout);
            console.error(`[DEPLOYMENT TEST] Test function succeeded with HTTP 200, deployment is ready`);

            // Deployment is ready, try the actual function one more time
            try {
              const result = await this.executeOptimistic(scriptId, js_statement, accessToken, executionTimeout, responseTimeout, true, logFilter, logTail, environment, null);
              return addInfrastructureStatus(result);
            } catch (actualError: any) {
              console.error(`[DEPLOYMENT RETRY] Actual function still failed after test succeeded`);
              console.error(`   Error: ${actualError.message}`);
              throw actualError;
            }
          } catch (testError: any) {
            const testStatusCode = testError.statusCode || testError.response?.status;
            console.error(`[DEPLOYMENT TEST] Test function result: HTTP ${testStatusCode} - ${testError.message}`);

            // If we got HTTP 200, consider it successful and retry original function
            if (testStatusCode === 200) {
              console.error(`[DEPLOYMENT TEST] HTTP 200 received, deployment is ready - retrying original function`);
              try {
                const result = await this.executeOptimistic(scriptId, js_statement, accessToken, executionTimeout, responseTimeout, true, logFilter, logTail, environment, null);
                return addInfrastructureStatus(result);
              } catch (actualError: any) {
                console.error(`[DEPLOYMENT RETRY] Original function failed even after HTTP 200 test: ${actualError.message}`);
                throw actualError;
              }
            } else if (testStatusCode === 500) {
              // Still not ready, wait and retry
              if (Date.now() - startTime + retryInterval < maxRetryDuration) {
                console.error(`[DEPLOYMENT RETRY] HTTP ${testStatusCode} - deployment not ready, waiting ${retryInterval}ms before retry`);
                await new Promise(resolve => setTimeout(resolve, retryInterval));
                continue;
              } else {
                console.error(`[DEPLOYMENT RETRY] Timeout reached, deployment still returning HTTP ${testStatusCode}`);
                throw new Error(`Deployment timeout: Google Apps Script project not ready after ${maxRetryDuration}ms. Last error: ${error.message}`);
              }
            } else {
              // Different error, stop retrying
              console.error(`[DEPLOYMENT TEST] Test function failed with HTTP ${testStatusCode} error: ${testError.message}`);
              throw testError;
            }
          }
        } else {
          // Not a 500 error, don't retry
          console.error(`[DEPLOYMENT RETRY] HTTP ${statusCode} error - not retrying: ${error.message}`);
          throw error;
        }
      }
    }

    // Should not reach here, but just in case
    throw new Error(`Deployment timeout: Maximum retry duration of ${maxRetryDuration}ms exceeded`);
  }

  // Special version for deployment testing that explicitly requests JSON
  private async executeOptimisticWithJsonRequest(scriptId: string, js_statement: string, accessToken: string, executionTimeout: number = 780, responseTimeout: number = 780): Promise<any> {
    const executionUrl = await this.gasClient.constructGasRunUrl(scriptId, accessToken);
    const startTime = Date.now();

    // CONFIGURABLE TIMEOUT: Add timeout protection with user-defined timeout
    const abortController = new AbortController();
    const timeoutMs = executionTimeout * 1000; // Convert seconds to milliseconds
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, timeoutMs);

    try {
      // ADD FUNCTION PARAMETER: Add the js_statement as a func parameter
      // IMPORTANT: Properly URL-encode the parameter to handle special characters like +, &, =, etc.
      // ADD MCP_RUN PARAMETER: Signal to __mcp_exec handler via URI-based routing
      const separator = executionUrl.includes('?') ? '&' : '?';
      const encodedJsStatement = encodeURIComponent(js_statement);
      const finalUrl = `${executionUrl}${separator}_mcp_run=true&func=${encodedJsStatement}`;

      // Enhanced request headers
      const requestHeaders = {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'MCP-GAS-Server/1.0.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };

      // PERFORMANCE OPTIMIZATION: Reduce logging for repeated calls
      const isFromCache = executionUrl.includes('cached'); // Simple heuristic
      const shouldVerboseLog = !isFromCache || process.env.MCP_GAS_VERBOSE_LOGGING === 'true';

      if (shouldVerboseLog) {
        // ENHANCED DEBUG LOG - Show URL and headers before request
        const debugInfo = {
          timestamp: new Date().toISOString(),
          operation: 'DEPLOYMENT_TEST',
          scriptId: scriptId,
          jsStatement: js_statement,
          baseUrl: executionUrl,
          originalUrl: finalUrl,
          testUrl: finalUrl,
          urlConversion: finalUrl !== executionUrl ? '/exec → /dev' : 'no conversion needed',
          requestHeaders: {
            ...requestHeaders,
            'Authorization': `Bearer ${accessToken.substring(0, 10)}...***`
          },
          redirectPolicy: 'follow (automatic)',
          timeout: '30 seconds',
          requestStart: new Date().toISOString()
        };

        console.error(`[DEPLOYMENT_TEST ENHANCED DEBUG] Pre-request information:\n${JSON.stringify(debugInfo, null, 2)}`);
      } else {
        console.error(`⚡ [DEPLOYMENT_TEST FAST] Executing: ${js_statement} on cached deployment`);
      }

      // AUTOMATIC REDIRECT: Use native browser redirect handling with JSON Accept header
      const response = await fetch(finalUrl, {
        headers: requestHeaders,
        signal: abortController.signal,
        redirect: 'follow' // Automatically follow redirects
      });

      // Build complete headers object for logging
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const fetchDuration = Date.now() - startTime;
      const contentType = response.headers.get('content-type') || 'Unknown';

      // Enhanced response logging with HTTP codes
      const responseDebugInfo = {
        httpStatus: `HTTP ${response.status} ${response.statusText}`,
        duration: `${fetchDuration}ms`,
        finalUrl: response.url,
        contentType: contentType,
        responseHeaders: responseHeaders,
        redirectsFollowed: response.url !== finalUrl ? 'YES' : 'NO',
        responseTime: new Date().toISOString()
      };

      console.error(`[DEPLOYMENT_TEST RESPONSE] HTTP response details:\n${JSON.stringify(responseDebugInfo, null, 2)}`);

      if (!response.ok) {
        let errorBody = '';
        try {
          errorBody = await response.text();
        } catch (bodyError) {
          errorBody = `[Failed to read error body: ${bodyError}]`;
        }

        // ENHANCED ERROR DEBUG with HTTP codes
        const errorDebugInfo = {
          httpStatus: `HTTP ${response.status} ${response.statusText}`,
          duration: `${fetchDuration}ms`,
          finalUrl: response.url,
          contentType: contentType,
          responseHeaders: responseHeaders,
          errorBody: errorBody || '(empty)',
          bodyLength: errorBody.length,
          errorTime: new Date().toISOString(),
          bearerTokenSent: `Bearer ${accessToken.substring(0, 10)}...*** (CONFIRMED SENT)`
        };

        console.error(`[DEPLOYMENT_TEST ERROR] HTTP ${response.status} error details:\n${JSON.stringify(errorDebugInfo, null, 2)}`);

        const error = new Error(`HTTP ${response.status}: ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`);
        (error as any).statusCode = response.status;
        throw error;
      }

      // If we reach here, we got HTTP 200 - deployment is ready
      clearTimeout(timeoutId);
      console.error(`[DEPLOYMENT_TEST SUCCESS] HTTP ${response.status} - Deployment is ready`);

      return {
        status: 'deployment_ready',
        httpStatus: response.status,
        message: 'Deployment test successful'
      };

    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        const timeoutError = new Error(`Deployment test timeout after ${executionTimeout} seconds`);
        (timeoutError as any).statusCode = 408;
        throw timeoutError;
      }
      throw error;
    }
  }

  private needsInfrastructureSetup(error: any): boolean {
    const statusCode = error.statusCode || error.data?.statusCode || error.response?.status;
    const isHtmlError = error.message?.includes('Web app returned HTML error page');
    return [404, 403, 500].includes(statusCode) || isHtmlError;
  }

  private async executeOptimistic(
    scriptId: string,
    js_statement: string,
    accessToken: string,
    executionTimeout: number = 780,
    responseTimeout: number = 780,
    autoRedeploy: boolean = true,
    logFilter?: string,
    logTail?: number,
    environment: 'dev' | 'staging' | 'prod' = 'dev',
    envDeployment: { deploymentId: string; versionNumber: number | null; url: string | null } | null = null
  ): Promise<any> {
    const startTime = Date.now();

    // ENVIRONMENT-AWARE URL: Use environment deployment URL if available
    let executionUrl: string | null = null;

    if (envDeployment && envDeployment.url) {
      // Use the environment-specific deployment URL directly
      executionUrl = envDeployment.url;
      console.error(`🎯 [ENV URL] Using ${environment} deployment URL: ${executionUrl} (version: ${envDeployment.versionNumber || 'HEAD'})`);
    } else {
      // PERFORMANCE OPTIMIZATION: Check cached deployment URL first
      if (this.sessionAuthManager) {
        try {
          executionUrl = await this.sessionAuthManager.getCachedDeploymentUrl(scriptId);
          if (executionUrl) {
            console.error(`⚡ [CACHE HIT] Using cached deployment URL for ${scriptId}: ${executionUrl}`);
          }
        } catch (cacheError: any) {
          console.error(`[CACHE] Failed to check cached URL: ${cacheError.message}`);
        }
      }

      // If no cached URL, construct it (this is the expensive operation)
      if (!executionUrl) {
        console.error(`[CACHE MISS] Constructing deployment URL for ${scriptId}...`);
        const urlConstructionStart = Date.now();
        executionUrl = await this.gasClient.constructGasRunUrl(scriptId, accessToken);
        const urlConstructionTime = Date.now() - urlConstructionStart;
        console.error(`[URL CONSTRUCTION] Completed in ${urlConstructionTime}ms`);

        // Cache the URL for future use
        if (this.sessionAuthManager && executionUrl) {
          try {
            await this.sessionAuthManager.setCachedDeploymentUrl(scriptId, executionUrl);
            console.error(`💾 [CACHE STORE] Deployment URL cached for future calls`);
          } catch (cacheError: any) {
            console.error(`[CACHE] Failed to store URL: ${cacheError.message}`);
          }
        }
      }
    }

    // CONFIGURABLE TIMEOUT: Add timeout protection with user-defined timeout
    const abortController = new AbortController();
    const timeoutMs = executionTimeout * 1000; // Convert seconds to milliseconds
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, timeoutMs);

    try {
      // ADD FUNCTION PARAMETER: Add the js_statement as a func parameter
      // IMPORTANT: Properly URL-encode the parameter to handle special characters like +, &, =, etc.
      // ADD MCP_RUN PARAMETER: Signal to __mcp_exec handler via URI-based routing
      const separator = executionUrl.includes('?') ? '&' : '?';
      const encodedJsStatement = encodeURIComponent(js_statement);
      const finalUrl = `${executionUrl}${separator}_mcp_run=true&func=${encodedJsStatement}`;

      // Enhanced request headers
      const requestHeaders = {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'MCP-GAS-Server/1.0.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };

      // PERFORMANCE OPTIMIZATION: Reduce logging for repeated calls
      const isFromCache = executionUrl.includes('cached'); // Simple heuristic
      const shouldVerboseLog = !isFromCache || process.env.MCP_GAS_VERBOSE_LOGGING === 'true';

      if (shouldVerboseLog) {
        // ENHANCED DEBUG LOG - Show URL and headers before request
        const debugInfo = {
          timestamp: new Date().toISOString(),
          operation: 'GAS_RUN_EXECUTION',
          scriptId: scriptId,
          jsStatement: js_statement,
          baseUrl: executionUrl,
          finalUrl: finalUrl,
          urlConversion: executionUrl.includes('/exec') ?
            `${executionUrl} → ${finalUrl.replace('/exec', '/dev')} (if redirected)` :
            'no conversion needed',
          requestHeaders: {
            ...requestHeaders,
            'Authorization': `Bearer ${accessToken.substring(0, 10)}...***`
          },
          redirectPolicy: 'follow (automatic)',
          timeout: '30 seconds',
          requestStart: new Date().toISOString()
        };

        console.error(`[GAS_RUN ENHANCED DEBUG] Pre-request information:\n${JSON.stringify(debugInfo, null, 2)}`);
      } else {
        console.error(`⚡ [GAS_RUN FAST] Executing: ${js_statement} on cached deployment`);
      }

      // AUTOMATIC REDIRECT HANDLING: Let fetch handle redirects automatically
      const response = await fetch(finalUrl, {
        headers: requestHeaders,
        signal: abortController.signal,
        redirect: 'follow' // Automatically follow redirects
      });

      // Build complete headers object for logging
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const fetchDuration = Date.now() - startTime;
      const contentType = response.headers.get('content-type') || 'Unknown';

      // Enhanced response logging with HTTP codes and redirect detection
      const responseDebugInfo = {
        httpStatus: `HTTP ${response.status} ${response.statusText}`,
        duration: `${fetchDuration}ms`,
        finalUrl: response.url,
        redirectsFollowed: response.url !== finalUrl ? 'YES' : 'NO',
        urlConversion: response.url !== finalUrl ?
          `${finalUrl} → ${response.url}` : 'no redirect',
        contentType: contentType,
        responseHeaders: responseHeaders,
        responseTime: new Date().toISOString()
      };

      console.error(`[GAS_RUN RESPONSE] HTTP response details:\n${JSON.stringify(responseDebugInfo, null, 2)}`);

      // Check for 302/200/500 responses with non-JSON content (requires cookie auth)
      // BUT exclude responses that contain JavaScript execution errors
      if ((response.status === 302 || response.status === 200 || response.status === 500) && !contentType.includes('application/json')) {
        // Read response body to check if it's a domain auth page or execution error
        const responseBodyCheck = await response.clone().text();

        // CRITICAL: Distinguish domain auth from execution errors
        const isExecutionError = responseBodyCheck.includes('ReferenceError:') ||
                                 responseBodyCheck.includes('SyntaxError:') ||
                                 responseBodyCheck.includes('TypeError:') ||
                                 responseBodyCheck.includes('Error:') ||
                                 responseBodyCheck.includes('(line ') ||
                                 responseBodyCheck.includes('file "');

        if (isExecutionError) {
          console.error(`[EXECUTION ERROR] HTTP ${response.status} contains JavaScript error - returning error response instead of domain auth`);

          // Return execution error as structured response (don't trigger domain auth)
          // Extract stack trace from response body (contains full error output)
          const stackTrace = responseBodyCheck.length > 8192
            ? responseBodyCheck.substring(0, 8192) + '\n... [truncated]'
            : responseBodyCheck;

          // Path 3: HTML JS error - use helper with all metadata
          return buildExecErrorResponse(
            scriptId,
            js_statement,
            {
              type: 'EXECUTION_ERROR',  // Keep SCREAMING_SNAKE_CASE for backward compatibility
              message: responseBodyCheck.includes('ReferenceError:') ?
                        responseBodyCheck.split('ReferenceError:')[1].split('\n')[0].trim() :
                        responseBodyCheck.includes('SyntaxError:') ?
                        responseBodyCheck.split('SyntaxError:')[1].split('\n')[0].trim() :
                        'JavaScript execution error',
              stack: stackTrace,
              statusCode: response.status,
              context: 'execution',
              function_called: js_statement,
              accessed_url: response.url,
              url_type: response.url.endsWith('/dev') ? 'HEAD deployment (testing)' : 'Unknown deployment type',
              debug_info: {
                timestamp: new Date().toISOString(),
                deployment_mode: 'development',
                httpStatus: response.status,
                errorSource: 'project_initialization'
              }
            },
            '',
            {
              environment: environment,
              versionNumber: envDeployment?.versionNumber || null,
              executionUrl: executionUrl
            }
          );
        }

        console.error(`[COOKIE AUTH REQUIRED] HTTP ${response.status} with non-JSON response - calling exec_auth`);

        try {
          // Call performDomainAuth to handle domain authorization
          await performDomainAuth(this.gasClient, scriptId, accessToken);

          // After cookie auth, try the request again
          console.error(`[COOKIE AUTH] Retrying request after domain authorization`);
          const retryResponse = await fetch(finalUrl, {
            headers: requestHeaders,
            signal: abortController.signal,
            redirect: 'follow'
          });

          // Continue processing with the retry response
          const retryResponseHeaders: Record<string, string> = {};
          retryResponse.headers.forEach((value, key) => {
            retryResponseHeaders[key] = value;
          });

          const retryContentType = retryResponse.headers.get('content-type') || 'Unknown';

          if (!retryResponse.ok) {
            const errorBody = await retryResponse.text();
            const error = new Error(`HTTP ${retryResponse.status}: ${retryResponse.statusText}${errorBody ? ` - ${errorBody}` : ''}`);
            (error as any).statusCode = retryResponse.status;
            throw error;
          }

          // Process the retry response body
          let retryResult: any;
          let retryResponseText = '';
          let retryIsJson = false;

          if (retryContentType.includes('application/json')) {
            retryResult = await retryResponse.json();
            retryIsJson = true;
          } else {
            retryResponseText = await retryResponse.text();
            try {
              retryResult = JSON.parse(retryResponseText);
              retryIsJson = true;
            } catch {
              retryResult = retryResponseText;
            }
          }

          // Clear timeout and return success
          clearTimeout(timeoutId);

          // Extract logger output from retry result if it exists
          const retryLoggerOutput = (retryResult && typeof retryResult === 'object' && retryResult.logger_output) || '';

          // Apply log filtering before protecting response size
          const { filteredOutput, metadata } = filterLoggerOutput(
            retryLoggerOutput,
            logFilter,
            logTail
          );

          // Add debug hint if require() used but no logs returned
          const usesRequire = js_statement.includes('require(');
          const hasLogs = filteredOutput.trim().length > 0;
          const debugHint = (usesRequire && !hasLogs)
            ? 'No logs returned. Enable module logging: setModuleLogging("ModuleName", true)'
            : undefined;

          // Generate context-aware hints for the response
          const retryHints = generateExecHints(
            'success',
            js_statement,
            retryResult && typeof retryResult === 'object' && retryResult.result !== undefined ? retryResult.result : retryResult,
            filteredOutput,
            undefined,
            false,
            environment
          );

          return wrapLargeResponse(protectResponseSize({
            status: 'success',
            scriptId,
            js_statement,
            result: retryResult && typeof retryResult === 'object' && retryResult.result !== undefined ? retryResult.result : retryResult,
            logger_output: filteredOutput + metadata,
            ...(debugHint && { debugHint }),
            ...(Object.keys(retryHints).length > 0 && { hints: retryHints }),
            executedAt: new Date().toISOString(),
            environment: environment,
            versionNumber: envDeployment?.versionNumber || null,
            cookieAuthUsed: true,
            ide_url_hint: `${executionUrl}?_mcp_run=true&action=auth_ide`
          }), scriptId);

        } catch (authError: any) {
          console.error(`[COOKIE AUTH] Domain authorization failed: ${authError.message} - continuing without cookie auth`);
          // Fall through to normal error handling
        }
      }

      if (!response.ok) {
        let errorBody = '';
        try {
          errorBody = await response.text();
        } catch (bodyError) {
          errorBody = `[Failed to read error body: ${bodyError}]`;
        }

        // Try to parse error body as JSON to extract logger output
        let loggerOutput = '';
        try {
          const errorJson = JSON.parse(errorBody);
          if (errorJson.logger_output) {
            loggerOutput = errorJson.logger_output;
          }
        } catch {
          // Not JSON, continue without logger output
        }

        // ENHANCED ERROR DEBUG with HTTP codes
        const errorDebugInfo = {
          httpStatus: `HTTP ${response.status} ${response.statusText}`,
          duration: `${fetchDuration}ms`,
          finalUrl: response.url,
          contentType: contentType,
          responseHeaders: responseHeaders,
          errorBody: errorBody || '(empty)',
          bodyLength: errorBody.length,
          errorTime: new Date().toISOString(),
          bearerTokenSent: `Bearer ${accessToken.substring(0, 10)}...*** (CONFIRMED SENT)`
        };

        console.error(`[GAS_RUN ERROR] HTTP ${response.status} error details:\n${JSON.stringify(errorDebugInfo, null, 2)}`);

        const error = new Error(`HTTP ${response.status}: ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`);
        (error as any).statusCode = response.status;
        (error as any).statusText = response.statusText;
        (error as any).response = {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          url: response.url,
          body: errorBody
        };
        (error as any).responseBody = errorBody;
        (error as any).loggerOutput = loggerOutput;
        (error as any).config = {
          url: executionUrl,
          method: 'GET'
        };
        throw error;
      }

      // HANGING FIX: Keep timeout active during response reading with separate timeout
      // Use Promise.race to ensure response.text() doesn't hang indefinitely
      const responseStartTime = Date.now();

      let result: any;
      let responseText = '';
      let isJson = false;
      try {
        if (contentType.includes('application/json')) {
          // Try to parse as JSON directly
          result = await Promise.race([
            response.json(),
            new Promise<never>((_, reject) => {
              setTimeout(() => {
                reject(new Error(`Response body reading timeout after ${responseTimeout} seconds`));
              }, responseTimeout * 1000);
            })
          ]);
          isJson = true;
          responseText = JSON.stringify(result);
        } else {
          // Fallback to text
          responseText = await Promise.race([
            response.text(),
            new Promise<never>((_, reject) => {
              setTimeout(() => {
                reject(new Error(`Response body reading timeout after ${responseTimeout} seconds`));
              }, responseTimeout * 1000);
            })
          ]);
          try {
            result = JSON.parse(responseText);
            isJson = true;
          } catch {
            isJson = false;
          }
        }
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }

      const responseReadDuration = Date.now() - responseStartTime;
      const totalDuration = Date.now() - startTime;

      // Only clear timeout after complete response processing
      clearTimeout(timeoutId);

      // Parse response
      if (!isJson) {
        if (responseText.includes('DOCTYPE html') || responseText.includes('<html')) {
          // ENHANCED HTML ERROR DEBUG with HTTP codes
          const htmlErrorDebugInfo = {
            httpStatus: `HTTP ${response.status} ${response.statusText}`,
            finalUrl: response.url,
            contentType: contentType,
            responseHeaders: responseHeaders,
            htmlPreview: responseText.substring(0, 200) + '...',
            totalDuration: `${totalDuration}ms`,
            errorTime: new Date().toISOString(),
            bearerTokenSent: `Bearer ${accessToken.substring(0, 10)}...*** (CONFIRMED SENT)`,
            diagnosis: 'Web app returned HTML error page instead of JSON - likely deployment not ready'
          };

          console.error(`[GAS_RUN HTML ERROR] HTTP ${response.status} - Web app returned HTML instead of JSON:\n${JSON.stringify(htmlErrorDebugInfo, null, 2)}`);

          const error = new Error('Web app returned HTML error page instead of JSON');
          (error as any).statusCode = 500; // Treat as deployment not ready - triggers retry logic
          throw error;
        }
        result = responseText;
      }

      // ENHANCED SUCCESS DEBUG with HTTP codes
      const successDebugInfo = {
        httpStatus: `HTTP ${response.status} ${response.statusText}`,
        payloadReadDuration: `${responseReadDuration}ms`,
        totalRequestDuration: `${totalDuration}ms`,
        finalUrl: response.url,
        contentType: contentType,
        responseHeaders: responseHeaders,
        responsePayload: responseText,
        payloadLength: responseText.length,
        payloadType: isJson ? 'JSON' : 'Text',
        successTime: new Date().toISOString(),
        bearerTokenSent: `Bearer ${accessToken.substring(0, 10)}...*** (CONFIRMED SENT)`
      };

      console.error(`[GAS_RUN SUCCESS] HTTP ${response.status} success details:\n${JSON.stringify(successDebugInfo, null, 2)}`);

      // Handle structured response format {type: "data"|"exception", payload: ...}
      if (result && typeof result === 'object' && result.type) {
        if (result.type === 'data') {

          // Apply log filtering before protecting response size
          const { filteredOutput, metadata } = filterLoggerOutput(
            result.logger_output || '',
            logFilter,
            logTail
          );

          // Add debug hint if require() used but no logs returned
          const usesRequire = js_statement.includes('require(');
          const hasLogs = filteredOutput.trim().length > 0;
          const debugHint = (usesRequire && !hasLogs)
            ? 'No logs returned. Enable module logging: setModuleLogging("ModuleName", true)'
            : undefined;

          // Generate context-aware hints for the response
          const dataHints = generateExecHints(
            'success',
            js_statement,
            result.payload,
            filteredOutput,
            undefined,
            false,
            environment
          );

          return wrapLargeResponse(protectResponseSize({
            status: 'success',
            scriptId,
            js_statement,
            result: result.payload,
            logger_output: filteredOutput + metadata,
            ...(debugHint && { debugHint }),
            ...(Object.keys(dataHints).length > 0 && { hints: dataHints }),
            executedAt: new Date().toISOString(),
            environment: environment,
            versionNumber: envDeployment?.versionNumber || null,
            ide_url_hint: `${executionUrl}?_mcp_run=true&action=auth_ide`
          }), scriptId);
        } else if (result.type === 'exception') {
          const error = new Error(result.payload.error.message);
          error.name = result.payload.error.name || 'FunctionExecutionError';
          // Preserve the GAS stack trace and logger output for debugging
          (error as any).gasStack = result.payload.error.stack || '';
          (error as any).loggerOutput = result.payload.logger_output || '';
          throw error;
        }
      }

      // Extract logger output from the result if it exists
      const loggerOutput = (result && typeof result === 'object' && result.logger_output) || '';

      // Apply log filtering before protecting response size
      const { filteredOutput, metadata } = filterLoggerOutput(
        loggerOutput,
        logFilter,
        logTail
      );

      // Check for GAS errorResponse format: {error: true, ...}
      // This is CRITICAL - without this check, errors are incorrectly marked as success
      if (result && typeof result === 'object' && result.error === true) {
        return protectResponseSize({
          status: 'error',
          scriptId,
          js_statement,
          error: {
            type: 'ExecutionError',
            message: result.message || 'Unknown error',
            stack: result.stack || '',
            context: result.context || 'unknown',
            function_called: result.function_called || 'unknown'
          },
          logger_output: filteredOutput + metadata,
          executedAt: new Date().toISOString(),
          environment: environment,
          versionNumber: envDeployment?.versionNumber || null,
          ide_url_hint: `${executionUrl}?_mcp_run=true&action=auth_ide`
        });
      }

      // Add debug hint if require() used but no logs returned
      const usesRequire = js_statement.includes('require(');
      const hasLogs = filteredOutput.trim().length > 0;
      const debugHint = (usesRequire && !hasLogs)
        ? 'No logs returned. Enable module logging: setModuleLogging("ModuleName", true)'
        : undefined;

      // Generate context-aware hints for the response
      const successHints = generateExecHints(
        'success',
        js_statement,
        result && typeof result === 'object' && 'result' in result ? result.result : result,
        filteredOutput,
        Date.now() - startTime,
        false,
        environment
      );

      // Return simple success response with logger output
      return wrapLargeResponse(protectResponseSize({
        status: 'success',
        scriptId,
        js_statement,
        result: result && typeof result === 'object' && 'result' in result ? result.result : result,
        logger_output: filteredOutput + metadata,
        ...(debugHint && { debugHint }),
        ...(Object.keys(successHints).length > 0 && { hints: successHints }),
        executedAt: new Date().toISOString(),
        environment: environment,
        versionNumber: envDeployment?.versionNumber || null,
        ide_url_hint: `${executionUrl}?_mcp_run=true&action=auth_ide`
      }), scriptId);
    } catch (error: any) {
      const duration = Date.now() - startTime;

      // Clear timeout on any error
      clearTimeout(timeoutId);

      // ENHANCED ERROR DEBUG with HTTP codes
      const catchErrorDebugInfo = {
        timestamp: new Date().toISOString(),
        scriptId: scriptId,
        jsStatement: js_statement,
        errorType: error.name || 'Unknown',
        errorMessage: error.message,
        httpStatus: error.statusCode ? `HTTP ${error.statusCode} ${error.statusText || ''}` : 'No HTTP status',
        duration: `${duration}ms`,
        bearerTokenSent: `Bearer ${accessToken.substring(0, 10)}...*** (CONFIRMED SENT)`
      };

      console.error(`💥 [GAS_RUN CATCH ERROR] Complete error information:\n${JSON.stringify(catchErrorDebugInfo, null, 2)}`);

      // Handle timeout specifically
      if (error.name === 'AbortError') {
        const timeoutError = new Error(`Request timeout: Google Apps Script did not respond within ${executionTimeout} seconds`);
        (timeoutError as any).statusCode = 408;
        (timeoutError as any).loggerOutput = error.loggerOutput || '';
        (timeoutError as any).gasStack = error.gasStack || '';
        throw timeoutError;
      }

      // Handle response reading timeout
      if (error.message?.includes('Response body reading timeout')) {
        const timeoutError = new Error(`Response reading timeout: Google Apps Script response body took longer than ${responseTimeout} seconds to read`);
        (timeoutError as any).statusCode = 408;
        (timeoutError as any).loggerOutput = error.loggerOutput || '';
        (timeoutError as any).gasStack = error.gasStack || '';
        throw timeoutError;
      }

      // Re-throw other errors (loggerOutput and gasStack already preserved on error object)
      throw error;
    }
  }
}

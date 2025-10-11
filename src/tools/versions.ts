import { BaseTool } from './base.js';
import { GASClient } from '../api/gasClient.js';
import { SessionAuthManager } from '../auth/sessionManager.js';
import { SchemaFragments } from '../utils/schemaFragments.js';

/**
 * Get details of a specific version of a script project
 */
export class VersionGetTool extends BaseTool {
  public name = 'version_get';
  public description = 'Get details of a specific version of a script project. LLM USE: Examine specific code versions and their metadata.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      versionNumber: {
        type: 'number',
        description: 'Version number to retrieve. LLM USE: Get this from version_list or gas_deploy_list responses.',
        minimum: 1,
        llmHints: {
          obtaining: 'Use version_list to see all available version numbers',
          sequential: 'Version numbers are sequential integers starting from 1',
          latest: 'Higher numbers represent more recent versions'
        }
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId', 'versionNumber'],
    additionalProperties: false,
    llmWorkflowGuide: {
      prerequisites: [
        '1. Authentication: auth({mode: "status"}) → auth({mode: "start"}) if needed',
        '2. Have valid scriptId from gas_project_create or gas_ls',
        '3. Version must exist (use version_list to see available versions)'
      ],
      scriptTypeCompatibility: {
        standalone: '✅ Full Support - Works identically',
        containerBound: '✅ Full Support - Works identically',
        notes: 'Version management works universally for both script types.'
      },
      limitations: {
        versionCreation: 'Versions are immutable snapshots - cannot be edited after creation',
        versionLimit: 'Project version limit depends on account type (typically 50-100 versions)',
        fileContentAccess: 'version_get returns metadata only - use gas_cat to read actual file contents'
      },
      useCases: {
        codeReview: 'version_get({scriptId: "...", versionNumber: 5}) - Review specific version code',
        comparison: 'version_get for multiple versions to compare changes',
        deployment: 'version_get to verify version before deployment'
      },
      errorHandling: {
        'AuthenticationError': 'Run auth({mode: "start"}) to authenticate first',
        'ScriptNotFound': 'Verify scriptId is correct and accessible',
        'VersionNotFound': 'Version number may not exist, use version_list to see available versions'
      },
      returnValue: {
        versionNumber: 'The version number requested',
        description: 'Version description/changelog',
        createTime: 'When this version was created',
        fileCount: 'Number of files in this version'
      }
    }
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    const scriptId = this.validate.scriptId(params.scriptId, 'version retrieval');
    const versionNumber = this.validate.number(params.versionNumber, 'versionNumber', 'version retrieval', 1);

    return await this.handleApiCall(
      () => this.gasClient.getVersion(scriptId, versionNumber, accessToken),
      'get version details',
      { scriptId, versionNumber }
    );
  }
}

/**
 * List all versions of a script project
 */
export class VersionListTool extends BaseTool {
  public name = 'version_list';
  public description = 'List all versions of a script project. LLM USE: See version history and select versions for deployment or comparison.';
  
  public inputSchema = {
    type: 'object',
    properties: {
      ...SchemaFragments.scriptId,
      pageSize: {
        type: 'number',
        description: 'Maximum number of versions to return (default: 50). LLM RECOMMENDATION: Use larger values to see complete version history.',
        minimum: 1,
        default: 50,
        llmHints: {
          complete: 'Use 50 to see all versions in most cases',
          recent: 'Use smaller values (10-20) to see only recent versions',
          performance: 'Larger values may be slower for projects with many versions'
        }
      },
      pageToken: {
        type: 'string',
        description: 'Token for pagination (optional). LLM USE: Include token from previous response to get next page.',
        llmHints: {
          workflow: 'Get this from previous version_list response.nextPageToken',
          iteration: 'Keep calling with pageToken until nextPageToken is null'
        }
      },
      ...SchemaFragments.accessToken
    },
    required: ['scriptId'],
    additionalProperties: false,
    llmWorkflowGuide: {
      prerequisites: [
        '1. Authentication: auth({mode: "status"}) → auth({mode: "start"}) if needed',
        '2. Have valid scriptId from gas_project_create or gas_ls'
      ],
      scriptTypeCompatibility: {
        standalone: '✅ Full Support - Works identically',
        containerBound: '✅ Full Support - Works identically',
        notes: 'Version listing works universally for both script types.'
      },
      limitations: {
        pagination: 'Returns up to pageSize versions per call - use pageToken for additional pages',
        sortOrder: 'Versions returned in reverse chronological order (newest first)',
        metadataOnly: 'Returns version metadata only - use version_get for detailed info'
      },
      useCases: {
        history: 'version_list({scriptId: "..."}) - See complete version history',
        deployment: 'version_list to select version for gas_deploy_create',
        comparison: 'version_list to identify versions for comparison'
      },
      errorHandling: {
        'AuthenticationError': 'Run auth({mode: "start"}) to authenticate first',
        'ScriptNotFound': 'Verify scriptId is correct and accessible',
        'NoVersions': 'Project may not have any saved versions yet (use gas_version_create)'
      },
      returnValue: {
        versions: 'Array of version objects with version numbers and metadata',
        totalCount: 'Total number of versions available',
        nextPageToken: 'Token for next page if more versions exist'
      },
      nextSteps: [
        'Use version_get to examine specific version details',
        'Use gas_deploy_create with versionNumber to deploy specific version'
      ]
    }
  };

  private gasClient: GASClient;

  constructor(sessionAuthManager?: SessionAuthManager) {
    super(sessionAuthManager);
    this.gasClient = new GASClient();
  }

  async execute(params: any): Promise<any> {
    const accessToken = await this.getAuthToken(params);
    
    const scriptId = this.validate.scriptId(params.scriptId, 'version listing');
    const pageSize = params.pageSize ? this.validate.number(params.pageSize, 'pageSize', 'version listing', 1, 50) : 50;
    const pageToken = params.pageToken ? this.validate.string(params.pageToken, 'pageToken', 'version listing') : undefined;

    return await this.handleApiCall(
      () => this.gasClient.listVersions(scriptId, pageSize, pageToken, accessToken),
      'list versions',
      { scriptId, pageSize, pageToken }
    );
  }
} 